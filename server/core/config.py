from typing import List, Optional
from pydantic_settings import BaseSettings
from pydantic import AnyHttpUrl, validator, Field
import json
from pathlib import Path
import os
class Settings(BaseSettings):
    APP_NAME: str = "FastAPI Backend"
    ENV: str = "development"
    DEBUG: bool = True
    API_PREFIX: str = "/api"
    
    # MongoDB
    MONGODB_URL: str = "mongodb://localhost:27017"
    MONGODB_DB_NAME: str = "mental_sys"
    
    # JWT
    SECRET_KEY: str = "your-super-secret-key-for-development-only"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7
    ALGORITHM: str = "HS256"

    ALLOWED_ORIGINS: List[str] = ["http://localhost:5173"]
    
    # Logging
    LOG_LEVEL: str = "INFO"
    LOG_FORMAT: str = "json"  # options: json, console
    LOG_FILE_PATH: Optional[Path] = None
    ENABLE_FILE_LOGGING: bool = False
    ENABLE_CONSOLE_LOGGING: bool = True
    
    # Elastic APM
    ELASTIC_APM_ENABLED: bool = False
    ELASTIC_APM_SERVER_URL: Optional[str] = None
    ELASTIC_APM_SERVICE_NAME: Optional[str] = None
    ELASTIC_APM_ENVIRONMENT: Optional[str] = None

    #GPT
    GEMINI_API_KEY: Optional[str] = None
    GEMINI_MODEL: Optional[str] = None
    GEMINI_TEXT_MODEL: str = "gemini-3.1-flash-live-preview"
    GEMINI_AUDIO_MODEL: str = "gemini-2.5-flash-native-audio-preview-12-2025"
    DISTRESS_API_KEY: Optional[str] = None

    @validator("DEBUG", pre=True)
    def parse_debug(cls, v):
        if isinstance(v, str) and v.lower() in {"release", "production", "prod"}:
            return False
        return v
    
    @validator("ALLOWED_ORIGINS", pre=True)
    def parse_allowed_origins(cls, v):
        if isinstance(v, str):
            return json.loads(v)
        return v
    
    @validator("LOG_FILE_PATH", pre=True)
    def validate_log_path(cls, v, values):
        if values.get("ENABLE_FILE_LOGGING", False):
            if not v:
                raise ValueError("LOG_FILE_PATH must be set when ENABLE_FILE_LOGGING is True")
            path = Path(v)
            path.parent.mkdir(parents=True, exist_ok=True)
            return path
        return v
    
    class Config:
        case_sensitive = True
        env_file = ".env"

settings = Settings()
