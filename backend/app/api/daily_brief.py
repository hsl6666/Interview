import re
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, field_validator
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.db import get_db
from app.models import DailyBriefRun, utc_now
from app.services.daily_brief import TZ, config_read, get_config, generate_brief, send_daily_brief, run_read

router=APIRouter(prefix='/api/admin/daily-brief',tags=['daily-brief'])


class ConfigUpdate(BaseModel):
    model_config=ConfigDict(extra='forbid')
    enabled: bool | None=None
    ai_enabled: bool | None=None
    group_name: str | None=None
    mention_name: str | None=None
    mention_user_id: str | None=None
    webhook_url: str | None=None
    signing_secret: str | None=None
    clear_webhook: bool=False
    clear_signing_secret: bool=False

    @field_validator('webhook_url')
    @classmethod
    def valid_webhook(cls,value):
        if value and not re.fullmatch(r'https://open\.feishu\.cn/open-apis/bot/v2/hook/[A-Za-z0-9_-]+',value):
            raise ValueError('仅支持飞书官方自定义机器人 Webhook 地址')
        return value

    @field_validator('mention_user_id')
    @classmethod
    def valid_id(cls,value):
        if value and (value=='all' or not re.fullmatch(r'[A-Za-z0-9_-]{3,120}',value)):
            raise ValueError('请填写指定成员的真实 User ID / Open ID，不能使用姓名或 all')
        return value

    @field_validator('group_name','mention_name')
    @classmethod
    def valid_label(cls,value):
        if value is not None and (not value.strip() or len(value)>120):
            raise ValueError('名称须为1至120个字符')
        return value.strip() if value else value


@router.get('/config')
def read_config(db:Session=Depends(get_db)):
    return config_read(get_config(db))


@router.put('/config')
def save_config(payload:ConfigUpdate,db:Session=Depends(get_db)):
    config=get_config(db)
    changes=payload.model_dump(exclude_none=True,exclude={'clear_webhook','clear_signing_secret'})
    for field,value in changes.items():
        if field in {'webhook_url','signing_secret'} and not value:
            continue
        setattr(config,field,value)
    if payload.clear_webhook: config.webhook_url=''
    if payload.clear_signing_secret: config.signing_secret=''
    if config.enabled and (not config.webhook_url or not config.mention_user_id):
        db.rollback()
        raise HTTPException(400,'启用前请配置 Webhook 和提醒对象的 User ID / Open ID')
    db.commit(); db.refresh(config)
    return config_read(config)


@router.post('/preview')
async def preview(db:Session=Depends(get_db)):
    return await generate_brief(db,utc_now().astimezone(TZ).date())


class SendRequest(BaseModel):
    test:bool=False
    retry:bool=False


@router.post('/send')
async def send(payload:SendRequest,db:Session=Depends(get_db)):
    try:
        return run_read(await send_daily_brief(db,utc_now().astimezone(TZ).date(),test=payload.test,retry=payload.retry))
    except ValueError as exc:
        raise HTTPException(400,str(exc)) from exc


@router.get('/runs')
def runs(db:Session=Depends(get_db)):
    return [run_read(r) for r in db.scalars(select(DailyBriefRun).order_by(DailyBriefRun.created_at.desc()).limit(60))]
