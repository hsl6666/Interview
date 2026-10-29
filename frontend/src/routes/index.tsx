import { createBrowserRouter, Navigate, Outlet, type RouteObject } from "react-router-dom";
import { ProgressBar } from "@/components/ProgressBar";
import { echartsDemoRoute } from "./echarts-demo";
import { landingRoute } from "./landing";
import { ROUTE_PATHS } from "@/constants/common";

import RequireAdmin, { RequireLogin } from "@/features/auth/RequireAdmin";

const routes: RouteObject[] = [
  {
    path: "/interview",
    children: [
      {
        index: true,
        element: <Navigate replace to="basic" />,
      },
      {
        path: "basic",
        lazy: async () => ({
          Component: (await import("@/features/interview/pages/BasicInfoPage")).default,
        }),
        HydrateFallback: ProgressBar,
      },
      {
        path: "written",
        lazy: async () => ({
          Component: (await import("@/features/interview/pages/WrittenExamPage")).default,
        }),
        HydrateFallback: ProgressBar,
      },
      {
        path: "oral",
        lazy: async () => ({
          Component: (await import("@/features/interview/pages/OralInterviewPage")).default,
        }),
        HydrateFallback: ProgressBar,
      },
      {
        path: "done",
        lazy: async () => ({
          Component: (await import("@/features/interview/pages/CompletePage")).default,
        }),
        HydrateFallback: ProgressBar,
      },
      {
        path: "results",
        lazy: async () => {
          const ResultsPage = (await import("@/features/interview/pages/ResultsPage")).default;
          return {
            Component: () => (
              <RequireAdmin>
                <ResultsPage />
              </RequireAdmin>
            ),
          };
        },
        HydrateFallback: ProgressBar,
      },
      {
        path: "results/written",
        lazy: async () => {
          const WrittenAnswersReviewPage = (
            await import("@/features/interview/pages/WrittenAnswersReviewPage")
          ).default;
          return {
            Component: () => (
              <RequireAdmin>
                <WrittenAnswersReviewPage />
              </RequireAdmin>
            ),
          };
        },
        HydrateFallback: ProgressBar,
      },
      {
        path: "results/oral",
        lazy: async () => {
          const OralAnswersReviewPage = (await import("@/features/interview/pages/OralAnswersReviewPage"))
            .default;
          return {
            Component: () => (
              <RequireAdmin>
                <OralAnswersReviewPage />
              </RequireAdmin>
            ),
          };
        },
        HydrateFallback: ProgressBar,
      },
    ],
  },
  {
    path: "/",
    lazy: async () => ({
      Component: (await import("@/layouts")).default,
    }),
    HydrateFallback: ProgressBar,
    children: [
      {
        index: true,
        element: <Navigate replace to={ROUTE_PATHS.interviewBasic} />,
      },
      landingRoute,
      echartsDemoRoute,
    ],
  },
  {
    path: "/admin",
    lazy: async () => ({
      Component: (await import("@/features/interview/admin/AdminLayout")).default,
    }),
    HydrateFallback: ProgressBar,
    children: [
      {
        index: true,
        element: <Navigate replace to="results" />,
        HydrateFallback: ProgressBar,
      },
      {
        path: "results",
        lazy: async () => ({
          Component: (await import("@/features/interview/admin/pages/ResultsManagementPage")).default,
        }),
        HydrateFallback: ProgressBar,
      },
      {
        path: "positions",
        lazy: async () => ({
          Component: (await import("@/features/interview/admin/pages/PositionsManagementPage")).default,
        }),
        HydrateFallback: ProgressBar,
      },
      {
        path: "questions",
        lazy: async () => ({
          Component: (await import("@/features/interview/admin/pages/QuestionsManagementPage")).default,
        }),
        HydrateFallback: ProgressBar,
      },
      {
        path: "models",
        lazy: async () => ({
          Component: (await import("@/features/interview/admin/pages/ModelManagementPage")).default,
        }),
        HydrateFallback: ProgressBar,
      },
      {
        path: "daily-brief",
        lazy: async () => ({
          Component: (await import("@/features/interview/admin/pages/DailyBriefPage")).default,
        }),
        HydrateFallback: ProgressBar,
      },
      {
        path: "configs",
        lazy: async () => ({
          Component: (await import("@/features/interview/admin/pages/ConfigManagementPage")).default,
        }),
        HydrateFallback: ProgressBar,
      },
    ],
  },
  {
    path: "/backend",
    lazy: async () => ({
      Component: (await import("@/layouts/backendLayout")).default,
    }),
    HydrateFallback: ProgressBar,
    children: [
      {
        index: true,
        element: <Navigate replace to="./landing" />,
      },
      {
        path: "landing",
        lazy: async () => ({
          Component: (await import("@/pages/Landing")).default,
        }),
        HydrateFallback: ProgressBar,
        handle: {
          title: "首页",
        },
      },
      {
        path: "echarts-demo",
        lazy: async () => ({
          Component: (await import("@/pages/EchartsDemo/Layout")).default,
        }),
        HydrateFallback: ProgressBar,
        handle: {
          title: "Echarts Demo",
        },
      },
      {
        path: "tabs-demo",
        lazy: async () => ({
          Component: (await import("@/pages/EchartsDemo/Layout")).default,
        }),
        HydrateFallback: ProgressBar,
        handle: {
          title: "Tabs Demo",
        },
      },
    ],
  },
  {
    path: "*",
    lazy: async () => ({
      Component: (await import("@/pages/NotFound")).default,
    }),
    HydrateFallback: ProgressBar,
  },
];

export const router = createBrowserRouter(
  [
    {
      path: "/login",
      lazy: async () => ({ Component: (await import("@/features/auth/LoginPage")).default }),
      HydrateFallback: ProgressBar,
    },
    {
      element: (
        <RequireLogin>
          <Outlet />
        </RequireLogin>
      ),
      children: routes,
    },
  ],
  {
    basename: import.meta.env.VITE_APP_BASE_URL,
    future: {
      v7_relativeSplatPath: true,
      v7_fetcherPersist: true,
      v7_normalizeFormMethod: true,
      v7_partialHydration: true,
      v7_skipActionErrorRevalidation: true,
    },
  },
);
