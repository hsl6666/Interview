from __future__ import annotations

from datetime import datetime
from time import perf_counter
import json

import httpx
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models import LlmModelConfig
from app.schemas import LlmModelConfigRead, LlmModelConfigUpdate

GLOBAL_CONFIG_ID = "global"

PROVIDER_DEFAULTS = {
    "zhipu": {"model": "glm-4.6", "api_base_url": "https://open.bigmodel.cn/api/paas/v4"},
    "openai": {"model": "gpt-4o-mini", "api_base_url": "https://api.openai.com/v1"},
    "deepseek": {"model": "deepseek-flash", "api_base_url": "https://api.deepseek.com"},
    "qwen": {"model": "qwen-plus", "api_base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1"},
    "custom": {"model": "", "api_base_url": ""},
}

class LlmConfigError(RuntimeError):
    pass


class LlmProviderError(RuntimeError):
    pass


def get_or_create_model_config(db: Session) -> LlmModelConfig:
    config = db.get(LlmModelConfig, GLOBAL_CONFIG_ID)
    if config is not None:
        return config

    settings = get_settings()
    config = LlmModelConfig(
        id=GLOBAL_CONFIG_ID,
        provider="zhipu",
        model=settings.glm_model or PROVIDER_DEFAULTS["zhipu"]["model"],
        api_base_url=PROVIDER_DEFAULTS["zhipu"]["api_base_url"],
        api_key=settings.zhipu_api_key or "",
        enabled=bool(settings.zhipu_api_key),
    )
    db.add(config)
    db.commit()
    db.refresh(config)
    return config


def update_model_config(db: Session, payload: LlmModelConfigUpdate) -> LlmModelConfig:
    config = get_or_create_model_config(db)
    provider = payload.provider or "custom"
    defaults = PROVIDER_DEFAULTS.get(provider, PROVIDER_DEFAULTS["custom"])
    config.provider = provider
    config.model = payload.model or defaults["model"]
    config.api_base_url = payload.api_base_url or defaults["api_base_url"]
    config.enabled = payload.enabled
    if payload.clear_api_key:
        config.api_key = ""
    elif payload.api_key:
        config.api_key = payload.api_key.strip()
    db.commit()
    db.refresh(config)
    return config


def model_config_to_read(config: LlmModelConfig) -> LlmModelConfigRead:
    return LlmModelConfigRead(
        provider=config.provider,
        model=config.model,
        api_base_url=config.api_base_url,
        enabled=config.enabled,
        has_api_key=bool(config.api_key),
        api_key_masked=_mask_api_key(config.api_key),
        updated_at=config.updated_at if isinstance(config.updated_at, datetime) else datetime.utcnow(),
    )


async def chat_completion(
    db: Session,
    messages: list[dict[str, str]],
    temperature: float = 0.6,
    timeout: int = 30,
    require_config: bool = False,
    max_tokens: int | None = None,
) -> str | None:
    config = get_or_create_model_config(db)
    config_error = _validate_chat_config(config)
    if config_error:
        if require_config:
            raise LlmConfigError(config_error)
        return None

    url = _chat_completions_url(config.api_base_url)
    if not url:
        if require_config:
            raise LlmConfigError("模型 Base URL 不能为空")
        return None

    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.post(
                url,
                headers={"Authorization": f"Bearer {config.api_key}", "Content-Type": "application/json"},
                json={
                    "model": config.model,
                    "messages": messages,
                    "temperature": temperature,
                    **({"max_tokens": max_tokens} if max_tokens is not None else {}),
                },
            )
            response.raise_for_status()
            data = response.json()
            content = data["choices"][0]["message"]["content"]
            if not isinstance(content, str) or not content.strip():
                raise ValueError("Empty model content")
            return content.strip()
    except httpx.TimeoutException as exc:
        raise LlmProviderError("模型请求超时，请检查网络、Base URL 或模型服务状态") from exc
    except httpx.HTTPStatusError as exc:
        detail = _response_error_detail(exc.response)
        raise LlmProviderError(f"模型服务返回错误 {exc.response.status_code}：{detail}") from exc
    except (KeyError, IndexError, TypeError, ValueError) as exc:
        raise LlmProviderError("模型响应格式不符合 OpenAI Chat Completions 兼容格式") from exc
    except httpx.HTTPError as exc:
        raise LlmProviderError(f"模型请求失败：{exc}") from exc


async def chat_completion_stream(
    db: Session,
    messages: list[dict[str, str]],
    temperature: float = 0.6,
    timeout: int = 60,
    require_config: bool = False,
):
    config = get_or_create_model_config(db)
    config_error = _validate_chat_config(config)
    if config_error:
        if require_config:
            raise LlmConfigError(config_error)
        return

    url = _chat_completions_url(config.api_base_url)
    if not url:
        if require_config:
            raise LlmConfigError("模型 Base URL 不能为空")
        return

    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            async with client.stream(
                "POST",
                url,
                headers={"Authorization": f"Bearer {config.api_key}", "Content-Type": "application/json"},
                json={
                    "model": config.model,
                    "messages": messages,
                    "temperature": temperature,
                    "stream": True,
                },
            ) as response:
                response.raise_for_status()
                async for line in response.aiter_lines():
                    if not line or not line.startswith("data:"):
                        continue
                    payload = line[5:].strip()
                    if payload == "[DONE]":
                        break
                    try:
                        data = json.loads(payload)
                        delta = data["choices"][0]["delta"].get("content")
                    except (KeyError, IndexError, TypeError, ValueError):
                        continue
                    if delta:
                        yield str(delta)
    except httpx.TimeoutException as exc:
        raise LlmProviderError("模型流式请求超时，请检查网络、Base URL 或模型服务状态") from exc
    except httpx.HTTPStatusError as exc:
        detail = _response_error_detail(exc.response)
        raise LlmProviderError(f"模型服务返回错误 {exc.response.status_code}：{detail}") from exc
    except httpx.HTTPError as exc:
        raise LlmProviderError(f"模型流式请求失败：{exc}") from exc


def _chat_completions_url(api_base_url: str) -> str:
    base = (api_base_url or "").strip().rstrip("/")
    if not base:
        return ""
    if base.endswith("/chat/completions"):
        return base
    return f"{base}/chat/completions"


def _validate_chat_config(config: LlmModelConfig) -> str:
    if not config.enabled:
        return "模型配置未启用，请先在模型管理中启用"
    if not config.api_key:
        return "模型 API Key 未配置"
    if not config.model:
        return "模型名称未配置"
    if not config.api_base_url:
        return "模型 Base URL 未配置"
    return ""


def _response_error_detail(response: httpx.Response) -> str:
    try:
        data = response.json()
        if isinstance(data, dict):
            error = data.get("error") or data.get("message") or data.get("detail")
            if isinstance(error, dict):
                return str(error.get("message") or error)
            if error:
                return str(error)
        return response.text[:500]
    except Exception:
        return response.text[:500]


def _mask_api_key(api_key: str) -> str:
    if not api_key:
        return ""
    if len(api_key) <= 8:
        return "*" * len(api_key)
    return f"{api_key[:4]}...{api_key[-4:]}"


async def test_saved_model_connection(db: Session) -> dict:
    config = get_or_create_model_config(db)
    started = perf_counter()
    result = {"success": False, "model": config.model, "code": "provider_error", "message": ""}
    try:
        await chat_completion(
            db, [{"role": "user", "content": "连接检测，请只回复 OK。"}],
            temperature=0, timeout=20, require_config=True, max_tokens=64,
        )
        result.update(success=True, code="ok", message="连接成功，模型已正常返回内容。")
    except LlmConfigError as exc:
        result.update(code="configuration", message=str(exc))
    except LlmProviderError as exc:
        cause = exc.__cause__
        if isinstance(cause, httpx.HTTPStatusError):
            status = cause.response.status_code
            code, message = {
                400: ("invalid_request", "模型服务拒绝请求，请核对模型名称和接口兼容性。"),
                401: ("authentication", "API Key 无效或已失效，请更新密钥并保存后重试。"),
                402: ("balance", "模型账户余额不足，请在服务商平台检查余额。"),
                403: ("permission", "当前密钥无权访问该模型，请检查账户权限。"),
                404: ("model_or_endpoint", "模型或接口不存在，请核对模型名称与 Base URL。"),
                429: ("rate_limit", "请求频率或额度受限，请稍后重试并检查账户配额。"),
            }.get(status, ("provider_unavailable", "模型服务暂时不可用，请稍后重试。"))
            result.update(code=code, message=message, http_status=status)
        elif isinstance(cause, httpx.TimeoutException):
            result.update(code="timeout", message="连接检测超时（20秒），请检查网络、Base URL 或稍后重试。")
        elif isinstance(cause, httpx.HTTPError):
            result.update(code="network", message="无法连接模型服务，请检查网络和 Base URL。")
        else:
            result.update(code="invalid_response", message="服务未返回有效的文本内容，请检查模型与接口兼容性。")
    result["latency_ms"] = round((perf_counter() - started) * 1000)
    return result
