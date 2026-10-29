import { useEffect, useState } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  LogoutOutlined,
  UserOutlined,
  BarChartOutlined,
  FileTextOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  RobotOutlined,
  SettingOutlined,
  SolutionOutlined,
} from "@ant-design/icons";
import { Avatar, Dropdown, message, Button, Grid, Layout, Menu, type MenuProps, Space, theme } from "antd";
import { ROUTE_PATHS } from "@/constants/common";

import RequireAdmin, { useAdminIdentity } from "../../auth/RequireAdmin";
import { logout } from "../../auth/api";

const { Header, Sider, Content } = Layout;
const settingsMenuKey = "system-settings";

const menuItems: MenuProps["items"] = [
  { key: ROUTE_PATHS.adminDailyBrief, icon: <RobotOutlined />, label: "每日面试简报" },
  { key: ROUTE_PATHS.adminResults, icon: <BarChartOutlined />, label: "面试结果" },
  { key: ROUTE_PATHS.adminPositions, icon: <SolutionOutlined />, label: "岗位管理" },
  { key: ROUTE_PATHS.adminQuestions, icon: <FileTextOutlined />, label: "题库管理" },
  {
    key: settingsMenuKey,
    icon: <SettingOutlined />,
    label: "系统配置",
    children: [
      { key: ROUTE_PATHS.adminModels, icon: <RobotOutlined />, label: "模型管理" },
      { key: ROUTE_PATHS.adminConfigs, icon: <SettingOutlined />, label: "配置管理" },
    ],
  },
];

const menuKeys = [
  ROUTE_PATHS.adminDailyBrief,
  ROUTE_PATHS.adminResults,
  ROUTE_PATHS.adminPositions,
  ROUTE_PATHS.adminQuestions,
  ROUTE_PATHS.adminModels,
  ROUTE_PATHS.adminConfigs,
];

export default function AdminLayout() {
  return (
    <RequireAdmin>
      <AdminWorkspace />
    </RequireAdmin>
  );
}

function AdminWorkspace() {
  const identity = useAdminIdentity();
  const [loggingOut, setLoggingOut] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const screens = Grid.useBreakpoint();
  const navigate = useNavigate();
  const location = useLocation();
  const {
    token: { colorBgContainer, borderRadiusLG },
  } = theme.useToken();

  const selectedKey = menuKeys.includes(location.pathname) ? location.pathname : ROUTE_PATHS.adminResults;

  useEffect(() => {
    const root = document.getElementById("root");
    const prevHtmlOverflow = document.documentElement.style.overflow;
    const prevBodyOverflow = document.body.style.overflow;
    const prevRootHeight = root?.style.height ?? "";
    const prevRootOverflow = root?.style.overflow ?? "";
    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    if (root) {
      root.style.height = "100%";
      root.style.overflow = "hidden";
    }
    return () => {
      document.documentElement.style.overflow = prevHtmlOverflow;
      document.body.style.overflow = prevBodyOverflow;
      if (root) {
        root.style.height = prevRootHeight;
        root.style.overflow = prevRootOverflow;
      }
    };
  }, []);

  return (
    <Layout className="h-screen overflow-hidden">
      <Sider
        trigger={null}
        collapsible
        collapsed={collapsed}
        theme="dark"
        breakpoint="md"
        collapsedWidth={screens.md ? 80 : 0}
        onBreakpoint={(broken) => setCollapsed(broken)}
      >
        <div
          className={`flex h-16 shrink-0 items-center justify-center font-semibold text-white transition-all ${
            collapsed ? "px-2 text-xs" : "px-4 text-sm"
          }`}
        >
          {collapsed ? "后台" : "AI 面试后台"}
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[selectedKey]}
          defaultOpenKeys={[settingsMenuKey]}
          items={menuItems}
          onClick={({ key }) => navigate(key)}
        />
      </Sider>
      <Layout className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <Header
          style={{ padding: "0 16px", background: colorBgContainer }}
          className="flex h-16 shrink-0 items-center justify-between"
        >
          <Space>
            <Button
              type="text"
              icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
              onClick={() => setCollapsed(!collapsed)}
              style={{ fontSize: 16, width: 40, height: 64 }}
            />
            <span className="whitespace-nowrap text-sm font-semibold text-stone-900 sm:text-base">
              AI 面试管理后台
            </span>
          </Space>
          <Space>
            <Link
              className="hidden shrink-0 whitespace-nowrap text-xs text-emerald-800 hover:text-emerald-950 sm:inline sm:text-sm"
              to={ROUTE_PATHS.interviewBasic}
            >
              返回面试端
            </Link>
            <Dropdown
              menu={{
                items: [
                  {
                    key: "identity",
                    label: `${identity?.name || identity?.username} · LINUX DO`,
                    disabled: true,
                  },
                  {
                    key: "candidate",
                    label: "返回面试端",
                    onClick: () => navigate(ROUTE_PATHS.interviewBasic),
                  },
                  { type: "divider" },
                  {
                    key: "logout",
                    label: "退出登录",
                    icon: <LogoutOutlined />,
                    disabled: loggingOut,
                    onClick: async () => {
                      setLoggingOut(true);
                      try {
                        await logout();
                        window.location.replace("/login");
                      } catch {
                        message.error("退出失败，请检查网络后重试。");
                        setLoggingOut(false);
                      }
                    },
                  },
                ],
              }}
              trigger={["click"]}
            >
              <Button
                type="text"
                aria-label="账号菜单"
                loading={loggingOut}
                className="!flex !items-center !gap-2"
              >
                <Avatar size="small" icon={<UserOutlined />} />
                <span className="hidden max-w-28 truncate text-sm md:inline">
                  {identity?.name || identity?.username}
                </span>
              </Button>
            </Dropdown>
          </Space>
        </Header>
        <Content
          className="!m-2 min-h-0 min-w-0 flex-1 overflow-y-auto md:!m-4"
          style={{
            padding: screens.md ? 24 : 12,
            background: colorBgContainer,
            borderRadius: borderRadiusLG,
          }}
        >
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}
