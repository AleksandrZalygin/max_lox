import time
import uuid
import logging
from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from sqlalchemy import select

from models.database import AsyncSessionLocal, Event, Measurement, Station
from models.schemas import ArduinoSensorMessage

logger = logging.getLogger(__name__)
router = APIRouter()

# Connected Electron/browser dashboard clients
_client_connections: set[WebSocket] = set()

# Track per-session message counts for diagnostics
_arduino_msg_counts: dict[str, int] = {}


def _compute_level(distance_cm: float, cal: dict) -> float:
    d_empty = float(cal.get("distance_empty", 50))
    d_full = float(cal.get("distance_full", 5))
    if d_empty == d_full:
        logger.error(
            "Calibration error: distance_empty == distance_full == %.1f — level will be 0%%",
            d_empty,
        )
        return 0.0
    raw = (d_empty - distance_cm) / (d_empty - d_full) * 100.0
    clamped = max(0.0, min(100.0, raw))
    if raw != clamped:
        logger.warning(
            "Level out-of-range: raw=%.1f%% clamped to %.1f%% "
            "(distance=%.1f cal: empty=%.1f full=%.1f)",
            raw, clamped, distance_cm, d_empty, d_full,
        )
    return clamped


def _compute_volume(level_pct: float, cal: dict) -> float:
    l = float(cal.get("length_cm", 0))
    w = float(cal.get("width_cm", 0))
    h = float(cal.get("height_cm", 0))
    return l * w * (h * level_pct / 100.0) / 1000.0


async def _broadcast(payload: dict) -> None:
    if not _client_connections:
        return
    dead: set[WebSocket] = set()
    for ws in _client_connections:
        try:
            await ws.send_json(payload)
        except Exception:
            logger.warning(
                "Broadcast failed to one Electron client — removing from set (type=%s)",
                payload.get("type"),
            )
            dead.add(ws)
    if dead:
        _client_connections.difference_update(dead)
        logger.info(
            "Removed %d dead Electron client(s); %d still connected",
            len(dead), len(_client_connections),
        )


async def _get_station_calibration(station_id: str) -> dict:
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(Station).where(Station.id == uuid.UUID(station_id))
        )
        station = result.scalar_one_or_none()
        if station:
            cal = station.calibration or {}
            if not cal:
                logger.warning(
                    "Station %s has no calibration data — level/volume will be 0",
                    station_id,
                )
            return cal
    logger.error(
        "Station %s not found in DB — cannot compute level (is station registered?)",
        station_id,
    )
    return {}


@router.websocket("/ws/arduino")
async def arduino_ws_endpoint(websocket: WebSocket) -> None:
    client_host = websocket.client.host if websocket.client else "unknown"
    logger.info("Arduino WebSocket connected from %s", client_host)
    await websocket.accept()
    station_id: str | None = None
    device_type: str | None = None
    app_state = websocket.app.state

    pump_ctrl = app_state.pump_ctrl
    leak_detector = app_state.leak_detector
    auto_ctrl = app_state.auto_ctrl
    vps_bridge = app_state.vps_bridge
    msg_count = 0

    try:
        async for data in websocket.iter_json():
            try:
                msg = ArduinoSensorMessage(**data)
            except Exception as e:
                logger.warning(
                    "Invalid Arduino message (raw=%r error=%s) — skipping",
                    data, e,
                )
                continue

            station_id = msg.station_id
            device_type = msg.device
            msg_count += 1
            now = time.time()

            if msg.device == "nano1":
                if station_id not in app_state.arduino_connections:
                    logger.info(
                        "Nano1 registered for station %s (client=%s)",
                        station_id, client_host,
                    )
                pump_ctrl.register_arduino(websocket)
                app_state.arduino_connections[station_id] = websocket

                if msg.pumps is not None:
                    prev = pump_ctrl._pumps_on
                    pump_ctrl._pumps_on = msg.pumps
                    if prev != msg.pumps:
                        logger.info(
                            "Pump state synced from Arduino report: %s → %s (station=%s)",
                            prev, msg.pumps, station_id,
                        )

                if msg.distance_cm is not None:
                    cal = await _get_station_calibration(station_id)
                    level_pct = _compute_level(msg.distance_cm, cal)
                    volume_l = _compute_volume(level_pct, cal)

                    logger.debug(
                        "Nano1 data: distance=%.1fcm level=%.1f%% volume=%.2fL pumps=%s (station=%s msg#%d)",
                        msg.distance_cm, level_pct, volume_l,
                        pump_ctrl.pumps_on, station_id, msg_count,
                    )

                    app_state.station_live[station_id] = {
                        "level_pct": level_pct,
                        "volume_l": volume_l,
                        "pumps": pump_ctrl.pumps_on,
                        "mode": "auto" if auto_ctrl.enabled else "manual",
                        "target_level": auto_ctrl.target_level,
                    }

                    async with AsyncSessionLocal() as db:
                        await auto_ctrl.evaluate(level_pct, pump_ctrl, station_id, db)

                    moisture_pct = app_state.last_moisture.get(station_id)
                    async with AsyncSessionLocal() as db:
                        is_leak = leak_detector.update(level_pct, moisture_pct, pump_ctrl.pumps_on)
                        if is_leak:
                            logger.error(
                                "LEAK EVENT: persisting leak_detected event for station=%s "
                                "(level=%.1f%% moisture=%s)",
                                station_id, level_pct,
                                f"{moisture_pct:.1f}%" if moisture_pct is not None else "N/A",
                            )
                            db.add(Event(
                                station_id=uuid.UUID(station_id),
                                type="leak_detected",
                                payload={"level_pct": level_pct, "moisture_pct": moisture_pct},
                            ))
                            await db.commit()
                            await _broadcast({
                                "type": "alert",
                                "alert": "leak_detected",
                                "station_id": station_id,
                                "level_pct": level_pct,
                            })
                            logger.info(
                                "Leak alert broadcast to %d Electron client(s)",
                                len(_client_connections),
                            )

                    last_saved = app_state.last_saved_ts.get(station_id, 0.0)
                    if now - last_saved >= 5.0:
                        try:
                            async with AsyncSessionLocal() as db:
                                db.add(Measurement(
                                    station_id=uuid.UUID(station_id),
                                    level_pct=level_pct,
                                    volume_l=volume_l,
                                    moisture_raw=None,
                                    moisture_pct=moisture_pct,
                                ))
                                await db.commit()
                            app_state.last_saved_ts[station_id] = now
                            logger.debug(
                                "Measurement saved: level=%.1f%% volume=%.2fL moisture=%s (station=%s)",
                                level_pct, volume_l,
                                f"{moisture_pct:.1f}%" if moisture_pct is not None else "N/A",
                                station_id,
                            )
                        except Exception:
                            logger.exception(
                                "Failed to persist measurement for station=%s "
                                "(level=%.1f%% volume=%.2fL)",
                                station_id, level_pct, volume_l,
                            )

                    last_vps = app_state.last_vps_ts.get(station_id, 0.0)
                    if now - last_vps >= 2.0:
                        await vps_bridge.send_state({
                            "type": "state_update",
                            "station_id": station_id,
                            "level_pct": level_pct,
                            "volume_l": volume_l,
                            "moisture_pct": moisture_pct,
                            "pumps": pump_ctrl.pumps_on,
                            "mode": "auto" if auto_ctrl.enabled else "manual",
                        })
                        app_state.last_vps_ts[station_id] = now
                        logger.debug("VPS state push sent (station=%s)", station_id)

                    await _broadcast({
                        "type": "state_update",
                        "station_id": station_id,
                        "level_pct": level_pct,
                        "volume_l": volume_l,
                        "moisture_pct": moisture_pct,
                        "pumps": pump_ctrl.pumps_on,
                        "mode": "auto" if auto_ctrl.enabled else "manual",
                        "target_level": auto_ctrl.target_level,
                    })

            elif msg.device == "esp32":
                if msg.moisture_pct is not None:
                    prev_moisture = app_state.last_moisture.get(station_id)
                    app_state.last_moisture[station_id] = msg.moisture_pct
                    logger.debug(
                        "Nano2 data: moisture=%.1f%% raw=%s (station=%s msg#%d)",
                        msg.moisture_pct,
                        msg.moisture_raw if msg.moisture_raw is not None else "N/A",
                        station_id, msg_count,
                    )
                    if prev_moisture is None:
                        logger.info(
                            "First moisture reading received from Nano2: %.1f%% (station=%s)",
                            msg.moisture_pct, station_id,
                        )
                    if station_id in app_state.station_live:
                        app_state.station_live[station_id]["moisture_pct"] = msg.moisture_pct
                else:
                    logger.warning(
                        "Nano2 message missing moisture_pct (station=%s raw=%s)",
                        station_id, data,
                    )
            else:
                logger.warning(
                    "Unknown device type '%s' in Arduino message (station=%s)",
                    msg.device, station_id,
                )

    except WebSocketDisconnect:
        logger.info(
            "Arduino WebSocket disconnected (station=%s device=%s total_messages=%d)",
            station_id, device_type, msg_count,
        )
    except Exception:
        logger.exception(
            "Arduino WebSocket crashed (station=%s device=%s messages_processed=%d)",
            station_id, device_type, msg_count,
        )
    finally:
        if station_id:
            app_state.arduino_connections.pop(station_id, None)
        pump_ctrl.unregister_arduino()
        logger.info(
            "Arduino cleanup done (station=%s device=%s)",
            station_id, device_type,
        )


@router.websocket("/ws/clients")
async def client_ws_endpoint(websocket: WebSocket) -> None:
    client_host = websocket.client.host if websocket.client else "unknown"
    logger.info(
        "Electron client connected from %s (total clients before: %d)",
        client_host, len(_client_connections),
    )
    await websocket.accept()
    _client_connections.add(websocket)
    logger.info("Electron clients now connected: %d", len(_client_connections))

    app_state = websocket.app.state
    snapshot_count = 0
    for sid, state in app_state.station_live.items():
        try:
            await websocket.send_json({"type": "state_update", "station_id": sid, **state})
            snapshot_count += 1
        except Exception:
            logger.warning(
                "Failed to send snapshot to new Electron client (station=%s host=%s)",
                sid, client_host,
            )
            break
    if snapshot_count:
        logger.debug(
            "Sent %d station snapshot(s) to new Electron client (%s)",
            snapshot_count, client_host,
        )

    try:
        async for _ in websocket.iter_text():
            pass
    except WebSocketDisconnect:
        logger.info(
            "Electron client disconnected (%s) — remaining: %d",
            client_host, len(_client_connections) - 1,
        )
    except Exception:
        logger.exception("Electron client connection error (%s)", client_host)
    finally:
        _client_connections.discard(websocket)
        logger.debug("Electron clients remaining: %d", len(_client_connections))
