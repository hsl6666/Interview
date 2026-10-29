from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db import get_db
from app.api.oral_question_sets import router as oral_sets_router
from app.schemas import (
    OralQuestionCreate,
    OralQuestionRead,
    OralQuestionUpdate,
    Question,
    QuestionGenerationRequest,
    QuestionGenerationResponse,
    WrittenQuestionCreate,
    WrittenQuestionRead,
    WrittenQuestionUpdate,
)
from app.services.questions import (
    DEFAULT_SYSTEM_PROMPT,
    create_oral_question,
    create_question,
    delete_oral_question,
    delete_question,
    generate_questions,
    get_oral_questions_for_role,
    get_questions_for_role,
    list_oral_questions,
    list_questions,
    update_oral_question,
    update_question,
)
from app.services.llm_config import LlmConfigError, LlmProviderError

router = APIRouter(tags=["questions"])
router.include_router(oral_sets_router)


@router.get("/api/questions", response_model=list[Question])
def questions(role: str = "", db: Session = Depends(get_db)) -> list[Question]:
    return get_questions_for_role(db, role)


@router.get("/api/oral-questions", response_model=list[OralQuestionRead])
def oral_questions(role: str = "", db: Session = Depends(get_db)) -> list:
    return get_oral_questions_for_role(db, role)


@router.get("/api/admin/written-questions", response_model=list[WrittenQuestionRead])
def admin_list_questions(db: Session = Depends(get_db)) -> list:
    return list_questions(db)


@router.post("/api/admin/written-questions", response_model=WrittenQuestionRead)
def admin_create_question(payload: WrittenQuestionCreate, db: Session = Depends(get_db)):
    return create_question(db, payload)


@router.patch("/api/admin/written-questions/{question_id}", response_model=WrittenQuestionRead)
def admin_update_question(question_id: str, payload: WrittenQuestionUpdate, db: Session = Depends(get_db)):
    question = update_question(db, question_id, payload)
    if question is None:
        raise HTTPException(status_code=404, detail="question not found")
    return question


@router.delete("/api/admin/written-questions/{question_id}")
def admin_delete_question(question_id: str, db: Session = Depends(get_db)) -> dict[str, bool]:
    deleted = delete_question(db, question_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="question not found")
    return {"ok": True}


@router.get("/api/admin/oral-questions", response_model=list[OralQuestionRead])
def admin_list_oral_questions(set_id: str | None = None, db: Session = Depends(get_db)) -> list:
    return list_oral_questions(db, set_id)


@router.post("/api/admin/oral-questions", response_model=OralQuestionRead)
def admin_create_oral_question(payload: OralQuestionCreate, db: Session = Depends(get_db)):
    return create_oral_question(db, payload)


@router.patch("/api/admin/oral-questions/{question_id}", response_model=OralQuestionRead)
def admin_update_oral_question(question_id: str, payload: OralQuestionUpdate, db: Session = Depends(get_db)):
    question = update_oral_question(db, question_id, payload)
    if question is None:
        raise HTTPException(status_code=404, detail="question not found")
    return question


@router.delete("/api/admin/oral-questions/{question_id}")
def admin_delete_oral_question(question_id: str, db: Session = Depends(get_db)) -> dict[str, bool]:
    deleted = delete_oral_question(db, question_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="question not found")
    return {"ok": True}


@router.post("/api/admin/written-questions/generate", response_model=QuestionGenerationResponse)
async def admin_generate_questions(payload: QuestionGenerationRequest, db: Session = Depends(get_db)):
    try:
        questions, fallback_used = await generate_questions(db, payload)
    except LlmConfigError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except LlmProviderError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"题目生成失败：{exc}") from exc
    return QuestionGenerationResponse(
        questions=questions,
        system_prompt=payload.system_prompt or DEFAULT_SYSTEM_PROMPT,
        fallback_used=fallback_used,
    )
