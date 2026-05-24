import logging

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect
from jose import JWTError

from config import settings
from routers.auth import verify_token

logger = logging.getLogger(__name__)
router = APIRouter()


async def _broadcast_to_browsers(app_state, payload: dict) -> None:
    if not app_state.browser_connections:
        return
    dead: set[WebSocket] = set()
    for ws in app_state.browser_connections:
        try:
            await ws.send_json(payload)
        except Exception:
            logger.warning(
                "Broadcast to browser client failed — removing (type=%s station=%s)",
                payload.get("type"), payload.get("station_id"),
            )
            dead.add(ws)
    if dead:
        app_state.browser_connections.difference_update(dead)
        logger.info(
            "Removed %d dead browser client(s); %d still connected",
            len(dead), len(app_state.browser_connections),
        )


@router.websocket("/ws/raspberry")
async def raspberry_ws(websocket: WebSocket) -> None:
    client_host = websocket.client.host if websocket.client else "unknown"
    api_key = websocket.headers.get("x-api-key", "")
    if api_key != settings.API_KEY:
        logger.warning(
            "Raspberry WebSocket rejected: invalid API key (client=%s key_prefix='%s')",
            client_host, api_key[:6] if api_key else "(empty)",
        )
        await websocket.close(code=1008)
        return

    await websocket.accept()
    logger.info("Raspberry Pi connected: client=%s", client_host)
    app_state = websocket.app.state
    station_id: str | None = None
    msg_count = 0

    try:
        async for data in websocket.iter_json():
            msg_type = data.get("type")
            msg_count += 1

            if msg_type == "state_update":
                new_station_id = data.get("station_id")
                if new_station_id:
                    if station_id is None:
                        logger.info(
                            "Raspberry identified as station '%s' (client=%s)",
                            new_station_id, client_host,
                        )
                    station_id = new_station_id
                    app_state.raspberry_connections[station_id] = websocket
                    app_state.station_states[station_id] = data
                    logger.debug(
                        "State update from station=%s: level=%.1f%% pumps=%s mode=%s (msg#%d)",
                        station_id,
                        data.get("level_pct", 0.0),
                        data.get("pumps"),
                        data.get("mode"),
                        msg_count,
                    )
                    await _broadcast_to_browsers(app_state, data)
                else:
                    logger.warning(
                        "state_update message missing station_id (client=%s msg#%d)",
                        client_host, msg_count,
                    )
            else:
                logger.warning(
                    "Unknown message type '%s' from Raspberry (station=%s msg#%d)",
                    msg_type, station_id, msg_count,
                )

    except WebSocketDisconnect:
        logger.info(
            "Raspberry disconnected: station=%s client=%s total_messages=%d",
            station_id, client_host, msg_count,
        )
    except Exception:
        logger.exception(
            "Raspberry WebSocket error: station=%s client=%s messages=%d",
            station_id, client_host, msg_count,
        )
    finally:
        if station_id:
            app_state.raspberry_connections.pop(station_id, None)
            logger.info(
                "Raspberry cleanup: station=%s removed from connections (remaining: %d)",
                station_id, len(app_state.raspberry_connections),
            )


@router.websocket("/ws/browser")
async def browser_ws(websocket: WebSocket, token: str = Query(None)) -> None:
    client_host = websocket.client.host if websocket.client else "unknown"

    if not token:
        logger.warning("Browser WebSocket rejected: no token provided (client=%s)", client_host)
        await websocket.close(code=1008)
        return
    try:
        username = verify_token(token)
    except Exception:
        logger.warning(
            "Browser WebSocket rejected: invalid token (client=%s)",
            client_host,
        )
        await websocket.close(code=1008)
        return

    await websocket.accept()
    logger.info(
        "Browser client connected: user='%s' client=%s (total: %d)",
        username, client_host, len(websocket.app.state.browser_connections) + 1,
    )
    app_state = websocket.app.state
    app_state.browser_connections.add(websocket)

    snapshot_count = 0
    for state in app_state.station_states.values():
        try:
            await websocket.send_json(state)
            snapshot_count += 1
        except Exception:
            logger.warning(
                "Failed to send state snapshot to browser (user=%s station=%s)",
                username, state.get("station_id"),
            )
            break
    if snapshot_count:
        logger.debug(
            "Sent %d state snapshot(s) to browser user='%s'",
            snapshot_count, username,
        )

    try:
        async for data in websocket.iter_json():
            if data.get("type") == "command":
                station_id = data.get("station_id")
                action = data.get("action")
                logger.info(
                    "Browser command: action='%s' station=%s user='%s'",
                    action, station_id, username,
                )
                rpi_ws = app_state.raspberry_connections.get(station_id)
                if rpi_ws:
                    try:
                        await rpi_ws.send_json(data)
                        logger.debug(
                            "Command forwarded to Raspberry: action='%s' station=%s",
                            action, station_id,
                        )
                    except Exception:
                        logger.exception(
                            "Failed to forward command to Raspberry (action='%s' station=%s) "
                            "— removing stale connection",
                            action, station_id,
                        )
                        app_state.raspberry_connections.pop(station_id, None)
                else:
                    logger.warning(
                        "Command dropped: station=%s is offline (action='%s' user='%s')",
                        station_id, action, username,
                    )
            else:
                logger.warning(
                    "Unexpected message from browser user='%s': %s",
                    username, data,
                )
    except WebSocketDisconnect:
        logger.info("Browser client disconnected: user='%s' client=%s", username, client_host)
    except Exception:
        logger.exception("Browser WebSocket error: user='%s' client=%s", username, client_host)
    finally:
        app_state.browser_connections.discard(websocket)
        logger.debug("Browser clients remaining: %d", len(app_state.browser_connections))
