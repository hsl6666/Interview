from __future__ import annotations

import json
import re
from uuid import uuid4

from sqlalchemy.orm import Session

from app.models import OralQuestion, WrittenQuestion
from app.schemas import (
    OralQuestionCreate,
    OralQuestionUpdate,
    Question,
    QuestionGenerationRequest,
    QuestionOption,
    WrittenQuestionCreate,
    WrittenQuestionUpdate,
)
from app.services.llm_config import LlmProviderError, chat_completion
from app.services.oral_question_sets import active_questions, ensure_initialized, get_set, protect_last_active_question


DEFAULT_SYSTEM_PROMPT = (
    "你是企业招聘场景中的笔试题生成智能体。"
    "你只生成结构化 JSON，不输出解释。"
    "题目要能评估候选人的工程判断、代码能力、问题拆解能力和表达能力。"
    "题干必须清晰，选项必须互斥，代码题必须给 starter_code。"
)


def get_questions_for_role(db: Session, role: str) -> list[Question]:
    ensure_seed_questions(db)
    published = db.query(WrittenQuestion).filter(WrittenQuestion.published.is_(True)).order_by(WrittenQuestion.created_at.asc()).all()
    matched = [item for item in published if _matches_role(item, role)]
    return [_to_question(item) for item in (matched or published)]


def get_oral_questions_for_role(db: Session, role: str) -> list[OralQuestion]:
    # Selection is now by whole paper. Keep the role argument for existing clients.
    return active_questions(db)[1]


def list_questions(db: Session) -> list[WrittenQuestion]:
    ensure_seed_questions(db)
    return db.query(WrittenQuestion).order_by(WrittenQuestion.updated_at.desc()).all()


def list_oral_questions(db: Session, set_id: str | None = None) -> list[OralQuestion]:
    ensure_initialized(db)
    query = db.query(OralQuestion)
    if set_id is not None:
        get_set(db, set_id)
        query = query.filter(OralQuestion.set_id == set_id)
    return query.order_by(OralQuestion.sort_order.asc(), OralQuestion.created_at.asc(), OralQuestion.id.asc()).all()


def create_question(db: Session, payload: WrittenQuestionCreate) -> WrittenQuestion:
    question = WrittenQuestion(id=uuid4().hex, **payload.model_dump(mode="json"))
    db.add(question)
    db.commit()
    db.refresh(question)
    return question


def update_question(db: Session, question_id: str, payload: WrittenQuestionUpdate) -> WrittenQuestion | None:
    question = db.get(WrittenQuestion, question_id)
    if question is None:
        return None
    for key, value in payload.model_dump(exclude_unset=True, mode="json").items():
        setattr(question, key, value)
    db.commit()
    db.refresh(question)
    return question


def delete_question(db: Session, question_id: str) -> bool:
    question = db.get(WrittenQuestion, question_id)
    if question is None:
        return False
    db.delete(question)
    db.commit()
    return True


def create_oral_question(db: Session, payload: OralQuestionCreate) -> OralQuestion:
    get_set(db, payload.set_id)
    question = OralQuestion(id=uuid4().hex, **payload.model_dump(mode="json"))
    db.add(question)
    db.commit()
    db.refresh(question)
    return question


def update_oral_question(db: Session, question_id: str, payload: OralQuestionUpdate) -> OralQuestion | None:
    question = db.get(OralQuestion, question_id)
    if question is None:
        return None
    if payload.published is False:
        protect_last_active_question(db, question)
    for key, value in payload.model_dump(exclude_unset=True, mode="json").items():
        setattr(question, key, value)
    db.commit()
    db.refresh(question)
    return question


def delete_oral_question(db: Session, question_id: str) -> bool:
    question = db.get(OralQuestion, question_id)
    if question is None:
        return False
    protect_last_active_question(db, question)
    db.delete(question)
    db.commit()
    return True


async def generate_questions(db: Session, payload: QuestionGenerationRequest) -> tuple[list[Question], bool]:
    prompt = _build_generation_prompt(payload)
    content = await chat_completion(
        db,
        messages=[
            {"role": "system", "content": payload.system_prompt or DEFAULT_SYSTEM_PROMPT},
            {"role": "user", "content": prompt},
        ],
        temperature=0.45,
        timeout=60,
        require_config=True,
    )
    if not content:
        raise LlmProviderError("模型未返回内容")

    try:
        questions = _parse_generated_questions(content)
    except Exception as exc:
        raise LlmProviderError("模型返回内容无法解析为题目 JSON，请调整提示词后重试") from exc

    if not questions:
        raise LlmProviderError("模型返回内容未包含有效题目，请调整提示词后重试")
    return questions[: payload.count], False


def ensure_seed_questions(db: Session) -> None:
    if db.query(WrittenQuestion).first() is not None:
        return
    for item in _seed_questions():
        db.add(WrittenQuestion(id=item.id, **_question_dump(item), role_tags="通用", difficulty="medium", source="seed", published=True))
    db.commit()


def ensure_seed_oral_questions(db: Session) -> None:
    if db.query(OralQuestion).first() is not None:
        return
    for index, item in enumerate(_seed_oral_questions()):
        db.add(
            OralQuestion(
                id=f"oral-seed-{index + 1}",
                title=f"口试问题 {index + 1}",
                prompt=item,
                role_tags="通用",
                difficulty="medium",
                source="seed",
                sort_order=index,
                published=True,
            )
        )
    db.commit()


def _seed_questions() -> list[Question]:
    return [
        Question(
            id="q-single-architecture",
            title="系统拆解能力",
            type="single",
            prompt="当你接到一个新的技术需求时，第一步最应该确认什么？",
            options=[
                QuestionOption(label="直接开始写核心代码", value="code_first"),
                QuestionOption(label="确认目标、边界、验收标准和风险", value="scope_first"),
                QuestionOption(label="先选最新技术栈", value="tech_first"),
                QuestionOption(label="等需求完全稳定再启动", value="wait"),
            ],
        ),
        Question(
            id="q-multi-quality",
            title="工程质量判断",
            type="multi",
            prompt="以下哪些属于生产级交付前应重点检查的事项？",
            options=[
                QuestionOption(label="关键路径测试", value="tests"),
                QuestionOption(label="日志与错误处理", value="observability"),
                QuestionOption(label="敏感配置硬编码", value="hardcode_secret"),
                QuestionOption(label="数据模型迁移策略", value="migration"),
            ],
        ),
        Question(
            id="q-short-project",
            title="项目复盘",
            type="short",
            prompt="描述一个你主导或深度参与的项目，说明你的职责、关键难点、取舍和最终结果。",
        ),
        Question(
            id="q-code-open",
            title="代码题：合并区间",
            type="code",
            prompt="给定若干闭区间，合并所有重叠区间并按起点升序返回。",
            language="typescript",
            starter_code=(
                "export function mergeIntervals(intervals: Array<[number, number]>): Array<[number, number]> {\n"
                "  // TODO: 合并重叠区间\n"
                "  return [];\n"
                "}\n"
            ),
        ),
    ]


def _seed_oral_questions() -> list[str]:
    return [
        "请用 1 分钟介绍你最近最能代表能力的项目。",
        "请说明这个项目中最困难的技术问题、你的解决方案和最终结果。",
        "如果线上接口 P95 延迟从 200ms 升到 2s，你会如何定位？",
        "请描述一次你和团队成员产生明显分歧，并最终推进解决的经历。",
        "如果入职后第一个月只能完成一件最能证明你价值的事，你会选择什么，为什么？",
    ]


def _fallback_generated_questions(payload: QuestionGenerationRequest) -> list[Question]:
    role = payload.role or "目标岗位"
    types = payload.question_types or ["single", "multi", "short", "code"]
    templates: list[Question] = [
        Question(
            id=f"ai-{uuid4().hex}",
            title=f"{role} 场景判断",
            type="single",
            prompt=f"在 {role} 工作中遇到需求边界不清时，最合理的第一步是什么？",
            options=[
                QuestionOption(label="先明确目标、约束、验收标准和风险", value="clarify"),
                QuestionOption(label="直接按经验实现", value="implement"),
                QuestionOption(label="等待所有人给出完整文档", value="wait"),
                QuestionOption(label="只关注技术选型", value="tech_only"),
            ],
        ),
        Question(
            id=f"ai-{uuid4().hex}",
            title=f"{role} 质量控制",
            type="multi",
            prompt=f"交付一个 {role} 相关功能前，哪些动作有助于降低生产风险？",
            options=[
                QuestionOption(label="覆盖核心路径测试", value="tests"),
                QuestionOption(label="补充异常日志和监控", value="observability"),
                QuestionOption(label="梳理数据兼容和回滚方案", value="rollback"),
                QuestionOption(label="跳过评审以提升速度", value="skip_review"),
            ],
        ),
        Question(
            id=f"ai-{uuid4().hex}",
            title=f"{role} 项目复盘",
            type="short",
            prompt=f"请复盘一个最能体现你 {role} 能力的项目，说明背景、职责、难点、取舍和结果。",
        ),
        Question(
            id=f"ai-{uuid4().hex}",
            title=f"{role} 代码题",
            type="code",
            prompt="实现 normalizeScores(items)，过滤无效 score，按 score 降序返回 id 列表。",
            language="typescript",
            starter_code=(
                "type Item = { id: string; score?: number | null };\n\n"
                "export function normalizeScores(items: Item[]): string[] {\n"
                "  // TODO: 过滤无效 score，并按 score 降序返回 id\n"
                "  return [];\n"
                "}\n"
            ),
        ),
    ]
    selected = [item for item in templates if item.type in types]
    while len(selected) < payload.count:
        selected.append(
            Question(
                id=f"ai-{uuid4().hex}",
                title=f"{role} 深度问答 {len(selected) + 1}",
                type="short",
                prompt=f"结合你的经历，说明你如何处理一个 {role} 相关的复杂问题，并给出可验证结果。",
            )
        )
    return selected[: payload.count]


def _build_generation_prompt(payload: QuestionGenerationRequest) -> str:
    types = "、".join(payload.question_types) if payload.question_types else "single、multi、short、code 混合"
    return (
        f"岗位：{payload.role or '未指定'}\n"
        f"数量：{payload.count}\n"
        f"难度：{payload.difficulty}\n"
        f"题型：{types}\n"
        f"用户自定义生成要求：{payload.user_prompt or '无'}\n\n"
        "单选题和多选题必须提供至少 4 个 options。"
        "每个 option 必须包含 label 和 value，value 建议使用 A、B、C、D 或稳定英文标识。"
        "简答题和代码题 options 返回空数组。"
        "请返回 JSON，格式为："
        '{"questions":[{"title":"题目标题","type":"single|multi|short|code","prompt":"题干",'
        '"options":[{"label":"选项文案","value":"选项值"}],"starter_code":"代码题初始代码","language":"typescript"}]}。'
        "不要返回 markdown，不要返回解释。"
    )


def _parse_generated_questions(content: str) -> list[Question]:
    raw = content.strip()
    if raw.startswith("```"):
        raw = re.sub(r"^```(?:json)?", "", raw).strip()
        raw = re.sub(r"```$", "", raw).strip()
    match = re.search(r"\{.*\}", raw, re.S)
    if match:
        raw = match.group(0)
    data = json.loads(raw)
    items = data.get("questions") if isinstance(data, dict) else data
    if not isinstance(items, list):
        return []
    questions: list[Question] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        item = {**item, "id": f"ai-{uuid4().hex}"}
        if item.get("type") not in {"single", "multi", "short", "code"}:
            item["type"] = "short"
        item["options"] = _normalize_generated_options(item.get("options") or item.get("choices"))
        if item["type"] in {"single", "multi"} and not item.get("options"):
            continue
        if item["type"] not in {"single", "multi"}:
            item["options"] = []
        questions.append(Question.model_validate(item))
    return questions


def _normalize_generated_options(raw_options: object) -> list[dict[str, str]]:
    if not isinstance(raw_options, list):
        return []
    normalized: list[dict[str, str]] = []
    for index, option in enumerate(raw_options):
        default_value = chr(65 + index) if index < 26 else str(index + 1)
        if isinstance(option, str):
            label = option.strip()
            value = default_value
        elif isinstance(option, dict):
            label = str(option.get("label") or option.get("text") or option.get("content") or option.get("name") or "").strip()
            value = str(option.get("value") or option.get("key") or option.get("id") or default_value).strip()
        else:
            continue
        if label:
            normalized.append({"label": label, "value": value or default_value})
    return normalized


def _matches_role(question: WrittenQuestion | OralQuestion, role: str) -> bool:
    tags = [item.strip().lower() for item in (question.role_tags or "").split(",") if item.strip()]
    if not tags or "通用" in tags or "all" in tags:
        return True
    normalized = (role or "").lower()
    return any(tag in normalized or normalized in tag for tag in tags)


def _to_question(item: WrittenQuestion) -> Question:
    return Question(
        id=item.id,
        title=item.title,
        type=item.type,
        prompt=item.prompt,
        options=[QuestionOption.model_validate(option) for option in (item.options or [])],
        starter_code=item.starter_code or "",
        language=item.language or "typescript",
    )


def _question_dump(item: Question) -> dict:
    data = item.model_dump(mode="json")
    data.pop("id", None)
    return data
