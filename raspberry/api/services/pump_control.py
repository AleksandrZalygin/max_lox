from __future__ import annotations

import logging
import uuid
from typing import TYPE_CHECKING

from fastapi import WebSocket
from sqlalchemy.ext.asyncio import AsyncSession

from models.database import Event

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
        logger.info("Arduino WebSocket registered with PumpController")
        self._arduino_ws = ws

    def unregister_arduino(self) -> None:
        logger.info("Arduino WebSocket unregistered from PumpController")
        self._arduino_ws = None

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

        try:
            db.add(Event(station_id=uuid.UUID(station_id), type=action, payload={}))
            await db.commit()
            logger.debug("Event '%s' persisted to DB (station=%s)", action, station_id)
        except Exception:
            logger.exception("Failed to persist pump event '%s' (station=%s)", action, station_id)
