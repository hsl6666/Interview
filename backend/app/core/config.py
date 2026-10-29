from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "AI Interviewer"
    environment: str = "development"
    database_url: str = "sqlite:///./data/interviewer.db"
    public_base_url: str = "http://127.0.0.1:8000"
    frontend_origin: str = "http://127.0.0.1:5173"
    uploads_dir: Path = Path("./data/uploads")
    snapshots_dir: Path = Path("./data/snapshots")
    oral_recordings_dir: Path = Path("./data/oral_recordings")
    linuxdo_client_id: str = ""
    linuxdo_client_secret: str = ""
    linuxdo_redirect_uri: str = ""
    linuxdo_admin_ids: str = ""
    auth_session_hours: int = 12
    zhipu_api_key: str = ""
    glm_model: str = "glm-4.6"
    interview_minutes: int = 30
    written_exam_minutes: int = 30

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")


@lru_cache
def get_settings() -> Settings:
    settings = Settings()
    settings.uploads_dir.mkdir(parents=True, exist_ok=True)
    settings.snapshots_dir.mkdir(parents=True, exist_ok=True)
    settings.oral_recordings_dir.mkdir(parents=True, exist_ok=True)
    return settings
