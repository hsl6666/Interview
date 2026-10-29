from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import HTMLResponse, Response
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from app.core.config import get_settings
from app.services.auth import require_user, check_interview_access
from app.models import AdminLoginSession, InterviewOwnership
from app.db import get_db
from app.models import Attachment, InterviewSession, InterviewSnapshot, OralRecording, Transcript
from app.schemas import (
    OralRespondRequest,
    OralStartRequest,
    OralSummaryRequest,
    SessionCreate,
    SessionRead,
    SessionUpdate,
    WrittenExamSubmission,
)
from app.services.interview_graph import InterviewInput, generate_interview_reply
from app.services.interview_config import get_or_create_interview_config
from app.services.resume_parser import extract_text_from_file, merge_parsed_profile
from app.services.serializers import session_to_read

router = APIRouter(tags=["sessions"])


@router.post("/api/sessions", response_model=SessionRead)
def create_session(payload: SessionCreate, db: Session = Depends(get_db), identity: AdminLoginSession = Depends(require_user), settings = Depends(get_settings)) -> SessionRead:
    session_id = payload.session_id or uuid4().hex
    if session_id == "oral-questions":
        raise HTTPException(422, "无效的面试编号")
    session = db.get(InterviewSession, session_id)
    profile = payload.candidate_profile.model_dump()
    if session is None:
        session = InterviewSession(
            id=session_id,
            role=payload.role or profile.get("role", ""),
            candidate_profile=profile,
        )
        db.add(session)
        session.ownership = InterviewOwnership(user_id=identity.user_id)
    else:
        check_interview_access(session_id, identity, db, settings)
        session.role = payload.role or profile.get("role", session.role)
        session.candidate_profile = profile
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        session = db.get(InterviewSession, session_id)
        if session is None:
            raise
        check_interview_access(session_id, identity, db, settings)
        session.role = payload.role or profile.get("role", session.role)
        session.candidate_profile = profile
        db.commit()
    db.refresh(session)
    return session_to_read(session)


@router.get("/api/sessions/{session_id}", response_model=SessionRead)
def get_session(session_id: str, db: Session = Depends(get_db)) -> SessionRead:
    return session_to_read(_get_session_or_404(session_id, db))


@router.patch("/api/sessions/{session_id}", response_model=SessionRead)
def update_session(session_id: str, payload: SessionUpdate, db: Session = Depends(get_db)) -> SessionRead:
    session = _get_session_or_404(session_id, db)
    if payload.role is not None:
        session.role = payload.role
    if payload.candidate_profile is not None:
        session.candidate_profile = payload.candidate_profile.model_dump()
        session.role = payload.role or payload.candidate_profile.role or session.role
    if payload.status is not None:
        session.status = payload.status
    db.commit()
    db.refresh(session)
    return session_to_read(session)


@router.post("/api/sessions/{session_id}/attachments", response_model=SessionRead)
async def upload_attachment(
    session_id: str,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
) -> SessionRead:
    settings = get_settings()
    session = _get_session_or_404(session_id, db)
    upload_dir = settings.uploads_dir / session_id
    upload_dir.mkdir(parents=True, exist_ok=True)
    filename = _safe_filename(file.filename or "attachment")
    stored_name = f"{uuid4().hex}_{filename}"
    file_path = upload_dir / stored_name
    content = await file.read()
    file_path.write_bytes(content)

    parsed_text = await run_in_threadpool(
        extract_text_from_file,
        file_path,
        file.content_type or "",
    )
    resume_text, parsed_profile = merge_parsed_profile(session.resume_text or "", parsed_text)
    attachment = Attachment(
        id=uuid4().hex,
        session_id=session_id,
        filename=filename,
        content_type=file.content_type or "application/octet-stream",
        file_path=str(file_path),
        url=f"/uploads/{session_id}/{stored_name}",
        parsed_text=parsed_text,
    )
    session.resume_text = resume_text
    session.parsed_profile = {**(session.parsed_profile or {}), **parsed_profile}
    db.add(attachment)
    db.commit()
    db.refresh(session)
    return session_to_read(session)


@router.post("/api/sessions/{session_id}/written-submission", response_model=SessionRead)
def save_written_submission(
    session_id: str,
    payload: WrittenExamSubmission,
    db: Session = Depends(get_db),
) -> SessionRead:
    session = _get_session_or_404(session_id, db)
    flow_config = get_or_create_interview_config(db)
    session.status = "written_submitted" if flow_config.oral_enabled else "completed"
    session.written_submission = payload.model_dump(mode="json")
    db.commit()
    db.refresh(session)
    return session_to_read(session)


@router.post("/api/sessions/{session_id}/snapshots", response_model=SessionRead)
async def upload_snapshot(
    session_id: str,
    capture_index: int = Form(0),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
) -> SessionRead:
    settings = get_settings()
    session = _get_session_or_404(session_id, db)
    snapshot_dir = settings.snapshots_dir / session_id
    snapshot_dir.mkdir(parents=True, exist_ok=True)
    filename = f"snapshot_{capture_index}_{uuid4().hex}.jpg"
    file_path = snapshot_dir / filename
    image_data = await file.read()
    file_path.write_bytes(image_data)
    snapshot_id = uuid4().hex
    snapshot = InterviewSnapshot(
        id=snapshot_id,
        session_id=session_id,
        filename=filename,
        content_type=file.content_type or "image/jpeg",
        image_data=image_data,
        file_path=str(file_path),
        url=f"/api/sessions/{session_id}/snapshots/{snapshot_id}/image",
        capture_index=capture_index,
    )
    db.add(snapshot)
    db.commit()
    db.refresh(session)
    return session_to_read(session)


@router.get("/api/sessions/{session_id}/snapshots/{snapshot_id}/image")
def get_snapshot_image(session_id: str, snapshot_id: str, db: Session = Depends(get_db)) -> Response:
    snapshot = db.get(InterviewSnapshot, snapshot_id)
    if snapshot is None or snapshot.session_id != session_id:
        raise HTTPException(status_code=404, detail="snapshot not found")
    return Response(content=snapshot.image_data, media_type=snapshot.content_type)


@router.post("/api/sessions/{session_id}/oral-recordings", response_model=SessionRead)
async def upload_oral_recording(
    session_id: str,
    question_index: int = Form(...),
    question_text: str = Form(""),
    duration_seconds: int = Form(0),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
) -> SessionRead:
    flow_config = get_or_create_interview_config(db)
    if not flow_config.oral_enabled:
        raise HTTPException(status_code=400, detail="oral interview disabled")
    settings = get_settings()
    session = _get_session_or_404(session_id, db)
    recording_dir = settings.oral_recordings_dir / session_id
    recording_dir.mkdir(parents=True, exist_ok=True)
    filename = _safe_filename(file.filename or f"question_{question_index}.webm")
    stored_name = f"{uuid4().hex}_{filename}"
    file_path = recording_dir / stored_name
    audio_data = await file.read()
    file_path.write_bytes(audio_data)
    recording_id = uuid4().hex
    recording = OralRecording(
        id=recording_id,
        session_id=session_id,
        question_index=question_index,
        question_text=question_text,
        filename=filename,
        content_type=file.content_type or "audio/webm",
        audio_data=audio_data,
        file_path=str(file_path),
        url=f"/api/sessions/{session_id}/oral-recordings/{recording_id}/audio",
        duration_seconds=max(duration_seconds, 0),
    )
    db.add(recording)
    session.status = "oral_started"
    db.commit()
    db.refresh(session)
    return session_to_read(session)


@router.get("/api/sessions/{session_id}/oral-recordings/{recording_id}/audio")
def get_oral_recording_audio(session_id: str, recording_id: str, db: Session = Depends(get_db)) -> Response:
    recording = db.get(OralRecording, recording_id)
    if recording is None or recording.session_id != session_id:
        raise HTTPException(status_code=404, detail="recording not found")
    return Response(content=recording.audio_data, media_type=recording.content_type)


@router.delete("/api/sessions/{session_id}/oral-recordings/{recording_id}", status_code=204)
def delete_oral_recording(session_id: str, recording_id: str, db: Session = Depends(get_db)) -> None:
    recording = db.get(OralRecording, recording_id)
    if recording is None or recording.session_id != session_id:
        raise HTTPException(status_code=404, detail="recording not found")

    file_path = Path(recording.file_path)
    db.delete(recording)
    db.commit()
    if file_path.exists():
        file_path.unlink(missing_ok=True)


@router.post("/api/sessions/{session_id}/oral/start")
async def start_oral_interview(
    session_id: str,
    payload: OralStartRequest,
    db: Session = Depends(get_db),
):
    if payload.session_id != session_id:
        raise HTTPException(status_code=400, detail="session id mismatch")
    flow_config = get_or_create_interview_config(db)
    if not flow_config.oral_enabled:
        raise HTTPException(status_code=400, detail="oral interview disabled")
    session = _get_session_or_404(session_id, db)
    text, stage = await generate_interview_reply(
        InterviewInput(
            role=session.role,
            resume_summary=session.resume_text or str(session.parsed_profile or {}),
            conversation_history=_history(session),
        ),
        db,
    )
    db.add(Transcript(session_id=session_id, speaker="assistant", text=text, event_type="completed"))
    session.status = "oral_started"
    db.commit()
    return {"assistant_text": text, "stage": stage}


@router.post("/api/sessions/{session_id}/oral/respond")
async def respond_oral_interview(
    session_id: str,
    payload: OralRespondRequest,
    db: Session = Depends(get_db),
):
    if payload.session_id != session_id:
        raise HTTPException(status_code=400, detail="session id mismatch")
    flow_config = get_or_create_interview_config(db)
    if not flow_config.oral_enabled:
        raise HTTPException(status_code=400, detail="oral interview disabled")
    session = _get_session_or_404(session_id, db)
    db.add(Transcript(session_id=session_id, speaker="user", text=payload.text, event_type="completed"))
    db.flush()
    db.refresh(session)
    text, stage = await generate_interview_reply(
        InterviewInput(
            role=session.role,
            resume_summary=session.resume_text or str(session.parsed_profile or {}),
            conversation_history=_history(session) + [{"speaker": "user", "text": payload.text}],
        ),
        db,
    )
    db.add(Transcript(session_id=session_id, speaker="assistant", text=text, event_type="completed"))
    db.commit()
    return {"assistant_text": text, "stage": stage}


@router.post("/api/sessions/{session_id}/oral-summary", response_model=SessionRead)
def save_oral_summary(
    session_id: str,
    payload: OralSummaryRequest,
    db: Session = Depends(get_db),
) -> SessionRead:
    if payload.session_id != session_id:
        raise HTTPException(status_code=400, detail="session id mismatch")
    flow_config = get_or_create_interview_config(db)
    if not flow_config.oral_enabled:
        raise HTTPException(status_code=400, detail="oral interview disabled")
    session = _get_session_or_404(session_id, db)
    session.status = "completed"
    session.oral_summary = payload.model_dump(mode="json")
    db.commit()
    db.refresh(session)
    return session_to_read(session)


@router.get("/m/upload", response_class=HTMLResponse)
def mobile_upload_page(sessionId: str = Query(..., pattern=r"^[A-Za-z0-9_-]{1,64}$")) -> HTMLResponse:
    return HTMLResponse(
        f"""
<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>手机上传简历</title>
  <style>
    body {{ margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f7f7f4; color: #18181b; }}
    main {{ max-width: 480px; margin: 0 auto; padding: 32px 20px; }}
    section {{ background: white; border: 1px solid #e7e5df; border-radius: 18px; padding: 22px; box-shadow: 0 18px 45px rgba(30, 30, 25, .08); }}
    h1 {{ margin: 0 0 8px; font-size: 24px; }}
    p {{ color: #62625f; line-height: 1.6; }}
    input, button {{ width: 100%; box-sizing: border-box; margin-top: 16px; }}
    input {{ padding: 14px; border: 1px dashed #a8a29e; border-radius: 12px; background: #fafaf9; }}
    button {{ border: 0; border-radius: 12px; padding: 14px 16px; background: #14532d; color: white; font-weight: 700; }}
    #status {{ min-height: 24px; margin-top: 14px; color: #166534; }}
  </style>
</head>
<body>
  <main>
    <section>
      <h1>上传简历</h1>
      <p>请在手机上选择简历文件上传。上传完成后，电脑端表单会自动刷新并继续识别回填。</p>
      <input id="file" type="file" accept=".pdf,.doc,.docx,image/*,.txt" />
      <button id="submit">上传</button>
      <div id="status"></div>
    </section>
  </main>
  <script>
    const sessionId = {sessionId!r};
    document.getElementById("submit").addEventListener("click", async () => {{
      const file = document.getElementById("file").files[0];
      if (!file) {{
        document.getElementById("status").textContent = "请先选择文件";
        return;
      }}
      const form = new FormData();
      form.append("file", file);
      document.getElementById("status").textContent = "上传中...";
      const res = await fetch(`/api/sessions/${{sessionId}}/attachments`, {{ method: "POST", body: form }});
      document.getElementById("status").textContent = res.ok ? "上传完成，可以回到电脑端继续" : "上传失败，请重试";
    }});
  </script>
</body>
</html>
        """
    )


def _get_session_or_404(session_id: str, db: Session) -> InterviewSession:
    session = db.get(InterviewSession, session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="session not found")
    return session


def _safe_filename(filename: str) -> str:
    keep = [char for char in Path(filename).name if char.isalnum() or char in {".", "-", "_", " "}]
    return "".join(keep).strip() or "attachment"


def _history(session: InterviewSession) -> list[dict[str, str]]:
    return [{"speaker": item.speaker, "text": item.text} for item in session.transcripts]
