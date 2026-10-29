# AI 面试官流程系统

这是按需求落地的可运行 MVP：React + TypeScript + Tailwind + Antd 前端，FastAPI + SQLite 后端，包含真实扫码上传、简历解析回填、岗位笔试、Monaco 代码题、WebRTC 信令、LangGraph/GLM-4.6 占位、口试字幕、摄像头随机抽帧入库。

## 目录结构

```text
backend/
  app/api/              REST、移动上传页、WebRTC 信令
  app/core/             配置与环境变量
  app/services/         简历解析、题库、LangGraph 面试编排、RTC
  app/models.py         SQLite 数据模型
  app/schemas.py        Pydantic API schema
frontend/
  src/features/interview/
    api.ts              面试流程专用 API 客户端
    storage.ts          session/localStorage
    components/         流程壳、表单控件、歌词字幕
    pages/              Step1/Step2/Step3/完成页
docker-compose.yml
```

## 核心数据模型

- `sessions`：候选人 session、岗位、表单资料、解析资料、简历文本、笔试提交、口试摘要。
- `attachments`：上传附件元数据、文件路径、解析文本。
- `transcripts`：口试用户转写与 AI 回复。
- `interview_snapshots`：摄像头随机抽帧，图片二进制保存在 SQLite，文件目录只做缓存备份。

## API 设计

- `POST /api/sessions` 创建或确认 session
- `GET /api/sessions/{id}` 获取候选人 session、附件、解析结果、抽帧
- `PATCH /api/sessions/{id}` 保存基础表单
- `GET /m/upload?sessionId=...` 手机上传页
- `POST /api/sessions/{id}/attachments` 上传 PDF/图片并触发解析
- `GET /api/questions?role=...` 按岗位获取题目
- `POST /api/sessions/{id}/written-submission` 保存笔试
- `POST /api/rtc/offer` WebRTC SDP 信令
- `POST /api/sessions/{id}/oral/start` 开场提问
- `POST /api/sessions/{id}/oral/respond` 保存候选回答并生成追问
- `POST /api/sessions/{id}/snapshots` 保存摄像头抽帧到数据库
- `GET /api/sessions/{id}/snapshots/{snapshotId}/image` 从数据库读取抽帧图片
- `POST /api/sessions/{id}/oral-summary` 保存口试 QA

## 启动

本地两条命令：

```bash
cd backend
cp .env.example .env
./.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8010 --reload
```

```bash
cd frontend
npm run dev
```

Docker：

```bash
docker compose up --build
```

当前机器已有其他服务占用 8000，本地开发默认使用后端 `8010`。手机扫码上传时，把 `backend/.env` 和 `frontend/.env.development` 的 `PUBLIC_BASE_URL` / `VITE_PUBLIC_BASE_URL` 改成电脑局域网 IP，例如：

```bash
ipconfig getifaddr en0
```

前端访问：`http://127.0.0.1:5173/interview/basic`。如果你按我当前联调方式启动，则访问 `http://127.0.0.1:5174/interview/basic`。

## 口试套题管理

在 `/admin/questions` 的“口试题管理”中，先新建套题，再进入套内添加、编辑、排序和发布题目。至少发布一道题后，可以发布整套，并通过“用于口试”或顶部选择框选择当前口试套题。

“自定义组套”支持从多套题中筛选勾选、预览和调整顺序。创建后保存为独立副本，保留所选题目的发布状态；新套题默认为草稿，修改或删除来源题不会影响副本。

后端启动时自动把旧口试题归入“默认套题”，保留旧题及发布状态。新口试固定所选套题的题目快照；切换套题只影响后续开始的口试。整套出题不再按单题岗位标签筛选。当前使用的套题不能删除或取消发布，也不能移除最后一道已发布题目。

后端接口回归测试使用隔离的内存数据库：

```bash
cd backend
./.venv/bin/python -m unittest discover -s tests -v
```

### 每日面试简报与飞书机器人

后台入口 `/admin/daily-brief`。每天北京时间 18:00 汇总当天零点至生成时有资料更新、笔试或口试活动的面试会话，发送到配置的飞书群，并 @ 指定成员。按面试场次统计，已完成数字为这些会话的当前完成状态。18:00 后新增活动不会修改已经发送的日报；可随时重新生成预览查看最新数据。

1. 在目标群添加「自定义机器人」，开启签名校验，将 Webhook、签名密钥及提醒成员的真实 User ID/Open ID 填入后台。群名称仅为记录标签，实际目标由 Webhook 决定。
2. 保存后发送连接测试，确认群名、机器人和真实 @ 提醒，再开启每日自动推送。
3. AI 归纳复用「模型管理」中的模型，模型不可用时自动降级事实摘要。不会把流程完整度评分作为候选人能力或录用结论，不发送完整候选人档案、身份证、联系方式、家庭资料或录音文件。
4. 定时器随后端启动，约每15秒检查一次；需要常驻在线后端，电脑睡眠、关机或后端退出时无法按时发送。正式使用应部署到持续运行的服务器。18:00后当日恢复可补发当天，过去日期不会自动补发。
5. 配置和发送记录保存在现有数据库中，同一天定时任务唯一，多个服务进程共享数据库时也不会重复抢占。立即发送会占用当天日报名额，连接测试不占用。
6. 飞书明确拒绝的日报可以修复配置后手动重试；网络超时、服务端异常或中途退出可能已经发送，标记「待核对群消息」且不自动重发。先在群中确认，避免重复通知。

Webhook 和签名密钥为只写配置，API 不回传其内容；数据库及备份须由服务账号保管。沿用项目现有后台访问方式，部署时应置于已有管理员访问控制之内，不要向公众开放管理 API。

接口：`GET/PUT /api/admin/daily-brief/config`、`POST /preview`、`POST /send`（`test`/`retry`）、`GET /runs`。飞书接入依据[官方自定义机器人文档](https://open.feishu.cn/document/client-docs/bot-v3/add-custom-bot)。

模型管理页提供「检测连接」：先保存配置，再发送一条不含候选人资料的简短请求。页面显示检测结果、耗时，以及密钥无效、余额不足、模型/接口不存在、限流、超时等原因。检测不修改配置，也不会将服务商原始错误或密钥返回前端。接口为 `POST /api/admin/model-config/test`。

DeepSeek V4.1 Flash 使用官方调用名 `deepseek-flash`，Base URL 为 `https://api.deepseek.com`，已加入模型选项和厂商默认值，详见[官方接入说明](https://api-docs.deepseek.com/quick_start/agent_integrations/)。

## LINUX DO Connect 登录

整个项目需要登录：访问 `/login`，通过 LINUX DO 完成授权后返回原页面。普通账号可以参加自己的面试；管理后台、面试结果汇总及结果复盘仅限管理员。已有的历史面试保留，由管理员访问，不会自动归属给第一个登录者。

在 [LINUX DO Connect](https://connect.linux.do/) 的“应用接入”中为本项目创建独立应用，获得 Client ID / Client Secret。按照 [官方文档](https://wiki.linux.do/Community/LinuxDoConnect) 使用授权码流程。配置 `backend/.env`（已被 Git 忽略）：

```dotenv
FRONTEND_ORIGIN=http://127.0.0.1:5175
LINUXDO_CLIENT_ID=你的应用ID
LINUXDO_CLIENT_SECRET=你的应用密钥
LINUXDO_REDIRECT_URI=http://127.0.0.1:8011/api/auth/linuxdo/callback
LINUXDO_ADMIN_IDS=你的LINUX_DO数字用户ID
AUTH_SESSION_HOURS=12
```

- Connect 中的回调地址必须与 `LINUXDO_REDIRECT_URI` 完全一致，包括协议、域名、端口和路径。不能填写前端 `/login` 或网站首页。
- 本地前端 API 地址指向 `http://127.0.0.1:8011`。使用 `127.0.0.1` 打开前后端，不要混用 `localhost`。修改后端 `.env` 后需重启后端。
- `LINUXDO_ADMIN_IDS` 可用逗号分隔多个不可变数字 ID。留空时所有用户均为普通用户；可以先登录，访问 `/api/auth/me` 查看自己的 `id`，再由管理员将其写入配置。普通用户无法通过页面修改权限。
- 凭证不写入前端、不进入 Git、不在登录回调 URL 中返回。后端使用 HttpOnly Cookie 和数据库会话哈希，退出时立即撤销会话，默认 12 小时过期。
- 手机扫码上传需要手机登录与电脑相同的 LINUX DO 账号；`PUBLIC_BASE_URL` 必须是手机可访问的后端地址，正式使用建议统一 HTTPS 域名。本机 `127.0.0.1` 回调仅用于电脑联调。
- 生产环境设 `ENVIRONMENT=production`，`FRONTEND_ORIGIN` 和回调均使用 HTTPS，并通过同站点域名访问。CORS 只允许配置的前端来源。`/api/`、`/uploads/`、`/snapshots/`、`/m/` 均反向代理到后端，不能把附件目录以 nginx alias 暴露出去。
- 没有有效应用配置时登录按钮不可用，业务接口仍返回 401，不会自动放开访问。数据库新增会话和面试归属表，不删除旧数据。

认证回归测试覆盖单次 state、浏览器绑定、授权拒绝、会话过期与撤销、角色权限、跨账号数据隔离、附件访问、回跳白名单和 Origin 校验：

```bash
cd backend
./.venv/bin/python -m unittest discover -s tests -v
# 在项目根目录，Node 24+
node --test frontend/tests/*.test.mjs
```
