// A printable page for one order: the packing slip (default) or the shipping label (?doc=label).
// Plain HTML sized for paper; the browser's own print dialog does the rest.

import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { brand } from "@/config/brand";
import { t, tr } from "@/i18n";
import { commerce } from "@/config/commerce";
import { getSession } from "@/lib/admin/auth";
import { data } from "@/lib/data";
import { formatDate, formatPrice } from "@/lib/format";
import { PrintButton } from "@/components/admin/PrintButton";
import styles from "./print.module.css";

export const metadata: Metadata = { title: t.admin.print.slip };
export const dynamic = "force-dynamic";
const p = t.admin.print;

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ doc?: string }> };

export default async function PrintPage({ params, searchParams }: Props) {
  if (!(await getSession())) redirect("/admin/login");
  const [{ id }, { doc }] = await Promise.all([params, searchParams]);
  const order = await (await data()).getAdminOrder(decodeURIComponent(id));
  if (!order) notFound();
  const shipping = tr(commerce.shipping.methods.find((m) => m.id === order.shipping.methodId)?.label) || order.shipping.methodId;
  const address = [order.customer.address, order.customer.city, order.customer.postalCode].filter(Boolean);

  if (doc === "label") {
    return (
      <div className={styles.page}>
        <PrintButton label={p.print} />
        <article className={styles.label} data-testid="print-label">
          <p className={styles.kicker}>{p.to}</p>
          <p className={styles.big}>{order.customer.name}</p>
          {address.map((line) => <p key={line} className={styles.addr}>{line}</p>)}
          <p>{order.customer.phone}</p>
          <hr />
          <p className={styles.kicker}>{p.from}</p>
          <p><strong>{brand.name}</strong>{brand.contact.address ? ` · ${brand.contact.address}` : ""}</p>
          <p className={styles.code}>{order.id} · {shipping}{order.tracking ? ` · ${order.tracking}` : ""}</p>
        </article>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <PrintButton label={p.print} />
      <article className={styles.slip} data-testid="print-slip">
        <header>
          <div>
            <p className={styles.big}>{brand.name}</p>
            <p>{brand.contact.email}{brand.contact.phoneDisplay ? ` · ${brand.contact.phoneDisplay}` : ""}</p>
          </div>
          <div className={styles.right}>
            <p className={styles.kicker}>{p.slip}</p>
            <p><strong>{p.order} {order.id}</strong></p>
            <p>{p.date}: {formatDate(order.createdAt)}</p>
          </div>
        </header>
        <section>
          <p className={styles.kicker}>{p.to}</p>
          <p><strong>{order.customer.name}</strong> · {order.customer.phone}</p>
          <p>{shipping}{address.length > 0 ? ` — ${address.join(", ")}` : ""}</p>
          {order.customer.notes ? <p>{p.notes}: {order.customer.notes}</p> : null}
        </section>
        <table>
          <thead><tr><th>{p.qty}</th><th>{p.product}</th><th className={styles.right}>{t.cart.total}</th></tr></thead>
          <tbody>
            {order.lines.map((l, i) => (
              <tr key={i}>
                <td>{l.quantity}</td>
                <td>{l.name}{l.variantLabel ? ` — ${l.variantLabel}` : ""}</td>
                <td className={styles.right}>{formatPrice(l.quantity * l.unitPrice)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr><td colSpan={2}>{t.cart.subtotal}</td><td className={styles.right}>{formatPrice(order.subtotal)}</td></tr>
            <tr><td colSpan={2}>{t.cart.shipping}</td><td className={styles.right}>{formatPrice(order.shipping.price)}</td></tr>
            <tr><td colSpan={2}><strong>{t.cart.total}</strong></td><td className={styles.right}><strong>{formatPrice(order.total)}</strong></td></tr>
          </tfoot>
        </table>
        <p className={styles.signature}>{p.signature}: ______________________</p>
      </article>
    </div>
  );
}
