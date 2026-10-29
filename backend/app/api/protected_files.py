from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.db import get_db
from app.models import AdminLoginSession
from app.services.auth import check_interview_access, require_user

router = APIRouter(tags=["files"])


def protected_file(root: Path, file_path: str, identity: AdminLoginSession, db: Session, settings: Settings, *, question_assets=False):
    root = root.resolve()
    target = (root / file_path).resolve()
    if not target.is_relative_to(root) or not target.is_file():
        raise HTTPException(404, "文件不存在")
    parts = target.relative_to(root).parts
    if not (question_assets and parts and parts[0] == "oral-questions"):
        check_interview_access(parts[0] if parts else "", identity, db, settings)
    media_types = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".pdf": "application/pdf"}
    media_type = media_types.get(target.suffix.lower(), "application/octet-stream")
    return FileResponse(target, media_type=media_type, filename=target.name,
                        content_disposition_type="inline" if media_type != "application/octet-stream" else "attachment",
                        headers={"Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"})


@router.get("/uploads/{file_path:path}")
def uploaded_file(file_path: str, db: Session = Depends(get_db), settings: Settings = Depends(get_settings),
                  identity: AdminLoginSession = Depends(require_user)):
    return protected_file(settings.uploads_dir, file_path, identity, db, settings, question_assets=True)


@router.get("/snapshots/{file_path:path}")
def snapshot_file(file_path: str, db: Session = Depends(get_db), settings: Settings = Depends(get_settings),
                  identity: AdminLoginSession = Depends(require_user)):
    return protected_file(settings.snapshots_dir, file_path, identity, db, settings)
