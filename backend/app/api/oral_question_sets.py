from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db import get_db
from app.schemas import OralQuestionSetCreate, OralQuestionSetRead, OralQuestionSetUpdate, OralQuestionSnapshotRead
from app.services import oral_question_sets as service

router = APIRouter(tags=["oral-question-sets"])


@router.get("/api/admin/oral-question-sets", response_model=list[OralQuestionSetRead])
def list_sets(db: Session = Depends(get_db)):
    return service.list_sets(db)


@router.post("/api/admin/oral-question-sets", response_model=OralQuestionSetRead)
def create_set(payload: OralQuestionSetCreate, db: Session = Depends(get_db)):
    return service.create_set(db, payload)


@router.patch("/api/admin/oral-question-sets/{set_id}", response_model=OralQuestionSetRead)
def update_set(set_id: str, payload: OralQuestionSetUpdate, db: Session = Depends(get_db)):
    return service.update_set(db, set_id, payload)


@router.post("/api/admin/oral-question-sets/{set_id}/activate", response_model=OralQuestionSetRead)
def activate_set(set_id: str, db: Session = Depends(get_db)):
    return service.activate_set(db, set_id)


@router.delete("/api/admin/oral-question-sets/{set_id}")
def delete_set(set_id: str, db: Session = Depends(get_db)):
    service.delete_set(db, set_id)
    return {"ok": True}


@router.get("/api/sessions/{session_id}/oral-question-set", response_model=OralQuestionSnapshotRead)
def session_paper(session_id: str, db: Session = Depends(get_db)):
    return service.session_paper(db, session_id)
