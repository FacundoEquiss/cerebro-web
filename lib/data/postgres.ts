// DATA ADAPTER: postgres. Any PostgreSQL 14+ reachable through DATABASE_URL (a managed database,
// a VPS, a container…), using the `pg` driver. Same schema as Supabase: db/schema.sql.
//
// `postgresGateway(query)` takes the function that runs a query, so the tests can hand it an
// in-process database and exercise the real SQL.

import { revalidateTag, unstable_cache } from "next/cache";
import { env } from "@/lib/env";
import { SQL_ARGS, sqlAdapter, type SqlFunction, type SqlGateway } from "./sql";

export type Query = (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;

const JSON_ARGS = new Set(["p"]);
const CASTS: Record<string, string> = {
  p_amount: "::numeric", p_limit: "::int", p_stock: "::numeric", p_hours: "::numeric", p_total: "::numeric",
  p_since: "::timestamptz", p_until: "::timestamptz",
};

/** `select fn($1::jsonb, $2…) as r`, built from the shared argument table. */
function callSql(fn: SqlFunction): string {
  const args = SQL_ARGS[fn].map((name, i) => "$" + (i + 1) + (JSON_ARGS.has(name) ? "::jsonb" : (CASTS[name] ?? "")));
  return `select ${fn}(${args.join(", ")}) as r`;
}

export function postgresGateway(query: Query): SqlGateway {
  return {
    catalog: async () => (await query("select * from public_catalog order by created_at desc, id")).rows,
    categories: async () => (await query("select * from public_categories order by position, slug")).rows,
    call: async (fn, args) => {
      const params = SQL_ARGS[fn].map((name, i) => (JSON_ARGS.has(name) ? JSON.stringify(args[i]) : (args[i] ?? null)));
      const { rows } = await query(callSql(fn), params);
      return rows[0]?.r ?? null;
    },
  };
}

let pool: import("pg").Pool | undefined;

const live: Query = async (sql, params) => {
  if (!pool) {
    const { Pool } = await import("pg");
    pool = new Pool({ connectionString: env().DATABASE_URL, max: 5 });
  }
  return pool.query(sql, params);
};

const gateway = postgresGateway(live);

export const postgresAdapter = sqlAdapter("postgres", {
  // The catalogue is read on almost every page: keep it for five minutes (tag: "catalog").
  catalog: unstable_cache(() => gateway.catalog(), ["pg-catalog"], { revalidate: 300, tags: ["catalog"] }),
  categories: unstable_cache(() => gateway.categories(), ["pg-categories"], { revalidate: 300, tags: ["catalog"] }),
  call: gateway.call,
  invalidate: () => revalidateTag("catalog", { expire: 0 }),
});
