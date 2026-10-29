const protectedPaths = new Set([
  "/admin",
  "/admin/",
  "/admin/results",
  "/admin/positions",
  "/admin/questions",
  "/admin/models",
  "/admin/daily-brief",
  "/admin/configs",
  "/interview/results",
  "/interview/results/written",
  "/interview/results/oral",
  "/",
  "/interview",
  "/interview/basic",
  "/interview/written",
  "/interview/oral",
  "/interview/done",
  "/m/upload",
]);

export function safeReturnPath(value: string | null) {
  if (!value || value.length > 1000 || /[\\\x00-\x1f]/.test(value)) return "/interview/basic";
  const path = value.split(/[?#]/)[0];
  return protectedPaths.has(path) ? value.split("#")[0] : "/interview/basic";
}

export function loginPath(next: string, error?: string) {
  const params = new URLSearchParams({ next: safeReturnPath(next) });
  if (error) params.set("error", error);
  return `/login?${params}`;
}

export function redirectExpiredLogin(status: number) {
  const path = window.location.pathname;
  if (status === 401 && path !== "/login") {
    window.location.replace(loginPath(path + window.location.search, "session_expired"));
  }
}
