import { useEffect, useState } from "react";
import { isAxiosError } from "axios";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Alert, Button } from "antd";
import { ArrowRightOutlined, LockOutlined, SafetyCertificateOutlined } from "@ant-design/icons";
import { authorizationUrl, fetchAuthConfig, fetchIdentity } from "./api";
import { API_BASE_URL } from "../interview/api";
import { safeReturnPath } from "./navigation";

const errors: Record<string, string> = {
  not_configured: "登录服务尚未完成配置，请联系系统管理员。",
  invalid_state: "这次登录已过期或失效，请重新发起登录。",
  invalid_callback: "未收到有效的授权信息，请重新登录。",
  access_denied: "你取消了授权，可以重新登录或返回面试端。",
  not_allowed: "当前 LINUX DO 账号未获后台权限，请联系管理员添加授权。",
  account_unavailable: "当前 LINUX DO 账号状态不可用，请检查社区账号后重试。",
  provider_error: "暂时无法完成 LINUX DO 登录，请稍后重试。",
  session_expired: "登录已过期，请重新登录后继续。",
};

export default function LoginPage() {
  const [params] = useSearchParams();
  const next = safeReturnPath(params.get("next"));
  const reason = errors[params.get("error") || ""];
  const navigate = useNavigate();
  const [ready, setReady] = useState<boolean | null>(null);
  const [networkError, setNetworkError] = useState(false);
  const [opening, setOpening] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    setReady(null);
    setNetworkError(false);
    void Promise.all([
      fetchAuthConfig(),
      fetchIdentity().catch((error) => {
        if (isAxiosError(error) && [401, 403].includes(error.response?.status || 0)) return null;
        throw error;
      }),
    ])
      .then(([config, user]) => {
        if (!active) return;
        if (user) {
          if (next.startsWith("/m/upload?")) window.location.assign(`${API_BASE_URL}${next}`);
          else
            navigate(next === "/admin" && user.role !== "admin" ? "/interview/basic" : next, {
              replace: true,
            });
        } else setReady(config.configured);
      })
      .catch(() => {
        if (active) setNetworkError(true);
      });
    const reset = () => setOpening(false);
    window.addEventListener("pageshow", reset);
    return () => {
      active = false;
      window.removeEventListener("pageshow", reset);
    };
  }, [navigate, next, retry]);

  return (
    <main className="min-h-screen bg-[#f6f5f0] px-5 py-8 text-stone-950 sm:px-10">
      <header className="mx-auto flex max-w-6xl items-center justify-between gap-4">
        <Link to="/login" className="flex items-center gap-3 text-stone-950">
          <span
            aria-hidden
            className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-950 text-lg font-semibold text-white"
          >
            面
          </span>
          <span className="text-sm font-semibold tracking-wide">AI 面试平台</span>
        </Link>
        <Link to="/login?next=%2Fadmin" className="text-sm text-stone-500 hover:text-emerald-800">
          管理员入口 <ArrowRightOutlined />
        </Link>
      </header>
      <div className="mx-auto grid max-w-6xl items-center gap-10 py-14 sm:py-20 lg:min-h-[75vh] lg:grid-cols-[1.1fr_1fr] lg:gap-24">
        <section className="max-w-lg">
          <p className="mb-5 text-xs font-semibold tracking-[0.22em] text-emerald-800">INTERVIEW WORKSPACE</p>
          <h1 className="text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
            每一次面试，
            <br />
            <span className="text-emerald-800">都有据可循。</span>
          </h1>
          <p className="mt-6 max-w-md text-base leading-8 text-stone-600">
            登录后完善个人信息、完成技术笔试与口试。从准备到作答，让每一步更清晰。
          </p>
          <div className="mt-8 hidden gap-6 border-t border-stone-200 pt-6 text-sm text-stone-500 sm:flex">
            <span>题库与套题</span>
            <span>面试结果分析</span>
            <span>每日面试简报</span>
          </div>
        </section>
        <section
          aria-labelledby="login-title"
          className="min-w-0 rounded-2xl border border-stone-200 bg-white p-6 shadow-[0_12px_40px_-24px_rgba(0,0,0,0.18)] sm:p-10"
        >
          <div className="mb-6 flex h-11 w-11 items-center justify-center rounded-full bg-stone-100 text-lg text-stone-600">
            <LockOutlined />
          </div>
          <h2 id="login-title" className="text-2xl font-semibold">
            登录 AI 面试平台
          </h2>
          <p className="mb-8 mt-3 text-sm leading-6 text-stone-500">
            使用 LINUX DO 账号登录后参加面试，管理员可进入后台管理。
          </p>
          <div className="space-y-4" aria-live="polite">
            {reason && <Alert type="warning" showIcon title={reason} />}
            {networkError ? (
              <Alert
                type="error"
                showIcon
                title="暂时无法连接登录服务"
                description="请检查网络或确认后端已启动。"
                action={<Button onClick={() => setRetry((n) => n + 1)}>重试</Button>}
              />
            ) : ready === false && !reason ? (
              <Alert
                type="info"
                showIcon
                title="登录服务尚未配置"
                description="请联系管理员完成 LINUX DO Connect 应用配置后再登录。"
              />
            ) : null}
            <Button
              block
              size="large"
              type="primary"
              className="!h-12 !rounded-lg !font-medium"
              loading={opening || (ready === null && !networkError)}
              disabled={!ready || networkError}
              onClick={() => {
                setOpening(true);
                window.location.assign(authorizationUrl(next));
              }}
            >
              {opening ? "正在前往 LINUX DO…" : "使用 LINUX DO 登录"}
              {!opening && <ArrowRightOutlined />}
            </Button>
            {ready === false && (
              <Button block type="text" onClick={() => setRetry((n) => n + 1)}>
                已完成配置，重新检测
              </Button>
            )}
          </div>
          <p className="mt-5 flex items-start gap-2 text-xs leading-6 text-stone-500">
            <SafetyCertificateOutlined className="mt-1.5" />
            <span>
              将前往 LINUX DO
              完成授权。本站不会获取你的社区密码，面试记录将与你的账号绑定，管理后台仅向获授权的管理员开放。
            </span>
          </p>
          <div className="mt-8 border-t border-stone-100 pt-6 text-center text-sm text-stone-500">
            统一账号登录，保护你的面试信息。
          </div>
        </section>
      </div>
      <footer className="mx-auto max-w-6xl border-t border-stone-200 pt-5 text-xs text-stone-400">
        AI 面试平台 · LINUX DO 账号登录
      </footer>
    </main>
  );
}
