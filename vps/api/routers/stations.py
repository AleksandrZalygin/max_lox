import logging

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request

from config import settings
from routers.auth import get_current_user

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["stations"])


@router.get("/stations")
async def list_stations(request: Request, username: str = Depends(get_current_user)):
    states = list(request.app.state.station_states.values())
    logger.debug("GET /api/stations: %d station(s) in memory (user='%s')", len(states), username)
    return states


@router.get("/stations/{station_id}")
async def get_station(station_id: str, request: Request, username: str = Depends(get_current_user)):
    state = request.app.state.station_states.get(station_id)
    if not state:
        logger.warning(
            "GET station %s not found in memory (user='%s') — station may be offline",
            station_id, username,
        )
        raise HTTPException(status_code=404, detail="Station not found or offline")
    logger.debug(
        "GET station %s: level=%.1f%% pumps=%s (user='%s')",
        station_id, state.get("level_pct", 0.0), state.get("pumps"), username,
    )
    return state


@router.post("/stations/{station_id}/commands")
async def send_command(
    station_id: str,
    body: dict,
    request: Request,
    username: str = Depends(get_current_user),
):
    rpi_ws = request.app.state.raspberry_connections.get(station_id)
    if not rpi_ws:
        logger.warning(
            "Command for offline station %s rejected (action='%s' user='%s')",
            station_id, body.get("action"), username,
        )
        raise HTTPException(status_code=503, detail="Station is offline")

    payload = {"type": "command", "station_id": station_id, **body}
    logger.info(
        "Forwarding command to Raspberry: action='%s' station=%s user='%s'",
        body.get("action"), station_id, username,
    )
    try:
        await rpi_ws.send_json(payload)
        logger.debug("Command sent successfully to station %s", station_id)
    except Exception as exc:
        logger.exception(
            "Failed to send command to station %s (action='%s') — removing stale connection",
            station_id, body.get("action"),
        )
        request.app.state.raspberry_connections.pop(station_id, None)
        raise HTTPException(status_code=503, detail=f"Failed to send command: {exc}")
    return {"status": "sent"}


@router.get("/stations/{station_id}/measurements")
async def proxy_measurements(
    station_id: str,
    request: Request,
    username: str = Depends(get_current_user),
):
    params = dict(request.query_params)
    url = f"{settings.RASPBERRY_API_URL}/api/stations/{station_id}/measurements"
    logger.debug(
        "Proxying measurements: station=%s params=%s rpi_url=%s (user='%s')",
        station_id, params, settings.RASPBERRY_API_URL, username,
    )
    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            resp = await client.get(url, params=params)
            data = resp.json()
            logger.debug(
                "Measurements proxy OK: station=%s status=%d rows=%s",
                station_id, resp.status_code,
                len(data) if isinstance(data, list) else "N/A",
            )
            return data
        except Exception as exc:
            logger.error(
                "Measurements proxy FAILED: station=%s url=%s error=%s",
                station_id, url, exc,
            )
            raise HTTPException(status_code=503, detail=f"Could not reach Raspberry: {exc}")


@router.get("/stations/{station_id}/events")
async def proxy_events(
    station_id: str,
    request: Request,
    username: str = Depends(get_current_user),
):
    params = dict(request.query_params)
    url = f"{settings.RASPBERRY_API_URL}/api/stations/{station_id}/events"
    logger.debug(
        "Proxying events: station=%s params=%s (user='%s')",
        station_id, params, username,
    )
    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            resp = await client.get(url, params=params)
            data = resp.json()
            logger.debug(
                "Events proxy OK: station=%s status=%d count=%s",
                station_id, resp.status_code,
                len(data) if isinstance(data, list) else "N/A",
            )
            return data
        except Exception as exc:
            logger.error(
                "Events proxy FAILED: station=%s url=%s error=%s",
                station_id, url, exc,
            )
            raise HTTPException(status_code=503, detail=f"Could not reach Raspberry: {exc}")
