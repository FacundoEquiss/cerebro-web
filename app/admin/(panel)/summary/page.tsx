import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { fill, t } from "@/i18n";
import { getSession } from "@/lib/admin/auth";
import { salesSummary, type PeriodSummary } from "@/lib/admin/reports";
import { data } from "@/lib/data";
import { formatPrice } from "@/lib/format";
import { formatShortDate } from "@/components/admin/format";
import styles from "./summary.module.css";

export const metadata: Metadata = { title: t.admin.summary.title };
const s = t.admin.summary;

function Period({ title, value, testId }: { title: string; value: PeriodSummary; testId: string }) {
  return (
    <section className={`admin-card ${styles.period}`} aria-label={title} data-testid={testId}>
      <h2>{title}</h2>
      <p className={styles.big}>{formatPrice(value.sales)}</p>
      <dl>
        <div><dt>{s.orders}</dt><dd>{value.orders}</dd></div>
        <div><dt>{s.averageTicket}</dt><dd>{value.paidOrders > 0 ? formatPrice(value.averageTicket) : "—"}</dd></div>
        <div><dt>{s.pending}</dt><dd>{value.pendingPayment}{value.pendingPayment > 0 ? ` · ${formatPrice(value.pendingAmount)}` : ""}</dd></div>
      </dl>
    </section>
  );
}

export default async function SummaryPage() {
  if (!(await getSession())) redirect("/admin/login");
  const summary = salesSummary(await (await data()).listOrders());
  const max = Math.max(1, ...summary.daily.map((d) => d.sales));
  const total = summary.daily.reduce((sum, d) => sum + d.sales, 0);
  // A plain SVG bar chart: thirty rectangles, no charting library.
  const W = 600, H = 160, gap = 4, bar = (W - gap * 29) / 30;
  const topUnits = Math.max(1, ...summary.topProducts.map((p) => p.units));

  return (
    <>
      <div className="admin-head"><h1>{s.title}</h1></div>
      <div className={styles.periods}>
        <Period title={s.today} value={summary.today} testId="summary-today" />
        <Period title={s.week} value={summary.week} testId="summary-week" />
        <Period title={s.month} value={summary.month} testId="summary-month" />
      </div>

      <section className="admin-card" aria-labelledby="chart-title">
        <h2 id="chart-title" className={styles.cardTitle}>{s.chartTitle}</h2>
        {total > 0 ? (
          <figure className={styles.chart}>
            <svg viewBox={`0 0 ${W} ${H + 22}`} role="img" aria-label={`${s.chartTitle}: ${formatPrice(total)}`} data-testid="sales-chart">
              <line x1="0" y1={H} x2={W} y2={H} className={styles.axis} />
              {summary.daily.map((d, i) => {
                const h = Math.max(d.sales > 0 ? 3 : 0, (d.sales / max) * (H - 8));
                return (
                  <g key={d.date}>
                    <rect x={i * (bar + gap)} y={H - h} width={bar} height={h} rx="3" className={styles.bar}>
                      <title>{`${formatShortDate(d.date)}: ${formatPrice(d.sales)} · ${d.orders}`}</title>
                    </rect>
                    {i % 7 === 1 && i < 27 || i === 29 ? (
                      <text x={i === 29 ? W : i * (bar + gap) + bar / 2} y={H + 16} textAnchor={i === 29 ? "end" : "middle"} className={styles.tick}>{formatShortDate(d.date)}</text>
                    ) : null}
                  </g>
                );
              })}
            </svg>
            <figcaption className="admin-note">{s.salesNote}</figcaption>
          </figure>
        ) : (
          <p className="admin-note">{s.chartEmpty}</p>
        )}
      </section>

      <section className="admin-card" aria-labelledby="top-title">
        <h2 id="top-title" className={styles.cardTitle}>{s.topProducts}</h2>
        {summary.topProducts.length > 0 ? (
          <ol className={styles.top}>
            {summary.topProducts.map((p) => (
              <li key={p.productId}>
                <span className={styles.topName}>{p.name}</span>
                <span className={styles.topBar}><span style={{ width: `${(p.units / topUnits) * 100}%` }} /></span>
                <span className={styles.topValue}>{fill(s.units, { n: p.units })} · {formatPrice(p.revenue)}</span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="admin-note">{s.noData}</p>
        )}
      </section>
    </>
  );
}
