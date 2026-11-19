// WHERE DID THIS VISIT COME FROM? Captured in the browser on arrival and sent along with the
// order: first touch and last touch. Only campaign labels and the referrer's host + path are
// kept — never a full URL (query strings carry personal data).
//
// UTM convention (document it and always use it):
//   utm_source = the platform (instagram, google, newsletter…)   utm_medium = the kind of traffic
//   (paid_social, cpc, email…)   utm_campaign = the campaign name.
// Do not hand-write the mediums analytics tools infer on their own (organic, referral, ai).

export interface Touch {
  source?: string;
  medium?: string;
  campaign?: string;
  content?: string;
  term?: string;
  gclid?: string;
  fbclid?: string;
  referrer?: string;
  landing?: string;
}

const STORAGE_KEY = "attribution.v1";
const PARAMS: Record<string, keyof Touch> = {
  utm_source: "source",
  utm_medium: "medium",
  utm_campaign: "campaign",
  utm_content: "content",
  utm_term: "term",
  gclid: "gclid",
  fbclid: "fbclid",
};

/** Pure: the touch described by a URL and a referrer, or `null` if it says nothing new. */
export function touchFrom(url: string, referrer: string, ownHost: string): Touch | null {
  const touch: Touch = {};
  let landing: URL;
  try {
    landing = new URL(url);
  } catch {
    return null;
  }
  for (const [param, key] of Object.entries(PARAMS)) {
    const v = landing.searchParams.get(param);
    if (v) touch[key] = v.slice(0, 150);
  }
  try {
    const ref = new URL(referrer);
    if (ref.host && ref.host !== ownHost) touch.referrer = `${ref.host}${ref.pathname}`.slice(0, 200);
  } catch {}
  if (Object.keys(touch).length === 0) return null;
  touch.landing = landing.pathname.slice(0, 200);
  return touch;
}

/** Call once per page load in the browser. */
export function captureAttribution(): void {
  try {
    const touch = touchFrom(window.location.href, document.referrer, window.location.host);
    if (!touch) return;
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as { first?: Touch; last?: Touch };
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ first: stored.first ?? touch, last: touch }));
  } catch {
    // Private mode or storage disabled: the order simply has no attribution.
  }
}

/** Flat `{ first_source, last_medium, … }` record to send with the order. */
export function readAttribution(): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as { first?: Touch; last?: Touch };
    for (const which of ["first", "last"] as const) {
      for (const [k, v] of Object.entries(stored[which] ?? {})) if (v) out[`${which}_${k}`] = String(v);
    }
  } catch {}
  return out;
}
