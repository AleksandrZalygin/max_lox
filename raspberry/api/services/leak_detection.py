import logging
import time
from collections import deque

logger = logging.getLogger(__name__)

LEAK_THRESHOLD_PCT_PER_SEC = 0.05
MOISTURE_DRY_THRESHOLD = 30.0


class LeakDetector:
    def __init__(self) -> None:
        self._history: deque[tuple[float, float]] = deque(maxlen=30)
        self._leak_active: bool = False

    def update(
        self,
        level_pct: float,
        moisture_pct: float | None,
        pumps_on: bool,
    ) -> bool:
        self._history.append((time.time(), level_pct))

        if pumps_on:
            if self._leak_active:
                logger.info("Leak condition cleared — pumps are now ON")
                self._leak_active = False
            return False

        if len(self._history) < 10:
            logger.debug(
                "Not enough history for leak detection yet (%d/10 samples)",
                len(self._history),
            )
            return False

        oldest_ts, oldest_lvl = self._history[0]
        newest_ts, newest_lvl = self._history[-1]
        time_span = newest_ts - oldest_ts

        if time_span < 1.0:
            return False

        drop_rate = (oldest_lvl - newest_lvl) / time_span

        logger.debug(
            "Leak check: drop_rate=%.4f%%/s moisture=%.1f%% pumps=%s level=%.1f%%",
            drop_rate,
            moisture_pct if moisture_pct is not None else -1.0,
            pumps_on,
            level_pct,
        )

        is_leaking = (
            drop_rate > LEAK_THRESHOLD_PCT_PER_SEC
            and moisture_pct is not None
            and moisture_pct < MOISTURE_DRY_THRESHOLD
        )

        if is_leaking and not self._leak_active:
            self._leak_active = True
            logger.error(
                "LEAK DETECTED! drop_rate=%.4f%%/s moisture=%.1f%% level=%.1f%% "
                "(threshold: drop>%.3f%%/s AND moisture<%.0f%%)",
                drop_rate,
                moisture_pct,
                level_pct,
                LEAK_THRESHOLD_PCT_PER_SEC,
                MOISTURE_DRY_THRESHOLD,
            )
            return True

        if not is_leaking and self._leak_active:
            logger.info(
                "Leak condition cleared: drop_rate=%.4f moisture=%.1f",
                drop_rate,
                moisture_pct if moisture_pct is not None else -1.0,
            )
            self._leak_active = False

        return False
