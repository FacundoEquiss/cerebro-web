// Analytics consent, kept in the browser. Trackers load only after "accept".
// Which law applies depends on where the CUSTOMERS are: confirm it (see GETTING-STARTED.md)
// instead of copying another site's banner.

export type Consent = "granted" | "denied" | null;

const KEY = "consent.v1";
export const CONSENT_EVENT = "consent-change";

export function readConsent(): Consent {
  try {
    const v = localStorage.getItem(KEY);
    return v === "granted" || v === "denied" ? v : null;
  } catch {
    return null;
  }
}

export function writeConsent(value: Exclude<Consent, null>): void {
  try {
    localStorage.setItem(KEY, value);
  } catch {}
  window.dispatchEvent(new Event(CONSENT_EVENT));
}
