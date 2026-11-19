"use client";
import { t } from "@/i18n";

export default function StoreError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="container page empty-state">
      <h1>{t.error.title}</h1>
      <p className="muted">{t.error.text}</p>
      <button type="button" className="btn" onClick={reset}>{t.common.retry}</button>
    </div>
  );
}
