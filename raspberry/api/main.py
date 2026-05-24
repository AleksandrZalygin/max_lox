import asyncio
import logging
import time
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import delete

from config import settings
from logging_config import setup_logging
from models.database import AsyncSessionLocal, Base, Measurement, engine
from routers.commands import router as commands_router
from routers.measurements import router as measurements_router
from routers.stations import router as stations_router
from routers.websocket import router as websocket_router
from services.auto_mode import AutoModeController
from services.leak_detection import LeakDetector
from services.pump_control import PumpController
from services.vps_bridge import VpsBridge

setup_logging()
logger = logging.getLogger(__name__)


async def _cleanup_old_measurements() -> None:
    while True:
        await asyncio.sleep(3600)
        try:
            async with AsyncSessionLocal() as db:
                cutoff = datetime.now(tz=timezone.utc) - timedelta(days=7)
                result = await db.execute(
                    delete(Measurement).where(Measurement.timestamp < cutoff)
                )
                await db.commit()
                logger.info("Retention cleanup: deleted %d measurements older than 7 days", result.rowcount)
        except Exception:
            logger.exception("Retention cleanup failed — will retry in 1 hour")


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("=== IoT Water Tank API starting ===")
    logger.info("Station ID: %s", settings.STATION_ID)
    logger.info("VPS bridge: %s", settings.VPS_WS_URL or "DISABLED (VPS_WS_URL not set)")

    try:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        logger.info("Database tables verified/created")
    except Exception:
        logger.exception("FATAL: Failed to connect to database — check DATABASE_URL")
        raise

    app.state.pump_ctrl = PumpController()
    app.state.leak_detector = LeakDetector()
    app.state.auto_ctrl = AutoModeController()
    app.state.vps_bridge = VpsBridge(settings.VPS_WS_URL, settings.VPS_API_KEY, settings.STATION_ID)

    app.state.station_live: dict = {}
    app.state.last_moisture: dict = {}
    app.state.last_saved_ts: dict = {}
    app.state.last_vps_ts: dict = {}
    app.state.arduino_connections: dict = {}
    app.state.db_session_factory = AsyncSessionLocal

    asyncio.create_task(app.state.vps_bridge.run_forever(app.state))
    asyncio.create_task(_cleanup_old_measurements())

    logger.info("=== Startup complete. API ready on port 8000. ===")
    yield

    logger.info("Shutting down...")
    await engine.dispose()
    logger.info("Database engine disposed. Goodbye.")


app = FastAPI(title="IoT Water Tank API", version="1.0.0", lifespan=lifespan)


@app.middleware("http")
async def log_requests(request: Request, call_next):
    start = time.perf_counter()
    response = None
    try:
        response = await call_next(request)
        return response
    except Exception:
        logger.exception(
            "Unhandled exception in %s %s", request.method, request.url.path
        )
        return JSONResponse(status_code=500, content={"detail": "Internal server error"})
    finally:
        elapsed_ms = (time.perf_counter() - start) * 1000
        status = response.status_code if response else 500
        level = logging.WARNING if status >= 400 else logging.DEBUG
        logger.log(
            level,
            "HTTP %s %s → %d (%.1f ms)",
            request.method,
            request.url.path,
            status,
            elapsed_ms,
        )


app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(websocket_router)
app.include_router(stations_router)
app.include_router(measurements_router)
app.include_router(commands_router)


@app.get("/health")
async def health():
    return {"status": "ok"}
