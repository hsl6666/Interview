from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, LargeBinary, String, Text
from sqlalchemy.dialects.sqlite import JSON
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class InterviewSession(Base):
    __tablename__ = "sessions"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    role: Mapped[str] = mapped_column(String(120), default="")
    status: Mapped[str] = mapped_column(String(40), default="draft")
    candidate_profile: Mapped[dict] = mapped_column(JSON, default=dict)
    parsed_profile: Mapped[dict] = mapped_column(JSON, default=dict)
    resume_text: Mapped[str] = mapped_column(Text, default="")
    written_submission: Mapped[dict] = mapped_column(JSON, default=dict)
    oral_summary: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now)

    attachments: Mapped[list["Attachment"]] = relationship(
        back_populates="session",
        cascade="all, delete-orphan",
        order_by="Attachment.created_at",
    )
    transcripts: Mapped[list["Transcript"]] = relationship(
        back_populates="session",
        cascade="all, delete-orphan",
        order_by="Transcript.created_at",
    )
    snapshots: Mapped[list["InterviewSnapshot"]] = relationship(
        back_populates="session",
        cascade="all, delete-orphan",
        order_by="InterviewSnapshot.created_at",
    )
    oral_recordings: Mapped[list["OralRecording"]] = relationship(
        back_populates="session",
        cascade="all, delete-orphan",
        order_by="OralRecording.created_at",
    )
    oral_question_snapshot: Mapped["OralQuestionSnapshot | None"] = relationship(
        cascade="all, delete-orphan", uselist=False,
    )


class Attachment(Base):
    __tablename__ = "attachments"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    session_id: Mapped[str] = mapped_column(ForeignKey("sessions.id"), index=True)
    filename: Mapped[str] = mapped_column(String(255))
    content_type: Mapped[str] = mapped_column(String(120), default="")
    file_path: Mapped[str] = mapped_column(String(600))
    url: Mapped[str] = mapped_column(String(600))
    parsed_text: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)

    session: Mapped[InterviewSession] = relationship(back_populates="attachments")


class Transcript(Base):
    __tablename__ = "transcripts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_id: Mapped[str] = mapped_column(ForeignKey("sessions.id"), index=True)
    speaker: Mapped[str] = mapped_column(String(20))
    text: Mapped[str] = mapped_column(Text)
    event_type: Mapped[str] = mapped_column(String(40), default="completed")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)

    session: Mapped[InterviewSession] = relationship(back_populates="transcripts")


class InterviewSnapshot(Base):
    __tablename__ = "interview_snapshots"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    session_id: Mapped[str] = mapped_column(ForeignKey("sessions.id"), index=True)
    filename: Mapped[str] = mapped_column(String(255))
    content_type: Mapped[str] = mapped_column(String(120), default="image/jpeg")
    image_data: Mapped[bytes] = mapped_column(LargeBinary)
    file_path: Mapped[str] = mapped_column(String(600))
    url: Mapped[str] = mapped_column(String(600))
    capture_index: Mapped[int] = mapped_column(Integer, default=0)
    capture_reason: Mapped[str] = mapped_column(String(120), default="random_frame")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)

    session: Mapped[InterviewSession] = relationship(back_populates="snapshots")


class OralRecording(Base):
    __tablename__ = "oral_recordings"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    session_id: Mapped[str] = mapped_column(ForeignKey("sessions.id"), index=True)
    question_index: Mapped[int] = mapped_column(Integer, default=0)
    question_text: Mapped[str] = mapped_column(Text, default="")
    filename: Mapped[str] = mapped_column(String(255))
    content_type: Mapped[str] = mapped_column(String(120), default="audio/webm")
    audio_data: Mapped[bytes] = mapped_column(LargeBinary)
    file_path: Mapped[str] = mapped_column(String(600))
    url: Mapped[str] = mapped_column(String(600))
    duration_seconds: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)

    session: Mapped[InterviewSession] = relationship(back_populates="oral_recordings")


class WrittenQuestion(Base):
    __tablename__ = "written_questions"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    title: Mapped[str] = mapped_column(String(200), default="")
    type: Mapped[str] = mapped_column(String(20), default="short")
    prompt: Mapped[str] = mapped_column(Text, default="")
    options: Mapped[list] = mapped_column(JSON, default=list)
    starter_code: Mapped[str] = mapped_column(Text, default="")
    language: Mapped[str] = mapped_column(String(60), default="typescript")
    role_tags: Mapped[str] = mapped_column(String(400), default="")
    difficulty: Mapped[str] = mapped_column(String(40), default="medium")
    source: Mapped[str] = mapped_column(String(40), default="manual")
    evaluation_points: Mapped[str] = mapped_column(Text, default="")
    published: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now)


class OralQuestion(Base):
    __tablename__ = "oral_questions"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    set_id: Mapped[str | None] = mapped_column(ForeignKey("oral_question_sets.id"), index=True)
    title: Mapped[str] = mapped_column(String(200), default="")
    prompt: Mapped[str] = mapped_column(Text, default="")
    role_tags: Mapped[str] = mapped_column(String(400), default="")
    difficulty: Mapped[str] = mapped_column(String(40), default="medium")
    source: Mapped[str] = mapped_column(String(40), default="manual")
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    published: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now)

    question_set: Mapped["OralQuestionSet"] = relationship(back_populates="questions")


class OralQuestionSet(Base):
    __tablename__ = "oral_question_sets"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text, default="")
    published: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now)
    questions: Mapped[list["OralQuestion"]] = relationship(
        back_populates="question_set", cascade="all, delete-orphan",
        order_by="(OralQuestion.sort_order, OralQuestion.created_at, OralQuestion.id)",
    )


class OralQuestionSetSelection(Base):
    __tablename__ = "oral_question_set_selection"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default="global")
    active_set_id: Mapped[str | None] = mapped_column(ForeignKey("oral_question_sets.id"))


class OralQuestionSnapshot(Base):
    __tablename__ = "oral_question_snapshots"

    session_id: Mapped[str] = mapped_column(ForeignKey("sessions.id"), primary_key=True)
    # Deliberately not a foreign key: historical papers survive source deletion.
    set_id: Mapped[str] = mapped_column(String(64))
    set_name: Mapped[str] = mapped_column(String(200))
    questions: Mapped[list] = mapped_column(JSON)


class JobPosition(Base):
    __tablename__ = "job_positions"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(120), unique=True, index=True)
    description: Mapped[str] = mapped_column(Text, default="")
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now)


class LlmModelConfig(Base):
    __tablename__ = "llm_model_config"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default="global")
    provider: Mapped[str] = mapped_column(String(60), default="zhipu")
    model: Mapped[str] = mapped_column(String(120), default="glm-4.6")
    api_base_url: Mapped[str] = mapped_column(String(600), default="https://open.bigmodel.cn/api/paas/v4")
    api_key: Mapped[str] = mapped_column(Text, default="")
    enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now)


class InterviewFlowConfig(Base):
    __tablename__ = "interview_flow_config"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default="global")
    oral_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    assistant_system_prompt: Mapped[str] = mapped_column(
        Text,
        default="你是面试分析助手。只基于候选人资料、笔试、口试、流程数据、岗位信息和查询结果回答，不做星座、八字、生肖、血型等招聘判断。",
    )
    assistant_user_prompt: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now)


class DailyBriefConfig(Base):
    __tablename__ = "daily_brief_config"
    id: Mapped[str] = mapped_column(String(30), primary_key=True, default="global")
    enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    ai_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    group_name: Mapped[str] = mapped_column(String(120), default="智枢研发中心")
    mention_name: Mapped[str] = mapped_column(String(120), default="何松林")
    mention_user_id: Mapped[str] = mapped_column(String(120), default="")
    webhook_url: Mapped[str] = mapped_column(Text, default="")
    signing_secret: Mapped[str] = mapped_column(Text, default="")
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now)


class DailyBriefRun(Base):
    __tablename__ = "daily_brief_runs"
    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    report_date: Mapped[str] = mapped_column(String(10), index=True)
    kind: Mapped[str] = mapped_column(String(20), default="daily")
    status: Mapped[str] = mapped_column(String(20), default="generating")
    content: Mapped[str] = mapped_column(Text, default="")
    facts: Mapped[dict] = mapped_column(JSON, default=dict)
    summary_mode: Mapped[str] = mapped_column(String(20), default="facts")
    error: Mapped[str] = mapped_column(Text, default="")
    target_group: Mapped[str] = mapped_column(String(120), default="")
    mention_name: Mapped[str] = mapped_column(String(120), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
