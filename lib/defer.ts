// Work that must happen AFTER the response and must not be lost: `after()` keeps the server (and
// a serverless function) alive until it finishes. A bare promise is not enough — the platform may
// freeze the process as soon as the response is sent. Outside a request (tests, scripts) the work
// simply runs.

import { after } from "next/server";

export function defer(work: () => Promise<unknown>, label: string): void {
  const safe = () => work().catch((e) => console.error(`[${label}]`, e instanceof Error ? e.message : e));
  try {
    after(safe);
  } catch {
    void safe();
  }
}
