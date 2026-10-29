import axios from "axios";
import { API_BASE_URL } from "../interview/api";
import { safeReturnPath } from "./navigation";

export type AdminIdentity = { id: string; username: string; name: string; role: "admin" | "candidate" };
const authClient = axios.create({ baseURL: API_BASE_URL, withCredentials: true, timeout: 15_000 });

export async function fetchIdentity() {
  const { data } = await authClient.get<AdminIdentity>("/api/auth/me");
  return data;
}
export async function fetchAuthConfig() {
  const { data } = await authClient.get<{ provider: string; configured: boolean }>("/api/auth/config");
  return data;
}
export async function logout() {
  await authClient.post("/api/auth/logout");
}
export function authorizationUrl(next: string) {
  return `${API_BASE_URL}/api/auth/linuxdo/login?${new URLSearchParams({ next: safeReturnPath(next) })}`;
}
