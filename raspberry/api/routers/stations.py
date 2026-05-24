import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.database import Station, get_db
from models.schemas import StationCreate, StationResponse, StationUpdate

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/stations", tags=["stations"])


def _enrich(station: Station, request: Request) -> StationResponse:
    live = request.app.state.station_live.get(str(station.id), {})
    return StationResponse(
        id=station.id,
        name=station.name,
        description=station.description,
        calibration=station.calibration or {},
        created_at=station.created_at,
        level_pct=live.get("level_pct"),
        volume_l=live.get("volume_l"),
        moisture_pct=live.get("moisture_pct"),
        pumps=live.get("pumps", False),
        mode=live.get("mode", "manual"),
        target_level=live.get("target_level", 80.0),
    )


@router.get("", response_model=list[StationResponse])
async def list_stations(request: Request, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Station).order_by(Station.created_at))
    stations = result.scalars().all()
    logger.debug("Listing %d station(s)", len(stations))
    return [_enrich(s, request) for s in stations]


@router.post("", response_model=StationResponse, status_code=201)
async def create_station(body: StationCreate, request: Request, db: AsyncSession = Depends(get_db)):
    logger.info(
        "Creating station: name='%s' description='%s' calibration=%s",
        body.name, body.description, body.calibration.model_dump(),
    )
    station = Station(
        name=body.name,
        description=body.description,
        calibration=body.calibration.model_dump(),
    )
    db.add(station)
    await db.commit()
    await db.refresh(station)
    logger.info("Station created: id=%s name='%s'", station.id, station.name)
    return _enrich(station, request)


@router.get("/{station_id}", response_model=StationResponse)
async def get_station(station_id: uuid.UUID, request: Request, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Station).where(Station.id == station_id))
    station = result.scalar_one_or_none()
    if not station:
        logger.warning("GET station not found: %s", station_id)
        raise HTTPException(status_code=404, detail="Station not found")
    live = request.app.state.station_live.get(str(station_id), {})
    logger.debug(
        "GET station %s: level=%s pumps=%s mode=%s",
        station_id,
        f"{live['level_pct']:.1f}%" if "level_pct" in live else "N/A",
        live.get("pumps", "N/A"),
        live.get("mode", "N/A"),
    )
    return _enrich(station, request)


@router.patch("/{station_id}", response_model=StationResponse)
async def update_station(
    station_id: uuid.UUID,
    body: StationUpdate,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Station).where(Station.id == station_id))
    station = result.scalar_one_or_none()
    if not station:
        logger.warning("PATCH station not found: %s", station_id)
        raise HTTPException(status_code=404, detail="Station not found")

    changes: list[str] = []
    if body.name is not None:
        changes.append(f"name='{body.name}'")
        station.name = body.name
    if body.description is not None:
        changes.append(f"description='{body.description}'")
        station.description = body.description
    if body.calibration is not None:
        changes.append(f"calibration={body.calibration.model_dump()}")
        station.calibration = body.calibration.model_dump()

    logger.info("Updating station %s: %s", station_id, ", ".join(changes) or "no changes")
    await db.commit()
    await db.refresh(station)
    return _enrich(station, request)


@router.delete("/{station_id}", status_code=204)
async def delete_station(station_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Station).where(Station.id == station_id))
    station = result.scalar_one_or_none()
    if not station:
        logger.warning("DELETE station not found: %s", station_id)
        raise HTTPException(status_code=404, detail="Station not found")
    logger.warning("Deleting station: id=%s name='%s'", station.id, station.name)
    await db.delete(station)
    await db.commit()
    logger.info("Station deleted: id=%s", station_id)
