import logging
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from logging_config import setup_logging
from routers.auth import router as auth_router
from routers.stations import router as stations_router
from routers.websocket import router as websocket_router

setup_logging()
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("=== IoT Water Tank VPS API starting ===")
    logger.info("In-memory state only — no database on this node")

    app.state.station_states: dict[str, dict] = {}
    app.state.raspberry_connections: dict[str, WebSocket] = {}
    app.state.browser_connections: set[WebSocket] = set()

    logger.info("=== VPS API ready ===")
    yield

    logger.info(
        "Shutting down — stations online: %d  browser clients: %d",
        len(app.state.raspberry_connections),
        len(app.state.browser_connections),
    )


app = FastAPI(title="IoT Water Tank VPS API", version="1.0.0", lifespan=lifespan)


@app.middleware("http")
async def log_requests(request: Request, call_next):
    start = time.perf_counter()
    response = None
    try:
        response = await call_next(request)
        return response
    except Exception:
        logger.exception("Unhandled exception in %s %s", request.method, request.url.path)
        return JSONResponse(status_code=500, content={"detail": "Internal server error"})
    finally:
        elapsed_ms = (time.perf_counter() - start) * 1000
        status = response.status_code if response else 500
        level = logging.WARNING if status >= 400 else logging.DEBUG
        logger.log(
            level,
            "HTTP %s %s → %d (%.1f ms)",
            request.method, request.url.path, status, elapsed_ms,
        )


app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(websocket_router)
app.include_router(stations_router)


@app.get("/health")
async def health():
    stations_online = len(app.state.raspberry_connections)
    browser_clients = len(app.state.browser_connections)
    logger.debug("Health check: stations_online=%d browser_clients=%d", stations_online, browser_clients)
    return {
        "status": "ok",
        "stations_online": stations_online,
        "browser_clients": browser_clients,
    }
