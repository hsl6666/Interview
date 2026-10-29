import asyncio
from contextlib import suppress
from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import auth, protected_files, daily_brief, interview_assistant, interview_config, model_config, positions, questions, results, rtc, sessions
from app.core.config import get_settings
from app.db import init_db
from app.services.auth import protect_admin_routes


settings = get_settings()
app = FastAPI(title=settings.app_name, version="1.0.0", dependencies=[Depends(protect_admin_routes)])

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_origin.rstrip("/")],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(protected_files.router)

app.include_router(auth.router)
app.include_router(sessions.router)
app.include_router(questions.router)
app.include_router(positions.router)
app.include_router(model_config.router)
app.include_router(interview_config.router)
app.include_router(interview_assistant.router)
app.include_router(rtc.router)
app.include_router(results.router)
app.include_router(daily_brief.router)


@app.on_event("startup")
async def on_startup() -> None:
    init_db()
    from app.services.daily_brief import scheduler_loop
    app.state.daily_brief_task = asyncio.create_task(scheduler_loop())


@app.on_event("shutdown")
async def on_shutdown() -> None:
    app.state.daily_brief_task.cancel()
    with suppress(asyncio.CancelledError):
        await app.state.daily_brief_task


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
