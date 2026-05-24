import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.database import Event, Station, get_db
from models.schemas import EventResponse, ModeCommandBody, PumpCommandBody

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/stations", tags=["commands"])


@router.post("/{station_id}/pumps")
async def control_pumps(
    station_id: uuid.UUID,
    body: PumpCommandBody,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Station).where(Station.id == station_id))
    if not result.scalar_one_or_none():
        logger.warning("Pump command for unknown station: %s", station_id)
        raise HTTPException(status_code=404, detail="Station not found")

    pump_ctrl = request.app.state.pump_ctrl
    sid = str(station_id)
    live = request.app.state.station_live.get(sid, {})
    level_pct = live.get("level_pct")

    logger.info(
        "Pump command received: action='%s' station=%s (current level=%s pumps=%s)",
        body.action, sid,
        f"{level_pct:.1f}%" if level_pct is not None else "unknown",
        pump_ctrl.pumps_on,
    )

    if body.action == "on":
        if level_pct is not None and level_pct >= 100.0:
            logger.warning(
                "Pump ON rejected: tank is full (level=%.1f%%) — station=%s",
                level_pct, sid,
            )
            raise HTTPException(status_code=409, detail="Tank is full — pumps cannot be turned on")
        await pump_ctrl.set_pumps(True, sid, db)
        db.add(Event(station_id=station_id, type="fill_start", payload={"level_pct": level_pct}))
        await db.commit()
        logger.info("fill_start event logged (station=%s level=%s)", sid, level_pct)
    else:
        await pump_ctrl.set_pumps(False, sid, db)
        db.add(Event(station_id=station_id, type="fill_stop", payload={"level_pct": level_pct}))
        await db.commit()
        logger.info("fill_stop event logged (station=%s level=%s)", sid, level_pct)

    return {"pumps": pump_ctrl.pumps_on, "station_id": sid}


@router.post("/{station_id}/mode")
async def set_mode(
    station_id: uuid.UUID,
    body: ModeCommandBody,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Station).where(Station.id == station_id))
    if not result.scalar_one_or_none():
        logger.warning("Mode command for unknown station: %s", station_id)
        raise HTTPException(status_code=404, detail="Station not found")

    auto_ctrl = request.app.state.auto_ctrl
    sid = str(station_id)

    if body.mode == "auto":
        target = body.target_level if body.target_level is not None else 80.0
        logger.info("Auto mode requested: target=%.1f%% station=%s", target, sid)
        auto_ctrl.enable(target)
        db.add(Event(station_id=station_id, type="auto_mode_on", payload={"target_level": target}))
    else:
        logger.info("Manual mode requested: station=%s", sid)
        auto_ctrl.disable()
        db.add(Event(station_id=station_id, type="auto_mode_off", payload={}))

    await db.commit()

    if sid in request.app.state.station_live:
        request.app.state.station_live[sid]["mode"] = body.mode
        if body.mode == "auto" and body.target_level:
            request.app.state.station_live[sid]["target_level"] = body.target_level

    return {"mode": body.mode, "target_level": auto_ctrl.target_level, "station_id": sid}


@router.get("/{station_id}/events", response_model=list[EventResponse])
async def get_events(
    station_id: uuid.UUID,
    limit: int = 50,
    type_filter: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Station).where(Station.id == station_id))
    if not result.scalar_one_or_none():
        logger.warning("Events requested for unknown station: %s", station_id)
        raise HTTPException(status_code=404, detail="Station not found")

    logger.debug(
        "Events query: station=%s limit=%d filter=%s",
        station_id, limit, type_filter or "none",
    )

    query = select(Event).where(Event.station_id == station_id)
    if type_filter:
        query = query.where(Event.type == type_filter)
    query = query.order_by(Event.timestamp.desc()).limit(limit)

    result = await db.execute(query)
    events = result.scalars().all()
    logger.debug("Returning %d event(s) for station=%s", len(events), station_id)
    return events
