"use client";
import { t } from "@/i18n";
import { analyticsConfigured } from "@/lib/public-env";

/** Re-opens the consent banner. Hidden when there is nothing to consent to. */
export function ConsentLink() {
  if (!analyticsConfigured) return null;
  return (
    <button type="button" onClick={() => window.dispatchEvent(new Event("consent-open"))}>
      {t.footer.cookiePreferences}
    </button>
  );
}
