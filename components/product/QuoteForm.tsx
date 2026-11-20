"use client";
// "Ask for a quote": the form of a product without a public price. It sends WHAT is wanted (a
// quantity and a description) and who asks — never an amount. The owner prices it in the admin
// panel; the customer gets a link to see the quote, accept it and pay.

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { fill, t } from "@/i18n";
import { readAttribution } from "@/lib/analytics/attribution";
import { browserIds } from "@/lib/analytics/client";
import type { Product } from "@/lib/data/types";
import { quoteRequestSchema } from "@/lib/orders/schema";
import { checkoutSeed, clearCheckoutSeed } from "@/stores/checkout-attempt";
import { AntibotWidget } from "@/components/checkout/AntibotWidget";
import styles from "./QuoteForm.module.css";

const ERRORS = t.checkout.errors as Record<string, string>;

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function QuoteForm({ product, antibot }: { product: Pick<Product, "id" | "minQuantity" | "step" | "unit">; antibot: string }) {
  const router = useRouter();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState("");
  const [sending, setSending] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [resetSignal, setResetSignal] = useState(0);
  const needsToken = antibot !== "none";

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (sending) return;
    const form = new FormData(e.currentTarget);
    const text = (k: string) => String(form.get(k) ?? "").trim();
    const payload = {
      productId: product.id,
      quantity: Number(text("quantity").replace(",", ".")),
      detail: text("detail"),
      customer: { name: text("name"), email: text("email"), phone: text("phone") },
    };
    // The key is checked with the real one below; here only the fields matter.
    const parsed = quoteRequestSchema.safeParse({ ...payload, idempotencyKey: "0".repeat(64) });
    const next: Record<string, string> = {};
    if (!parsed.success) for (const issue of parsed.error.issues) next[String(issue.path.at(-1))] ??= ERRORS[String(issue.path.at(-1))] ?? ERRORS.generic!;
    setErrors(next);
    setFormError("");
    const first = Object.keys(next)[0];
    if (first) {
      document.getElementById(`quote-${first}`)?.focus();
      return;
    }
    if (needsToken && !token) {
      setFormError(t.checkout.antibotWaiting);
      return;
    }
    setSending(true);
    try {
      // One attempt = one key: a double tap or a retry never registers the enquiry twice.
      const idempotencyKey = await sha256(JSON.stringify([checkoutSeed(), "quote", payload]));
      const response = await fetch("/api/quotes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, idempotencyKey, antibotToken: token ?? undefined, attribution: { ...readAttribution(), ...browserIds() } }),
      });
      const body = (await response.json().catch(() => ({}))) as { url?: string; error?: string; field?: string };
      if (!response.ok || !body.url) {
        setFormError(body.error === "invalid" && body.field ? (ERRORS[body.field] ?? ERRORS.generic!) : (ERRORS[body.error ?? "generic"] ?? ERRORS.generic!));
        setResetSignal((n) => n + 1);
        setSending(false);
        return;
      }
      clearCheckoutSeed();
      router.push(body.url);
    } catch {
      setFormError(ERRORS.network!);
      setResetSignal((n) => n + 1);
      setSending(false);
    }
  }

  const field = (name: string, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <div className="field">
      <label htmlFor={`quote-${name}`}>{label}</label>
      <input id={`quote-${name}`} name={name} className="input" aria-invalid={errors[name] ? "true" : undefined} aria-describedby={errors[name] ? `quote-error-${name}` : undefined} data-testid={`quote-${name}`} {...props} />
      {errors[name] ? <p id={`quote-error-${name}`} className="field-error">{errors[name]}</p> : null}
    </div>
  );

  return (
    <form onSubmit={submit} noValidate className={`card ${styles.form}`} data-testid="quote-form">
      <h2>{t.types.quoteTitle}</h2>
      <div className={styles.two}>
        {field("quantity", product.unit === "u" ? t.types.quoteQuantity : fill(t.types.quantityIn, { unit: product.unit }), {
          type: "number", inputMode: "decimal", min: product.minQuantity, step: product.step, defaultValue: product.minQuantity, required: true,
        })}
        {field("name", t.checkout.name, { autoComplete: "name", required: true })}
      </div>
      <div className="field">
        <label htmlFor="quote-detail">{t.types.quoteDetailLabel}</label>
        <textarea id="quote-detail" name="detail" className="input" rows={4} maxLength={2000} aria-invalid={errors.detail ? "true" : undefined} aria-describedby="quote-detail-hint" data-testid="quote-detail" />
        <p id="quote-detail-hint" className={errors.detail ? "field-error" : "muted"}>{errors.detail ?? t.types.quoteDetailHint}</p>
      </div>
      <div className={styles.two}>
        {field("email", t.checkout.email, { type: "email", autoComplete: "email", inputMode: "email", required: true })}
        {field("phone", t.checkout.phone, { type: "tel", autoComplete: "tel", inputMode: "tel", required: true })}
      </div>
      <AntibotWidget provider={antibot} onToken={setToken} resetSignal={resetSignal} />
      <div aria-live="assertive">{formError ? <p className="notice" role="alert" data-testid="quote-error">{formError}</p> : null}</div>
      <button type="submit" className="btn btn-lg btn-block" aria-disabled={sending ? "true" : undefined} data-testid="quote-submit">
        {sending ? t.types.quoteSending : t.types.quoteSubmit}
      </button>
      <p className="muted">{t.types.quoteNoCharge}</p>
    </form>
  );
}
