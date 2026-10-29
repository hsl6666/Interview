import { createContext, useContext, useEffect, useState, type PropsWithChildren } from "react";
import { isAxiosError } from "axios";
import { Alert, Button, Result, Spin } from "antd";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { fetchIdentity, type AdminIdentity } from "./api";
import { loginPath } from "./navigation";
import { setInterviewAccount } from "../interview/storage";

const IdentityContext = createContext<AdminIdentity | null>(null);
export const useAdminIdentity = () => useContext(IdentityContext);

export function RequireLogin({ children }: PropsWithChildren) {
  const [identity, setIdentity] = useState<AdminIdentity | null>(null);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const navigate = useNavigate();
  const location = useLocation();
  const next = location.pathname + location.search;

  useEffect(() => {
    let active = true;
    let checking = false;
    async function check() {
      if (checking) return;
      checking = true;
      try {
        const user = await fetchIdentity();
        if (active) {
          setInterviewAccount(user.id);
          setIdentity(user);
          setFailed(false);
        }
      } catch (error) {
        if (!active) return;
        if (isAxiosError(error) && [401, 403].includes(error.response?.status || 0)) {
          setIdentity(null);
          navigate(loginPath(next, error.response?.status === 403 ? "not_allowed" : undefined), {
            replace: true,
          });
        } else setFailed(true);
      } finally {
        checking = false;
      }
    }
    setFailed(false);
    void check();
    window.addEventListener("focus", check);
    return () => {
      active = false;
      window.removeEventListener("focus", check);
    };
  }, [navigate, next, retry]);

  if (identity)
    return (
      <IdentityContext.Provider key={identity.id} value={identity}>
        {children}
      </IdentityContext.Provider>
    );
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f6f5f0] p-6">
      {failed ? (
        <Alert
          type="error"
          showIcon
          title="暂时无法验证登录状态"
          description="请检查网络或后端服务后重试。"
          action={<Button onClick={() => setRetry((n) => n + 1)}>重试</Button>}
        />
      ) : (
        <div role="status" className="text-center">
          <Spin size="large" />
          <p className="mt-4 text-sm text-stone-500">正在验证登录状态…</p>
        </div>
      )}
    </main>
  );
}

export default function RequireAdmin({ children }: PropsWithChildren) {
  const identity = useAdminIdentity();
  if (identity?.role === "admin") return children;
  return (
    <Result
      status="403"
      title="此页面仅对管理员开放"
      subTitle="你已登录，可以继续参加面试。如需后台权限，请联系管理员。"
      extra={
        <Link to="/interview/basic">
          <Button type="primary">返回面试</Button>
        </Link>
      }
    />
  );
}
