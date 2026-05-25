from __future__ import annotations

import logging
import uuid
from typing import TYPE_CHECKING

from fastapi import WebSocket
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.database import Event, Station

if TYPE_CHECKING:
    pass

logger = logging.getLogger(__name__)


class PumpController:
    def __init__(self) -> None:
        self._pumps_on: bool = False
        self._arduino_ws: WebSocket | None = None

    @property
    def pumps_on(self) -> bool:
        return self._pumps_on

    def register_arduino(self, ws: WebSocket) -> None:
        # Both nano1 and esp32 hit the same /ws/arduino handler and the nano1
        # branch calls this on every message; treat same-ws calls as no-ops to
        # avoid log spam, and log a swap loudly when a different ws takes over.
        if self._arduino_ws is ws:
            return
        if self._arduino_ws is None:
            logger.info("Arduino WebSocket registered with PumpController")
        else:
            logger.info("Arduino WebSocket swapped in PumpController (reconnect)")
        self._arduino_ws = ws

    def unregister_arduino_if(self, ws: WebSocket) -> None:
        # Scoped unregister: only clear when the WS being torn down is the
        # currently registered one. Without this, an unrelated handler exit
        # (e.g. esp32 disconnecting) wipes the nano1 registration and pump
        # commands fall on the floor until the next nano1 sensor frame
        # re-registers ~1 s later.
        if self._arduino_ws is ws:
            logger.info("Arduino WebSocket unregistered from PumpController")
            self._arduino_ws = None

    # Kept for any caller that still uses the unscoped form; new code should
    # call unregister_arduino_if(ws). This is now a no-op so a stray call from
    # a non-owning handler cannot break the active registration.
    def unregister_arduino(self) -> None:
        logger.debug("Unscoped unregister_arduino() called — ignored (use unregister_arduino_if)")

    async def set_pumps(self, on: bool, station_id: str, db: AsyncSession) -> None:
        if on == self._pumps_on:
            logger.debug(
                "set_pumps called with on=%s but state already matches — no-op (station=%s)",
                on, station_id,
            )
            return

        action = "pumps_on" if on else "pumps_off"
        logger.info("Pump state change: %s → %s (station=%s)", self._pumps_on, on, station_id)

        if self._arduino_ws is not None:
            try:
                await self._arduino_ws.send_json({"type": "command", "action": action})
                logger.debug("Command '%s' sent to Arduino (station=%s)", action, station_id)
            except Exception:
                logger.exception(
                    "Failed to send '%s' to Arduino — connection may be lost (station=%s)",
                    action, station_id,
                )
                self._arduino_ws = None
        else:
            logger.warning(
                "set_pumps('%s') called but no Arduino is connected (station=%s) "
                "— state updated locally but relay not triggered",
                action, station_id,
            )

        self._pumps_on = on

        # station_id may arrive as a UUID-string (from /api/stations/<uuid>/pumps
        # commands) or as a logical name like 'station_001' (from auto-mode
        # triggered by an Arduino sensor frame). Resolve both shapes before
        # writing the Event row — otherwise auto-mode pump triggers crash here.
        try:
            try:
                sid_uuid = uuid.UUID(station_id)
            except ValueError:
                row = await db.execute(select(Station).where(Station.name == station_id))
                station = row.scalar_one_or_none()
                if station is None:
                    logger.warning(
                        "Pump event '%s' not persisted: no Station row for name='%s'",
                        action, station_id,
                    )
                    return
                sid_uuid = station.id
            db.add(Event(station_id=sid_uuid, type=action, payload={}))
            await db.commit()
            logger.debug("Event '%s' persisted to DB (station=%s)", action, station_id)
        except Exception:
            logger.exception("Failed to persist pump event '%s' (station=%s)", action, station_id)
