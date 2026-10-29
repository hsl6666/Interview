import hashlib
import time

from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.db import get_db
from app.models import AdminLoginSession, InterviewOwnership

SESSION_COOKIE = "interview_admin_session"
STATE_COOKIE = "interview_oauth_browser"


def token_hash(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def admin_ids(settings: Settings) -> set[str]:
    return {value.strip() for value in settings.linuxdo_admin_ids.split(",") if value.strip().isdigit()}


def require_user(request: Request, db: Session = Depends(get_db),
                  settings: Settings = Depends(get_settings)) -> AdminLoginSession:
    token = request.cookies.get(SESSION_COOKIE, "")
    session = db.get(AdminLoginSession, token_hash(token)) if token else None
    if session is None or session.expires_at <= int(time.time()):
        raise HTTPException(401, "登录已失效，请重新登录")
    return session


def require_admin(request: Request, db: Session = Depends(get_db),
                  settings: Settings = Depends(get_settings)) -> AdminLoginSession:
    session = require_user(request, db, settings)
    if session.user_id not in admin_ids(settings):
        raise HTTPException(403, "当前账号没有后台管理权限")
    return session


def verify_origin(request: Request, settings: Settings) -> None:
    from urllib.parse import urlsplit
    callback = urlsplit(settings.linuxdo_redirect_uri)
    allowed = {settings.frontend_origin.rstrip("/")}
    if callback.scheme and callback.netloc:
        allowed.add(f"{callback.scheme}://{callback.netloc}")
    if request.headers.get("origin") not in allowed:
        raise HTTPException(403, "请求来源校验失败，请从登录页面重新进入")


def check_interview_access(session_id: str, identity: AdminLoginSession, db: Session, settings: Settings):
    if identity.user_id in admin_ids(settings):
        return
    ownership = db.get(InterviewOwnership, session_id)
    if ownership is None or ownership.user_id != identity.user_id:
        raise HTTPException(403, "你只能访问自己创建的面试记录")


def protect_admin_routes(request: Request, db: Session = Depends(get_db),
                         settings: Settings = Depends(get_settings)) -> None:
    path = request.url.path
    if path == "/health" or path.startswith("/api/auth/"):
        return
    try:
        identity = require_user(request, db, settings)
    except HTTPException as error:
        if path == "/m/upload" and error.status_code == 401:
            from urllib.parse import urlencode
            raise HTTPException(307, headers={"Location": settings.frontend_origin.rstrip("/") + "/login?" + urlencode({"next": path + "?" + request.url.query})})
        raise
    request.state.login_identity = identity
    protected = (path == "/api/admin" or path.startswith("/api/admin/")
                 or path == "/api/interview-results" or path.startswith("/api/interview-results/"))
    if protected:
        require_admin(request, db, settings)
    session_id = request.path_params.get("session_id")
    if path == "/m/upload":
        session_id = request.query_params.get("sessionId", "")
    if session_id:
        check_interview_access(session_id, identity, db, settings)
    if request.method not in {"GET", "HEAD", "OPTIONS"}:
        verify_origin(request, settings)


ADMIN_PAGES = {
    "/admin", "/admin/", "/admin/results", "/admin/positions", "/admin/questions",
    "/admin/models", "/admin/daily-brief", "/admin/configs", "/interview/results",
    "/interview/results/written", "/interview/results/oral",
    "/", "/interview", "/interview/basic", "/interview/written", "/interview/oral", "/interview/done", "/m/upload",
}


def safe_next_path(value: str) -> str:
    from urllib.parse import urlsplit
    if len(value) > 1000 or "\\" in value or any(ord(char) < 32 for char in value):
        return "/admin"
    try:
        parsed = urlsplit(value)
    except ValueError:
        return "/admin"
    if parsed.scheme or parsed.netloc or parsed.path not in ADMIN_PAGES:
        return "/admin"
    return parsed.path + ("?" + parsed.query if parsed.query else "")


def secure_cookies(settings: Settings) -> bool:
    return settings.environment == "production" or settings.frontend_origin.startswith("https://")


def configured(settings: Settings) -> bool:
    from urllib.parse import urlsplit
    if not (settings.linuxdo_client_id.strip() and settings.linuxdo_client_secret.strip()):
        return False
    try:
        frontend = urlsplit(settings.frontend_origin)
        callback = urlsplit(settings.linuxdo_redirect_uri)
        if (frontend.scheme not in {"http", "https"} or not frontend.netloc
                or frontend.path not in {"", "/"} or frontend.query or frontend.fragment
                or frontend.username or callback.username or not callback.netloc
                or callback.scheme not in {"http", "https"}
                or callback.path != "/api/auth/linuxdo/callback" or callback.query or callback.fragment):
            return False
        if secure_cookies(settings) and (frontend.scheme != "https" or callback.scheme != "https"):
            return False
    except ValueError:
        return False
    return True
