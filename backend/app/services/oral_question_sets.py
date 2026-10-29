"""Oral papers, their independently owned questions, and the selected paper."""
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import inspect, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.models import InterviewSession, OralQuestion, OralQuestionSet, OralQuestionSetSelection, OralQuestionSnapshot, utc_now
from app.schemas import OralQuestionRead, OralQuestionSetCreate, OralQuestionSetRead, OralQuestionSetUpdate


def migrate_oral_question_sets(engine) -> None:
    # create_all does not add columns to an existing SQLite table.
    columns = {column["name"] for column in inspect(engine).get_columns("oral_questions")}
    if "set_id" not in columns:
        with engine.begin() as connection:
            connection.execute(text(
                "ALTER TABLE oral_questions ADD COLUMN set_id VARCHAR(64) REFERENCES oral_question_sets(id)"
            ))
            connection.execute(text("CREATE INDEX IF NOT EXISTS ix_oral_questions_set_id ON oral_questions (set_id)"))
    with Session(engine) as db:
        ensure_initialized(db)


def ensure_initialized(db: Session) -> OralQuestionSetSelection:
    selection = db.get(OralQuestionSetSelection, "global")
    if selection is not None:
        return selection
    from app.services.questions import ensure_seed_oral_questions

    ensure_seed_oral_questions(db)
    existing = db.query(OralQuestion).filter(OralQuestion.set_id.is_(None)).all()
    default = OralQuestionSet(
        id=uuid4().hex, name="默认套题", description="原有口试题已归入此套题，可继续编辑或用于自定义组套。",
        published=any(q.published for q in existing),
    )
    db.add(default)
    db.flush()
    for question in existing:
        question.set_id = default.id
    # This row also records initialization, so deleting a paper never re-seeds it.
    selection = OralQuestionSetSelection(id="global", active_set_id=default.id if default.published else None)
    db.add(selection)
    db.flush()
    freeze_legacy_interviews(db, default)
    db.commit()
    return selection


def freeze_legacy_interviews(db: Session, paper: OralQuestionSet) -> None:
    """Preserve the old role-filtered question order and actual recorded prompts."""
    from app.services.questions import _matches_role

    published = [q for q in paper.questions if q.published]
    sessions = db.query(InterviewSession).filter(InterviewSession.oral_recordings.any()).options(
        selectinload(InterviewSession.oral_recordings),
    ).all()
    for session in sessions:
        matched = [q for q in published if _matches_role(q, session.role)] or published
        questions = [OralQuestionRead.model_validate(q).model_dump(mode="json") for q in matched]
        for recording in session.oral_recordings:
            if recording.question_index < 0:
                continue
            while len(questions) <= recording.question_index:
                questions.append(OralQuestionRead(
                    id=f"legacy-{session.id}-{len(questions)}", set_id=paper.id,
                    title="历史口试题", prompt="历史题干未保存，请联系管理员核对", published=True,
                    sort_order=len(questions), created_at=utc_now(), updated_at=utc_now(),
                ).model_dump(mode="json"))
            if recording.question_text:
                questions[recording.question_index]["prompt"] = recording.question_text
        db.add(OralQuestionSnapshot(session_id=session.id, set_id=paper.id, set_name=paper.name, questions=questions))


def get_set(db: Session, set_id: str) -> OralQuestionSet:
    ensure_initialized(db)
    paper = db.get(OralQuestionSet, set_id)
    if paper is None:
        raise HTTPException(status_code=404, detail="套题不存在")
    return paper


def set_to_read(paper: OralQuestionSet, active_set_id: str | None) -> OralQuestionSetRead:
    return OralQuestionSetRead(
        id=paper.id, name=paper.name, description=paper.description, published=paper.published,
        is_active=paper.id == active_set_id, question_count=len(paper.questions),
        published_question_count=sum(q.published for q in paper.questions),
        created_at=paper.created_at, updated_at=paper.updated_at,
    )


def list_sets(db: Session) -> list[OralQuestionSetRead]:
    selection = ensure_initialized(db)
    papers = db.query(OralQuestionSet).options(selectinload(OralQuestionSet.questions)).order_by(
        OralQuestionSet.created_at.asc(), OralQuestionSet.id.asc(),
    ).all()
    return [set_to_read(paper, selection.active_set_id) for paper in papers]


def create_set(db: Session, payload: OralQuestionSetCreate) -> OralQuestionSetRead:
    selection = ensure_initialized(db)
    sources = {q.id: q for q in db.query(OralQuestion).filter(OralQuestion.id.in_(payload.question_ids)).all()}
    if len(sources) != len(payload.question_ids):
        raise HTTPException(status_code=404, detail="部分来源题目已被删除，请刷新后重新选择")
    paper = OralQuestionSet(id=uuid4().hex, name=payload.name, description=payload.description)
    db.add(paper)
    for index, question_id in enumerate(payload.question_ids):
        source = sources[question_id]
        paper.questions.append(OralQuestion(
            id=uuid4().hex, title=source.title, prompt=source.prompt, role_tags=source.role_tags,
            difficulty=source.difficulty, source="copy", sort_order=index, published=source.published,
        ))
    db.commit()
    db.refresh(paper)
    return set_to_read(paper, selection.active_set_id)


def update_set(db: Session, set_id: str, payload: OralQuestionSetUpdate) -> OralQuestionSetRead:
    selection = ensure_initialized(db)
    paper = get_set(db, set_id)
    if payload.published is False and selection.active_set_id == set_id:
        raise HTTPException(status_code=409, detail="当前套题正在使用，请先切换到其他套题再取消发布")
    if payload.published is True and not any(q.published for q in paper.questions):
        raise HTTPException(status_code=400, detail="请先在套内添加并发布至少一道题目")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(paper, key, value)
    db.commit()
    db.refresh(paper)
    return set_to_read(paper, selection.active_set_id)


def activate_set(db: Session, set_id: str) -> OralQuestionSetRead:
    selection = ensure_initialized(db)
    paper = get_set(db, set_id)
    if not paper.published or not any(q.published for q in paper.questions):
        raise HTTPException(status_code=400, detail="只能使用已发布且包含已发布题目的套题")
    selection.active_set_id = set_id
    db.commit()
    return set_to_read(paper, selection.active_set_id)


def delete_set(db: Session, set_id: str) -> None:
    selection = ensure_initialized(db)
    paper = get_set(db, set_id)
    if selection.active_set_id == set_id:
        raise HTTPException(status_code=409, detail="当前套题正在使用，请先切换到其他套题再删除")
    db.delete(paper)
    db.commit()


def active_questions(db: Session) -> tuple[OralQuestionSet | None, list[OralQuestion]]:
    selection = ensure_initialized(db)
    paper = db.get(OralQuestionSet, selection.active_set_id) if selection.active_set_id else None
    if paper is None or not paper.published:
        return None, []
    return paper, [question for question in paper.questions if question.published]


def protect_last_active_question(db: Session, question: OralQuestion) -> None:
    selection = ensure_initialized(db)
    if selection.active_set_id != question.set_id or not question.published:
        return
    count = db.query(OralQuestion).filter(
        OralQuestion.set_id == question.set_id, OralQuestion.published.is_(True),
    ).count()
    if count <= 1:
        raise HTTPException(status_code=409, detail="当前使用套题至少需要一道已发布题目，请先添加题目或切换套题")


def session_paper(db: Session, session_id: str) -> OralQuestionSnapshot:
    session = db.get(InterviewSession, session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="面试记录不存在")
    snapshot = db.get(OralQuestionSnapshot, session_id)
    if snapshot is not None:
        return snapshot
    paper, questions = active_questions(db)
    if paper is None or not questions:
        raise HTTPException(status_code=409, detail="暂无可用口试套题，请联系管理员发布并选择一套题")
    snapshot = OralQuestionSnapshot(
        session_id=session_id, set_id=paper.id, set_name=paper.name,
        questions=[OralQuestionRead.model_validate(q).model_dump(mode="json") for q in questions],
    )
    db.add(snapshot)
    try:
        db.commit()
    except IntegrityError:
        # Concurrent first loads must both receive the same stored paper.
        db.rollback()
        snapshot = db.get(OralQuestionSnapshot, session_id)
        if snapshot is None:
            raise
    db.refresh(snapshot)
    return snapshot
