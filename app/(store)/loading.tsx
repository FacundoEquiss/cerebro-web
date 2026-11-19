import { t } from "@/i18n";

/** Shown while a page streams in: grey blocks with the shape of the content (no layout jump). */
export default function Loading() {
  return (
    <div className="container page" role="status" aria-live="polite">
      <span className="sr-only">{t.common.loading}</span>
      <div className="skeleton" style={{ height: 36, width: "min(320px, 70%)" }} />
      <div className="skeleton-grid" aria-hidden>
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="skeleton" style={{ aspectRatio: "4 / 5" }} />
        ))}
      </div>
    </div>
  );
}
