// DATA ADAPTER: supabase. Talks to the project's REST API (PostgREST) with plain `fetch`, so the
// template carries no SDK. Reads use the PUBLIC key against the public views; writes use the
// SERVICE key, which never leaves the server (this module is only imported by server code).

import { env } from "@/lib/env";
import { revalidateTag } from "next/cache";
import { SQL_ARGS, sqlAdapter, type SqlGateway } from "./sql";

async function rest(path: string, key: string, init?: RequestInit & { next?: { revalidate: number; tags?: string[] } }) {
  const res = await fetch(`${env().SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...init?.headers },
  });
  const text = await res.text();
  if (!res.ok) {
    // PostgREST puts the message of `raise exception` in `message`.
    let message = text;
    try {
      message = (JSON.parse(text) as { message?: string }).message ?? text;
    } catch {}
    throw new Error(message);
  }
  return text ? JSON.parse(text) : null;
}

const gateway: SqlGateway = {
  catalog: () => rest("public_catalog?select=*", env().SUPABASE_ANON_KEY!, { next: { revalidate: 300, tags: ["catalog"] } }),
  categories: () =>
    rest("public_categories?select=*&order=position", env().SUPABASE_ANON_KEY!, { next: { revalidate: 300, tags: ["catalog"] } }),
  call: (fn, args) =>
    rest(`rpc/${fn}`, env().SUPABASE_SERVICE_ROLE_KEY!, {
      method: "POST",
      cache: "no-store",
      body: JSON.stringify(Object.fromEntries(SQL_ARGS[fn].map((name, i) => [name, args[i] ?? null]))),
    }),
  invalidate: () => revalidateTag("catalog", { expire: 0 }),
};

export const supabaseAdapter = sqlAdapter("supabase", gateway);
