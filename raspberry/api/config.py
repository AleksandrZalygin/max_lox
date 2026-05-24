from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    DATABASE_URL: str = "postgresql+asyncpg://water:secret@localhost:5432/waterdb"
    VPS_WS_URL: str = ""
    VPS_API_KEY: str = ""
    STATION_ID: str = "station_001"


settings = Settings()
