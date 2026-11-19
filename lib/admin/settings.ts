// The read-only "Settings" screen: which adapters are active and what is still missing to sell
// for real. It reports NAMES and STATES only — never the value of a variable.

import { brand } from "@/config/brand";
import { t } from "@/i18n";
import { data } from "@/lib/data";
import { env, type Env } from "@/lib/env";

type State = "ok" | "warn" | "plain";
interface Row { label: string; value: string; state: State }
export interface SettingsReport {
  groups: { title: string; rows: Row[] }[];
  missing: { key: string; why: string }[];
}

const s = t.admin.settings;
const has = (v: unknown): Row["value"] => (v ? s.configured : s.missing);
const state = (v: unknown): State => (v ? "ok" : "warn");

/** Pure: what a given environment still needs before it can sell for real. */
export function missingForRealUse(e: Env, examples: { whatsapp: string | null; email: string }): SettingsReport["missing"] {
  const out: SettingsReport["missing"] = [];
  const need = (key: string, why: string) => out.push({ key, why });
  if (!e.isProduction) need("APP_ENV=production", s.why.production);
  if (!e.NEXT_PUBLIC_SITE_URL && !e.VERCEL_PROJECT_PRODUCTION_URL) need("NEXT_PUBLIC_SITE_URL", s.why.siteUrl);
  if (e.DATA_SOURCE === "json") need("DATA_SOURCE", s.why.data);
  if (!e.ORDER_SECRET) need("ORDER_SECRET", s.why.orderSecret);
  if (e.adminUsers.length === 0) need("ADMIN_USERS", s.why.adminUsers);
  if (e.demoMode) need("DEMO_MODE=false", s.why.demoMode);
  if (!e.ORDER_NOTIFY_EMAIL || e.MAIL_PROVIDER === "console") need("MAIL_PROVIDER + ORDER_NOTIFY_EMAIL", s.why.mail);
  if (e.allowIndexing === false) need("ALLOW_INDEXING=1", s.why.indexing);
  if (examples.email.endsWith("@example.com") || examples.whatsapp === "0000000000") need("config/brand.ts", s.why.brand);
  return out;
}

export async function settingsReport(): Promise<SettingsReport> {
  const e = env();
  const adapter = await data();
  return {
    missing: missingForRealUse(e, { whatsapp: brand.contact.whatsapp, email: brand.contact.email }),
    groups: [
      {
        title: s.environment,
        rows: [
          { label: s.environment, value: e.isProduction ? s.production : s.notProduction, state: e.isProduction ? "ok" : "warn" },
          { label: s.indexing, value: e.allowIndexing ? s.on : s.off, state: e.allowIndexing ? "ok" : "warn" },
          { label: "URL", value: e.siteUrl, state: "plain" },
        ],
      },
      {
        title: s.data,
        rows: [
          { label: "DATA_SOURCE", value: adapter.id, state: adapter.id === "json" ? "warn" : "ok" },
          { label: s.data, value: adapter.writable ? s.writable : s.readOnly, state: adapter.writable ? "ok" : "warn" },
          { label: s.storage, value: e.STORAGE_PROVIDER, state: "plain" },
        ],
      },
      {
        title: s.payments,
        rows: [
          { label: "PAYMENT_PROVIDER", value: e.PAYMENT_PROVIDER, state: "plain" },
          { label: "ORDER_SECRET", value: has(e.ORDER_SECRET), state: state(e.ORDER_SECRET) },
          { label: s.antibot, value: e.ANTIBOT_PROVIDER, state: "plain" },
        ],
      },
      {
        title: s.users,
        rows: [
          { label: "ADMIN_USERS", value: String(e.adminUsers.length), state: state(e.adminUsers.length > 0) },
          { label: s.demoUser, value: e.demoMode ? s.on : s.off, state: e.demoMode ? "warn" : "ok" },
        ],
      },
      {
        title: s.mail,
        rows: [
          { label: "MAIL_PROVIDER", value: e.MAIL_PROVIDER, state: e.MAIL_PROVIDER === "console" ? "warn" : "ok" },
          { label: "ORDER_NOTIFY_EMAIL", value: has(e.ORDER_NOTIFY_EMAIL), state: state(e.ORDER_NOTIFY_EMAIL) },
        ],
      },
      {
        title: s.analytics,
        rows: [
          { label: "GA4", value: has(e.NEXT_PUBLIC_GA4_ID), state: "plain" },
          { label: "Pixel + Conversions API", value: has(e.NEXT_PUBLIC_META_PIXEL_ID && e.META_CAPI_TOKEN), state: "plain" },
          { label: "Clarity", value: has(e.NEXT_PUBLIC_CLARITY_ID), state: "plain" },
          { label: "IndexNow", value: has(e.INDEXNOW_KEY), state: "plain" },
        ],
      },
    ],
  };
}
