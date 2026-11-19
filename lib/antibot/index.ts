// ANTIBOT ADAPTERS: an optional challenge before creating an order. Chosen by ANTIBOT_PROVIDER.
// `none` (default) lets everything through. To add another (hCaptcha, reCAPTCHA…) implement
// `AntibotAdapter`, register it and teach components/checkout/AntibotWidget.tsx to render it.
//
// THE RULE: a token is SINGLE-USE and expires in minutes. After every submit — successful or
// not — the browser must get a fresh one before trying again (the widget does it).

import { env } from "@/lib/env";

export interface AntibotAdapter {
  readonly id: string;
  /** True when the token proves a human. Must not throw. */
  verify(token: string | undefined, remoteIp?: string): Promise<boolean>;
}

const none: AntibotAdapter = { id: "none", verify: async () => true };

const turnstile: AntibotAdapter = {
  id: "turnstile",
  async verify(token, remoteIp) {
    if (!token) return false;
    try {
      const body = new URLSearchParams({ secret: env().TURNSTILE_SECRET_KEY ?? "", response: token });
      if (remoteIp) body.set("remoteip", remoteIp);
      const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body });
      return ((await res.json()) as { success?: boolean }).success === true;
    } catch {
      return false;
    }
  },
};

export const antibotAdapters: Record<string, AntibotAdapter> = { none, turnstile };

export function antibot(): AntibotAdapter {
  return antibotAdapters[env().ANTIBOT_PROVIDER] ?? none;
}
