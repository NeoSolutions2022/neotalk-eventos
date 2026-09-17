export const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api/v1";

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  role: "user" | "admin";
  csrf_token: string;
  onboarding_version: number;
  onboarding_step: number;
  onboarding_status: "pending" | "completed" | "skipped";
};

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

let csrfToken = "";

export function setSession(user: SessionUser | null) {
  csrfToken = user?.csrf_token || "";
}

export async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const method = (options.method || "GET").toUpperCase();
  const headers = new Headers(options.headers);
  if (options.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (!["GET", "HEAD", "OPTIONS"].includes(method) && csrfToken) headers.set("X-CSRF-Token", csrfToken);
  const response = await fetch(`${API_BASE}${path}`, { ...options, headers, credentials: "include" });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new ApiError(response.status, payload.detail || `Falha da API (${response.status})`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export async function loadSession(): Promise<SessionUser> {
  const user = await apiRequest<SessionUser>("/auth/me");
  setSession(user);
  return user;
}

export async function authenticate(kind: "login" | "register", data: Record<string, string>) {
  const user = await apiRequest<SessionUser>(`/auth/${kind}`, { method: "POST", body: JSON.stringify(data) });
  setSession(user);
  return user;
}
