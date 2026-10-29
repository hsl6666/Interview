import asyncio
import secrets
import time
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import RedirectResponse
from sqlalchemy import delete
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.db import get_db
from app.models import AdminLoginSession, OAuthLoginAttempt
from app.services.auth import (
    SESSION_COOKIE, STATE_COOKIE, admin_ids, configured, require_user,
    safe_next_path, secure_cookies, token_hash, verify_origin,
)

router = APIRouter(prefix="/api/auth", tags=["authentication"])
NO_STORE = {"Cache-Control": "no-store", "Referrer-Policy": "no-referrer"}


async def connect_with_retry(operation, *args, **kwargs):
    # Only retry failures before a connection is established. A lost token
    # response may already have consumed the one-time authorization code.
    for attempt in range(3):
        try:
            return await operation(*args, **kwargs)
        except (httpx.ConnectError, httpx.ConnectTimeout):
            if attempt == 2:
                raise
            await asyncio.sleep(0.25 * (attempt + 1))


def redirect(url: str) -> RedirectResponse:
    return RedirectResponse(url, status_code=302, headers=NO_STORE)


def login_error(settings: Settings, reason: str, next_path: str = "/admin") -> RedirectResponse:
    return redirect(settings.frontend_origin.rstrip("/") + "/login?" + urlencode({"error": reason, "next": next_path}))


def set_cookie(response: Response, name: str, value: str, settings: Settings, max_age: int):
    response.set_cookie(name, value, httponly=True, secure=secure_cookies(settings),
                        samesite="lax", max_age=max_age, path="/")


def clear_cookie(response: Response, name: str, settings: Settings):
    response.delete_cookie(name, path="/", httponly=True, secure=secure_cookies(settings), samesite="lax")


@router.get("/config")
def auth_config(response: Response, settings: Settings = Depends(get_settings)):
    response.headers.update(NO_STORE)
    return {"provider": "linuxdo", "configured": configured(settings)}


@router.get("/me")
def me(response: Response, session: AdminLoginSession = Depends(require_user), settings: Settings = Depends(get_settings)):
    response.headers.update(NO_STORE)
    return {"id": session.user_id, "username": session.username, "name": session.display_name, "role": "admin" if session.user_id in admin_ids(settings) else "candidate"}


@router.get("/linuxdo/login")
def login(request: Request, next: str = "/admin", db: Session = Depends(get_db),
          settings: Settings = Depends(get_settings)):
    next_path = safe_next_path(next)
    if not configured(settings):
        return login_error(settings, "not_configured", next_path)
    now = int(time.time())
    db.execute(delete(OAuthLoginAttempt).where(OAuthLoginAttempt.expires_at <= now))
    db.execute(delete(AdminLoginSession).where(AdminLoginSession.expires_at <= now))
    old_browser = request.cookies.get(STATE_COOKIE)
    if old_browser:
        db.execute(delete(OAuthLoginAttempt).where(OAuthLoginAttempt.browser_hash == token_hash(old_browser)))
    state, browser = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
    db.add(OAuthLoginAttempt(state_hash=token_hash(state), browser_hash=token_hash(browser),
                            next_path=next_path, expires_at=now + 600))
    db.commit()
    response = redirect("https://connect.linux.do/oauth2/authorize?" + urlencode({
        "client_id": settings.linuxdo_client_id, "redirect_uri": settings.linuxdo_redirect_uri,
        "response_type": "code", "scope": "user", "state": state,
    }))
    set_cookie(response, STATE_COOKIE, browser, settings, 600)
    return response


@router.get("/linuxdo/callback")
async def callback(request: Request, state: str = "", code: str = "", error: str = "",
                   db: Session = Depends(get_db), settings: Settings = Depends(get_settings)):
    if not configured(settings):
        return login_error(settings, "not_configured")
    browser = request.cookies.get(STATE_COOKIE, "")
    attempt = db.get(OAuthLoginAttempt, token_hash(state)) if state and browser else None
    if attempt is None or attempt.expires_at <= int(time.time()) or not secrets.compare_digest(attempt.browser_hash, token_hash(browser)):
        return login_error(settings, "invalid_state")
    next_path = safe_next_path(attempt.next_path)
    # Consume before network IO: duplicate callbacks cannot create another session.
    consumed = db.execute(delete(OAuthLoginAttempt).where(
        OAuthLoginAttempt.state_hash == token_hash(state),
        OAuthLoginAttempt.browser_hash == token_hash(browser),
        OAuthLoginAttempt.expires_at > int(time.time()),
    )).rowcount
    db.commit()
    if consumed != 1:
        return login_error(settings, "invalid_state", next_path)

    if error or not code:
        response = login_error(settings, "access_denied" if error else "invalid_callback", next_path)
    else:
        try:
            async with httpx.AsyncClient(timeout=20, follow_redirects=False) as client:
                token_response = await connect_with_retry(client.post,
                    "https://connect.linux.do/oauth2/token",
                    auth=httpx.BasicAuth(settings.linuxdo_client_id, settings.linuxdo_client_secret),
                    data={"grant_type": "authorization_code", "code": code, "redirect_uri": settings.linuxdo_redirect_uri},
                    headers={"Accept": "application/json"},
                )
                token_response.raise_for_status()
                access_token = token_response.json().get("access_token")
                if not isinstance(access_token, str) or not access_token:
                    raise ValueError("Missing access token")
                user_response = await connect_with_retry(client.get, "https://connect.linux.do/api/user", headers={
                    "Authorization": f"Bearer {access_token}", "Accept": "application/json",
                })
                user_response.raise_for_status()
                user = user_response.json()
            user_id = str(user.get("id", ""))
            username = user.get("username")
            if not user_id.isdigit() or not isinstance(username, str) or not username:
                raise ValueError("Invalid identity")
            if user.get("active") is not True or user.get("silenced") is not False:
                response = login_error(settings, "account_unavailable", next_path)
            else:
                old_token = request.cookies.get(SESSION_COOKIE)
                if old_token:
                    db.execute(delete(AdminLoginSession).where(AdminLoginSession.token_hash == token_hash(old_token)))
                token = secrets.token_urlsafe(48)
                lifetime = max(1, min(settings.auth_session_hours, 168)) * 3600
                db.add(AdminLoginSession(token_hash=token_hash(token), user_id=user_id,
                                         username=username[:120], display_name=str(user.get("name") or username)[:200],
                                         expires_at=int(time.time()) + lifetime))
                db.commit()
                if next_path.startswith("/m/upload?"):
                    from urllib.parse import urlsplit
                    callback_url = urlsplit(settings.linuxdo_redirect_uri)
                    response = redirect(f"{callback_url.scheme}://{callback_url.netloc}" + next_path)
                else:
                    response = redirect(settings.frontend_origin.rstrip("/") + next_path)
                set_cookie(response, SESSION_COOKIE, token, settings, lifetime)
        except (httpx.HTTPError, ValueError, TypeError, AttributeError):
            # Never expose OAuth tokens, secrets, or provider response bodies.
            response = login_error(settings, "provider_error", next_path)
    clear_cookie(response, STATE_COOKIE, settings)
    return response


@router.post("/logout")
def logout(request: Request, db: Session = Depends(get_db), settings: Settings = Depends(get_settings)):
    verify_origin(request, settings)
    token = request.cookies.get(SESSION_COOKIE)
    if token:
        db.execute(delete(AdminLoginSession).where(AdminLoginSession.token_hash == token_hash(token)))
    browser = request.cookies.get(STATE_COOKIE)
    if browser:
        db.execute(delete(OAuthLoginAttempt).where(OAuthLoginAttempt.browser_hash == token_hash(browser)))
    db.commit()
    from fastapi.responses import JSONResponse
    response = JSONResponse({"success": True}, headers=NO_STORE)
    clear_cookie(response, SESSION_COOKIE, settings)
    clear_cookie(response, STATE_COOKIE, settings)
    return response
