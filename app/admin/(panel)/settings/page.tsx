import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { t } from "@/i18n";
import { getSession } from "@/lib/admin/auth";
import { settingsReport } from "@/lib/admin/settings";
import styles from "./settings.module.css";

export const metadata: Metadata = { title: t.admin.settings.title };
const s = t.admin.settings;

export default async function SettingsPage() {
  if (!(await getSession())) redirect("/admin/login");
  // Names and states only. No secret value ever reaches this page.
  const report = await settingsReport();
  return (
    <>
      <div className="admin-head"><h1>{s.title}</h1></div>
      <p className="admin-note">{s.note}</p>
      <section className="admin-card" aria-labelledby="settings-missing">
        <h2 id="settings-missing" className={styles.title}>{s.missingTitle}</h2>
        {report.missing.length > 0 ? (
          <ul className={styles.missing} data-testid="settings-missing">
            {report.missing.map((m) => <li key={m.key}><code>{m.key}</code> <span>{m.why}</span></li>)}
          </ul>
        ) : (
          <p>{s.allSet}</p>
        )}
        <p className="admin-note">{s.docs}</p>
      </section>
      <div className={styles.grid}>
        {report.groups.map((group) => (
          <section key={group.title} className="admin-card" aria-label={group.title}>
            <h2 className={styles.title}>{group.title}</h2>
            <dl className={styles.list}>
              {group.rows.map((row) => (
                <div key={row.label}>
                  <dt>{row.label}</dt>
                  <dd data-state={row.state}>{row.value}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </>
  );
}
