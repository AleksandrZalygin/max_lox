import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict


# ── Calibration ───────────────────────────────────────────────────────────────

class CalibrationData(BaseModel):
    distance_empty: float  # cm from sensor to bottom (tank empty)
    distance_full: float   # cm from sensor to surface (tank full)
    length_cm: float
    width_cm: float
    height_cm: float


# ── Station ───────────────────────────────────────────────────────────────────

class StationCreate(BaseModel):
    name: str
    description: str = ""
    calibration: CalibrationData


class StationUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    calibration: CalibrationData | None = None


class StationResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    description: str
    calibration: dict[str, Any]
    created_at: datetime
    # Runtime state (injected from app.state, not from DB)
    level_pct: float | None = None
    volume_l: float | None = None
    moisture_pct: float | None = None
    pumps: bool = False
    mode: str = "manual"
    target_level: float = 80.0


# ── Measurement ───────────────────────────────────────────────────────────────

class MeasurementResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    station_id: uuid.UUID
    timestamp: datetime
    level_pct: float
    volume_l: float
    moisture_raw: int | None
    moisture_pct: float | None


# ── Event ─────────────────────────────────────────────────────────────────────

class EventResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    station_id: uuid.UUID
    timestamp: datetime
    type: str
    payload: dict[str, Any]


# ── WebSocket messages ────────────────────────────────────────────────────────

class ArduinoSensorMessage(BaseModel):
    type: Literal["sensor_data"]
    device: Literal["nano1", "esp32"]
    station_id: str
    distance_cm: float | None = None
    pumps: bool | None = None
    moisture_raw: int | None = None
    moisture_pct: float | None = None


class CommandMessage(BaseModel):
    type: Literal["command"]
    action: Literal["pumps_on", "pumps_off"]


class VpsStateUpdate(BaseModel):
    type: Literal["state_update"] = "state_update"
    station_id: str
    level_pct: float
    volume_l: float
    moisture_pct: float | None
    pumps: bool
    mode: str


class VpsCommand(BaseModel):
    type: Literal["command"]
    station_id: str
    action: Literal["pumps_on", "pumps_off", "set_auto_mode", "set_manual_mode"]
    target_level: float | None = None


# ── REST command bodies ───────────────────────────────────────────────────────

class PumpCommandBody(BaseModel):
    action: Literal["on", "off"]


class ModeCommandBody(BaseModel):
    mode: Literal["auto", "manual"]
    target_level: float | None = None
