from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db import get_db
from app.schemas import LlmModelConfigRead, LlmModelConfigUpdate
from app.services.llm_config import get_or_create_model_config, model_config_to_read, update_model_config, test_saved_model_connection

router = APIRouter(tags=["model-config"])


@router.get("/api/admin/model-config", response_model=LlmModelConfigRead)
def get_model_config(db: Session = Depends(get_db)) -> LlmModelConfigRead:
    return model_config_to_read(get_or_create_model_config(db))


@router.put("/api/admin/model-config", response_model=LlmModelConfigRead)
def save_model_config(payload: LlmModelConfigUpdate, db: Session = Depends(get_db)) -> LlmModelConfigRead:
    return model_config_to_read(update_model_config(db, payload))


@router.post("/api/admin/model-config/test")
async def test_model_connection(db: Session = Depends(get_db)) -> dict:
    return await test_saved_model_connection(db)
