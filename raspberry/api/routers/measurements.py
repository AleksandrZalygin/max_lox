import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.database import Measurement, Station, get_db
from models.schemas import MeasurementResponse

router = APIRouter(prefix="/api/stations", tags=["measurements"])

MAX_RETENTION_DAYS = 7


@router.get("/{station_id}/measurements", response_model=list[MeasurementResponse])
async def get_measurements(
    station_id: uuid.UUID,
    from_: datetime | None = Query(None, alias="from"),
    to: datetime | None = Query(None),
    limit: int = Query(1000, ge=1, le=1000),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Station).where(Station.id == station_id))
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Station not found")

    cutoff = datetime.now(tz=timezone.utc) - timedelta(days=MAX_RETENTION_DAYS)
    query_from = max(from_, cutoff) if from_ else cutoff
    query_to = to or datetime.now(tz=timezone.utc)

    result = await db.execute(
        select(Measurement)
        .where(
            Measurement.station_id == station_id,
            Measurement.timestamp >= query_from,
            Measurement.timestamp <= query_to,
        )
        .order_by(Measurement.timestamp.desc())
        .limit(limit)
    )
    return result.scalars().all()
