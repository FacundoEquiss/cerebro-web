"use client";
// How the admin screens talk to /api/admin. A 401 means the session ended: go to the login.

export interface ApiResult<T> {
  ok: boolean;
  status: number;
  data: T & { error?: string; field?: string };
}

export async function adminFetch<T>(url: string, init?: RequestInit & { json?: unknown }): Promise<ApiResult<T>> {
  try {
    const response = await fetch(url, {
      ...init,
      ...(init?.json !== undefined
        ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(init.json) }
        : {}),
      cache: "no-store",
    });
    if (response.status === 401 && !url.endsWith("/login")) {
      window.location.assign("/admin/login");
    }
    const data = (await response.json().catch(() => ({}))) as T & { error?: string };
    return { ok: response.ok, status: response.status, data };
  } catch {
    return { ok: false, status: 0, data: { error: "network" } as T & { error?: string } };
  }
}
