from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from sqlalchemy.ext.asyncio import AsyncSession

if TYPE_CHECKING:
    from services.pump_control import PumpController

logger = logging.getLogger(__name__)

HYSTERESIS = 5.0


class AutoModeController:
    def __init__(self) -> None:
        self._enabled: bool = False
        self._target_level: float = 80.0

    @property
    def enabled(self) -> bool:
        return self._enabled

    @property
    def target_level(self) -> float:
        return self._target_level

    def enable(self, target: float) -> None:
        prev = self._target_level
        self._enabled = True
        self._target_level = float(target)
        if not self._enabled or abs(prev - target) > 0.1:
            logger.info("Auto mode ENABLED, target=%.1f%%", self._target_level)

    def disable(self) -> None:
        if self._enabled:
            logger.info("Auto mode DISABLED (was target=%.1f%%)", self._target_level)
        self._enabled = False

    async def evaluate(
        self,
        level_pct: float,
        pump_ctrl: "PumpController",
        station_id: str,
        db: AsyncSession,
    ) -> None:
        if not self._enabled:
            return

        pumps_on = pump_ctrl.pumps_on
        lower_band = self._target_level - HYSTERESIS
        upper_band = self._target_level + HYSTERESIS

        logger.debug(
            "Auto mode eval: level=%.1f%% target=%.1f%% band=[%.1f, %.1f] pumps=%s (station=%s)",
            level_pct, self._target_level, lower_band, upper_band, pumps_on, station_id,
        )

        if level_pct >= 100.0 and pumps_on:
            logger.info(
                "Auto mode: tank FULL (%.1f%%) — stopping pumps (station=%s)",
                level_pct, station_id,
            )
            await pump_ctrl.set_pumps(False, station_id, db)
            return

        if level_pct < lower_band and not pumps_on:
            logger.info(
                "Auto mode: level %.1f%% below lower band %.1f%% — starting pumps (station=%s)",
                level_pct, lower_band, station_id,
            )
            await pump_ctrl.set_pumps(True, station_id, db)

        elif level_pct > upper_band and pumps_on:
            logger.info(
                "Auto mode: level %.1f%% above upper band %.1f%% — stopping pumps (station=%s)",
                level_pct, upper_band, station_id,
            )
            await pump_ctrl.set_pumps(False, station_id, db)
