// Environment variables, validated once with Zod. Import `env()` instead of reading
// `process.env` around the code: a typo or a half-configured provider fails loudly here, with a
// message a non-programmer can act on, instead of failing in the middle of a purchase.
//
// SERVER ONLY. Nothing in this file may reach the browser: the browser reads the few public
// values through `lib/public-env.ts`.

import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";

const optional = z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), z.string().trim().optional());
const optionalUrl = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
  z.string().trim().url().optional(),
);

const schema = z
  .object({
    NEXT_PUBLIC_SITE_URL: optionalUrl,
    VERCEL_ENV: optional,
    VERCEL_PROJECT_PRODUCTION_URL: optional,
    APP_ENV: optional,
    NEXT_PHASE: optional,
    ALLOW_INDEXING: optional,

    DATA_SOURCE: z.preprocess((v) => v || "json", z.enum(["json", "supabase", "postgres"])),
    SUPABASE_URL: optionalUrl,
    SUPABASE_ANON_KEY: optional,
    SUPABASE_SERVICE_ROLE_KEY: optional,
    DATABASE_URL: optional,

    ORDER_SECRET: optional,
    // Hours an unpaid order may hold its stock before it is cancelled. 0 = never.
    ORDER_EXPIRY_HOURS: z.preprocess((v) => (v === undefined || v === "" ? 48 : Number(v)), z.number().min(0).max(24 * 365)),
    CRON_SECRET: optional,
    TRUSTED_PROXY_HEADER: optional,

    PAYMENT_PROVIDER: z.preprocess((v) => v || "manual", z.enum(["manual", "mercadopago", "stripe"])),
    MERCADOPAGO_ACCESS_TOKEN: optional,
    MERCADOPAGO_WEBHOOK_SECRET: optional,
    STRIPE_SECRET_KEY: optional,
    STRIPE_WEBHOOK_SECRET: optional,

    DATA_DIR: optional,
    STORAGE_PROVIDER: z.preprocess((v) => v || "local", z.enum(["local", "supabase"])),
    SUPABASE_STORAGE_BUCKET: z.preprocess((v) => v || "products", z.string().trim()),

    DEMO_MODE: z.preprocess((v) => (v === "" ? undefined : v), z.enum(["true", "false"]).optional()),
    ADMIN_USERS: optional,
    ADMIN_SESSION_SECRET: optional,

    MAIL_PROVIDER: z.preprocess((v) => (!v || v === "none" ? "console" : v), z.enum(["console", "resend", "smtp"])),
    RESEND_API_KEY: optional,
    SMTP_URL: optional,
    MAIL_FROM: optional,
    ORDER_NOTIFY_EMAIL: optional,

    ANTIBOT_PROVIDER: z.preprocess((v) => v || "none", z.enum(["none", "turnstile"])),
    NEXT_PUBLIC_TURNSTILE_SITE_KEY: optional,
    TURNSTILE_SECRET_KEY: optional,

    NEXT_PUBLIC_GA4_ID: optional,
    GA4_API_SECRET: optional,
    NEXT_PUBLIC_META_PIXEL_ID: optional,
    META_CAPI_TOKEN: optional,
    NEXT_PUBLIC_CLARITY_ID: optional,

    INDEXNOW_KEY: optional,
  })
  .superRefine((e, ctx) => {
    const need = (key: keyof typeof e, why: string) => {
      if (!e[key]) ctx.addIssue({ code: "custom", path: [key], message: `is required ${why}` });
    };
    if (e.DATA_SOURCE === "supabase") {
      need("SUPABASE_URL", "when DATA_SOURCE=supabase");
      need("SUPABASE_ANON_KEY", "when DATA_SOURCE=supabase");
      need("SUPABASE_SERVICE_ROLE_KEY", "when DATA_SOURCE=supabase (orders are written with it, on the server only)");
    }
    if (e.DATA_SOURCE === "postgres") need("DATABASE_URL", "when DATA_SOURCE=postgres");
    if (e.PAYMENT_PROVIDER === "mercadopago") {
      need("MERCADOPAGO_ACCESS_TOKEN", "when PAYMENT_PROVIDER=mercadopago");
      need("MERCADOPAGO_WEBHOOK_SECRET", "when PAYMENT_PROVIDER=mercadopago (an unsigned webhook lets anyone mark orders as paid)");
    }
    if (e.PAYMENT_PROVIDER === "stripe") {
      need("STRIPE_SECRET_KEY", "when PAYMENT_PROVIDER=stripe");
      need("STRIPE_WEBHOOK_SECRET", "when PAYMENT_PROVIDER=stripe (an unsigned webhook lets anyone mark orders as paid)");
    }
    const production = (e.VERCEL_ENV ?? e.APP_ENV) === "production";
    // The real store, real money or a real database: the receipts are signed with a private secret.
    // (While the site is being BUILT nothing is signed, so an image can be built without secrets;
    // the server then refuses to START without them — see instrumentation.ts.)
    const building = e.NEXT_PHASE === "phase-production-build";
    if (production && !building) {
      need("ORDER_SECRET", "in production (32+ random characters; it signs the order receipts and the admin sessions)");
    } else if (e.DATA_SOURCE !== "json" || e.PAYMENT_PROVIDER !== "manual") {
      need("ORDER_SECRET", "with a database or a payment gateway (32+ random characters; it signs the order receipts)");
    }
    // Without a database nothing remembers an order: a payment could not be matched or audited.
    if (production && e.DATA_SOURCE === "json" && e.PAYMENT_PROVIDER !== "manual") {
      ctx.addIssue({
        code: "custom",
        path: ["PAYMENT_PROVIDER"],
        message: `=${e.PAYMENT_PROVIDER} cannot be used with DATA_SOURCE=json in production: to charge online, connect a database (DATA_SOURCE=supabase or postgres)`,
      });
    }
    if (e.CRON_SECRET && e.CRON_SECRET.length < 16) {
      ctx.addIssue({ code: "custom", path: ["CRON_SECRET"], message: "must have at least 16 characters" });
    }
    if (e.TRUSTED_PROXY_HEADER && !/^[A-Za-z0-9-]+$/.test(e.TRUSTED_PROXY_HEADER)) {
      ctx.addIssue({ code: "custom", path: ["TRUSTED_PROXY_HEADER"], message: "must be a header name (for example x-real-ip) or `none`" });
    }
    if (e.ORDER_SECRET && e.ORDER_SECRET.length < 32) {
      ctx.addIssue({ code: "custom", path: ["ORDER_SECRET"], message: "must have at least 32 characters" });
    }
    if (e.STORAGE_PROVIDER === "supabase") {
      need("SUPABASE_URL", "when STORAGE_PROVIDER=supabase");
      need("SUPABASE_SERVICE_ROLE_KEY", "when STORAGE_PROVIDER=supabase (uploads are written with it, on the server only)");
    }
    if (e.ADMIN_USERS) {
      if (parseAdminUsers(e.ADMIN_USERS) === null) {
        ctx.addIssue({ code: "custom", path: ["ADMIN_USERS"], message: "must look like email:hash,email:hash (create each hash with `npm run admin:hash`)" });
      }
      const secret = e.ADMIN_SESSION_SECRET ?? e.ORDER_SECRET;
      if (!secret || secret.length < 32) {
        ctx.addIssue({ code: "custom", path: ["ADMIN_SESSION_SECRET"], message: "is required when ADMIN_USERS is set (32+ random characters; it signs the admin session cookie)" });
      }
    }
    if (e.MAIL_PROVIDER === "smtp") {
      need("SMTP_URL", "when MAIL_PROVIDER=smtp (smtps://user:password@host:465)");
      need("MAIL_FROM", "when MAIL_PROVIDER=smtp");
    }
    if (e.MAIL_PROVIDER === "resend") {
      need("RESEND_API_KEY", "when MAIL_PROVIDER=resend");
      need("MAIL_FROM", "when MAIL_PROVIDER=resend");
    }
    if (e.ANTIBOT_PROVIDER === "turnstile") {
      need("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "when ANTIBOT_PROVIDER=turnstile");
      need("TURNSTILE_SECRET_KEY", "when ANTIBOT_PROVIDER=turnstile");
    }
    if (e.INDEXNOW_KEY && !/^[A-Za-z0-9-]{8,128}$/.test(e.INDEXNOW_KEY)) {
      ctx.addIssue({ code: "custom", path: ["INDEXNOW_KEY"], message: "must be 8 to 128 letters, digits or dashes" });
    }
  });

export interface AdminUser {
  email: string;
  /** `scrypt.<salt>.<hash>` — see lib/admin/password.ts. Never a plain password. */
  hash: string;
}

/** `email:hash,email:hash` (commas or new lines) → users. `null` when the text is malformed. */
export function parseAdminUsers(value: string | undefined): AdminUser[] | null {
  if (!value) return [];
  const users: AdminUser[] = [];
  for (const entry of value.split(/[,\n]/).map((v) => v.trim()).filter(Boolean)) {
    const i = entry.indexOf(":");
    const email = entry.slice(0, i).trim().toLowerCase();
    const hash = entry.slice(i + 1).trim();
    if (i < 1 || !email.includes("@") || !/^scrypt\.[\w-]+\.[\w-]+$/.test(hash)) return null;
    users.push({ email, hash });
  }
  return users;
}

export type RawEnv = z.infer<typeof schema>;

export interface Env extends RawEnv {
  /** Public origin of the store, without a trailing slash. */
  siteUrl: string;
  /** The real, public store: Vercel production, or APP_ENV=production on any other host. */
  isProduction: boolean;
  /** Search engines may index it: production AND `ALLOW_INDEXING=1`. Safe default: no. */
  allowIndexing: boolean;
  /** No ORDER_SECRET: an unconfigured demo (never the case in production). */
  isDemo: boolean;
  /**
   * The key that signs order receipts: ORDER_SECRET, or — only outside production — a random
   * secret created on this machine. There is NO fixed, public fallback key.
   */
  orderSecret: string;
  /** Admin accounts from ADMIN_USERS. */
  adminUsers: AdminUser[];
  /** The key that signs the admin session cookie. Always private (see `orderSecret`). */
  adminSecret: string;
  /**
   * The admin panel offers a READ-ONLY demo user with its credentials on the login screen.
   * On with DEMO_MODE=true, or on its own while the store is an unconfigured demo (json data and
   * no ADMIN_USERS). DEMO_MODE=false switches it off.
   */
  demoMode: boolean;
}

export class EnvError extends Error {}

/**
 * A random secret for THIS machine, used only outside production when ORDER_SECRET is not set
 * (a laptop, the test suite). It is kept in DATA_DIR so order links survive a restart; if the
 * disk cannot be written it lives for the life of the process. It is never a constant: nobody
 * who reads this repository can sign a receipt or a session.
 */
function localSecret(): string {
  const g = globalThis as unknown as { __localSecret?: string };
  if (g.__localSecret) return g.__localSecret;
  const file = join(/* turbopackIgnore: true */ resolve(/* turbopackIgnore: true */ process.env.DATA_DIR || ".data"), ".local-secret");
  try {
    const saved = readFileSync(/* turbopackIgnore: true */ file, "utf8").trim();
    if (saved.length >= 32) return (g.__localSecret = saved);
  } catch {}
  const secret = randomBytes(32).toString("base64url");
  try {
    mkdirSync(/* turbopackIgnore: true */ dirname(/* turbopackIgnore: true */ file), { recursive: true });
    // "wx": if another process created it first, use theirs.
    writeFileSync(/* turbopackIgnore: true */ file, secret, { mode: 0o600, flag: "wx" });
  } catch {
    try {
      const saved = readFileSync(/* turbopackIgnore: true */ file, "utf8").trim();
      if (saved.length >= 32) return (g.__localSecret = saved);
    } catch {}
  }
  return (g.__localSecret = secret);
}

/** Pure: validates any record of variables. Throws `EnvError` listing every problem. */
export function parseEnv(raw: Record<string, string | undefined>, fallbackSecret: () => string = localSecret): Env {
  const r = schema.safeParse(raw);
  if (!r.success) {
    const lines = r.error.issues.map((i) => `  - ${i.path.join(".") || "env"} ${i.message}`);
    throw new EnvError(`Invalid environment variables (see .env.example):\n${lines.join("\n")}`);
  }
  const e = r.data;
  const appEnv = e.VERCEL_ENV ?? e.APP_ENV ?? "development";
  const isProduction = appEnv === "production";
  const siteUrl = (
    e.NEXT_PUBLIC_SITE_URL ??
    (e.VERCEL_PROJECT_PRODUCTION_URL ? `https://${e.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3000")
  ).replace(/\/+$/, "");
  // In production the schema above already made ORDER_SECRET mandatory.
  const orderSecret = e.ORDER_SECRET ?? fallbackSecret();
  return {
    ...e,
    siteUrl,
    isProduction,
    allowIndexing: isProduction && e.ALLOW_INDEXING === "1",
    isDemo: !e.ORDER_SECRET,
    orderSecret,
    adminUsers: parseAdminUsers(e.ADMIN_USERS) ?? [],
    adminSecret: e.ADMIN_SESSION_SECRET ?? orderSecret,
    demoMode: e.DEMO_MODE === "true" || (e.DEMO_MODE !== "false" && !e.ADMIN_USERS && e.DATA_SOURCE === "json"),
  };
}

let cached: Env | undefined;

/** The validated environment of this process. */
export function env(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}
