import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button, Dropdown, message } from "antd";
import { LogoutOutlined, UserOutlined } from "@ant-design/icons";
import { useAdminIdentity } from "./RequireAdmin";
import { logout } from "./api";

export default function AccountMenu() {
  const identity = useAdminIdentity();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  if (!identity) return null;
  return (
    <div className="flex items-center gap-3 text-sm">
      {identity.role === "admin" && (
        <Link className="text-emerald-800" to="/admin">
          管理后台
        </Link>
      )}
      <Dropdown
        trigger={["click"]}
        menu={{
          items: [
            { key: "user", label: `${identity.name || identity.username} · LINUX DO`, disabled: true },
            { key: "interview", label: "面试入口", onClick: () => navigate("/interview/basic") },
            {
              key: "logout",
              label: "退出登录",
              icon: <LogoutOutlined />,
              disabled: busy,
              onClick: async () => {
                setBusy(true);
                try {
                  await logout();
                  window.location.replace("/login");
                } catch {
                  message.error("退出失败，请重试");
                  setBusy(false);
                }
              },
            },
          ],
        }}
      >
        <Button type="text" icon={<UserOutlined />} loading={busy} aria-label="账号菜单">
          <span className="inline-block max-w-32 truncate align-middle">
            {identity.name || identity.username}
          </span>
        </Button>
      </Dropdown>
    </div>
  );
}
