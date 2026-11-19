import { t } from "@/i18n";

/**
 * A legal page TEMPLATE. Every point is a heading plus "FILL IN": the business writes its real
 * conditions. The template invents nothing — a made-up return policy is a promise someone will
 * claim.
 */
export function LegalPage({ title, sections }: { title: string; sections: { heading: string; hint: string }[] }) {
  return (
    <div className="container page">
      <article className="prose">
        <h1>{title}</h1>
        <p className="notice" role="note" data-testid="legal-template-warning">{t.legal.templateWarning}</p>
        <p className="muted">{t.legal.lastUpdated}</p>
        {sections.map((s) => (
          <section key={s.heading}>
            <h2>{s.heading}</h2>
            <p><strong>{t.legal.fillIn}:</strong> {s.hint}</p>
          </section>
        ))}
      </article>
    </div>
  );
}
