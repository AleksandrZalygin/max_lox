from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

import websockets
import websockets.exceptions

logger = logging.getLogger(__name__)

MAX_BACKOFF = 60.0


class VpsBridge:
    def __init__(self, vps_url: str, api_key: str) -> None:
        self._vps_url = vps_url
        self._api_key = api_key
        self._ws: Any = None
        self._app_state: Any = None
        self._connect_count = 0
        self._send_errors = 0

    async def run_forever(self, app_state: Any) -> None:
        self._app_state = app_state

        if not self._vps_url:
            logger.info("VPS bridge disabled — VPS_WS_URL is not set")
            return

        logger.info("VPS bridge starting, target: %s", self._vps_url)
        backoff = 2.0

        while True:
            try:
                logger.info("VPS bridge connecting... (attempt #%d)", self._connect_count + 1)
                async with websockets.connect(
                    self._vps_url,
                    additional_headers={"X-API-Key": self._api_key},
                ) as ws:
                    self._ws = ws
                    self._connect_count += 1
                    backoff = 2.0
                    logger.info("VPS bridge connected (total connections: %d)", self._connect_count)

                    async for message in ws:
                        try:
                            data = json.loads(message)
                            logger.debug("VPS → Raspberry command: %s", data)
                            await self._handle_command(data)
                        except json.JSONDecodeError:
                            logger.error("VPS sent invalid JSON: %r", message)
                        except Exception:
                            logger.exception("Error handling VPS command: %r", message)

            except websockets.exceptions.InvalidStatus as exc:
                self._ws = None
                logger.error(
                    "VPS rejected connection: HTTP %s — check API_KEY matches on both sides",
                    exc.response.status_code,
                )
            except OSError as exc:
                self._ws = None
                logger.error("VPS bridge network error: %s", exc)
            except Exception as exc:
                self._ws = None
                logger.exception("VPS bridge unexpected error: %s", exc)
            finally:
                self._ws = None

            logger.warning("VPS bridge disconnected — reconnecting in %.0fs (backoff)", backoff)
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, MAX_BACKOFF)

    async def send_state(self, state_dict: dict) -> None:
        if self._ws is None:
            return
        try:
            await self._ws.send(json.dumps(state_dict))
        except Exception:
            self._send_errors += 1
            logger.warning(
                "Failed to send state to VPS (total send errors: %d) — will reconnect",
                self._send_errors,
            )
            self._ws = None

    async def _handle_command(self, data: dict) -> None:
        action = data.get("action")
        station_id = data.get("station_id", "")

        if not action:
            logger.warning("VPS command missing 'action' field: %s", data)
            return

        pump_ctrl = self._app_state.pump_ctrl
        auto_ctrl = self._app_state.auto_ctrl

        if not hasattr(self._app_state, "db_session_factory"):
            logger.error("db_session_factory not available in app_state — cannot execute command")
            return

        logger.info("Executing VPS command: action='%s' station='%s'", action, station_id)

        try:
            async with self._app_state.db_session_factory() as db:
                if action == "pumps_on":
                    await pump_ctrl.set_pumps(True, station_id, db)
                elif action == "pumps_off":
                    await pump_ctrl.set_pumps(False, station_id, db)
                elif action == "set_auto_mode":
                    target = data.get("target_level", 80.0)
                    auto_ctrl.enable(target)
                    logger.info("Auto mode enabled via VPS, target=%.1f%%", target)
                elif action == "set_manual_mode":
                    auto_ctrl.disable()
                    logger.info("Manual mode set via VPS")
                else:
                    logger.warning("Unknown VPS command action: '%s'", action)
        except Exception:
            logger.exception("Error executing VPS command '%s' for station '%s'", action, station_id)
