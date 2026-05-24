from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    API_KEY: str = "change-me"
    ADMIN_USERNAME: str = "admin"
    ADMIN_PASSWORD_HASH: str = ""  # bcrypt hash
    JWT_SECRET: str = "change-me-jwt-secret"
    RASPBERRY_API_URL: str = "http://192.168.1.100:8000"


settings = Settings()
