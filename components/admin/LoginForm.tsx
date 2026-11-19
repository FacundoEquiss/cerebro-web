"use client";
import { useState, type FormEvent } from "react";
import Link from "next/link";
import { fill, paths, t } from "@/i18n";
import { adminFetch } from "./api";
import styles from "./LoginForm.module.css";

const l = t.admin.login;

export function LoginForm({ brandName, demo, hasUsers }: { brandName: string; demo: { email: string; password: string } | null; hasUsers: boolean }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (sending) return;
    setSending(true);
    setError("");
    const result = await adminFetch<{ retryAfterSeconds?: number }>("/api/admin/login", { json: { email, password } });
    if (result.ok) {
      window.location.assign("/admin");
      return;
    }
    setSending(false);
    setError(
      result.status === 429 ? fill(l.errorRateLimited, { minutes: Math.max(1, Math.ceil((result.data.retryAfterSeconds ?? 60) / 60)) })
        : result.status === 401 ? l.errorCredentials
        : l.errorGeneric,
    );
  }

  return (
    <div className={styles.page}>
      <form className={styles.card} onSubmit={submit} data-testid="login-form">
        <p className={styles.brand}>{brandName}</p>
        <h1>{l.title}</h1>
        <div className="field">
          <label htmlFor="login-email">{l.email}</label>
          <input id="login-email" className="input" type="email" autoComplete="username" inputMode="email" required value={email} onChange={(e) => setEmail(e.target.value)} data-testid="login-email" />
        </div>
        <div className="field">
          <label htmlFor="login-password">{l.password}</label>
          <input id="login-password" className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} data-testid="login-password" />
        </div>
        <div aria-live="assertive">{error ? <p className="field-error" role="alert" data-testid="login-error">{error}</p> : null}</div>
        <button type="submit" className="btn btn-block" aria-disabled={sending || undefined} data-testid="login-submit">{sending ? l.sending : l.submit}</button>

        {demo ? (
          <div className={styles.demo} data-testid="demo-credentials">
            <p className={styles.demoTitle}>{l.demoTitle}</p>
            <p>{l.demoText}</p>
            <dl>
              <div><dt>{l.email}</dt><dd><code>{demo.email}</code></dd></div>
              <div><dt>{l.password}</dt><dd><code>{demo.password}</code></dd></div>
            </dl>
            <button type="button" className="btn btn-secondary btn-block" onClick={() => { setEmail(demo.email); setPassword(demo.password); }} data-testid="demo-fill">{l.demoUse}</button>
          </div>
        ) : !hasUsers ? (
          <p className={styles.hint}>{l.noUsers}</p>
        ) : null}
        <Link href={paths.home()} className={styles.back}>{l.back}</Link>
      </form>
    </div>
  );
}
