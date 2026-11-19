"use client";
import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { t } from "@/i18n";
import type { CustomerRow } from "@/lib/admin/reports";
import { fold, formatPrice } from "@/lib/format";
import { formatDateTime } from "./format";
import styles from "./tables.module.css";

const c = t.admin.customers;

export function CustomersTable({ customers }: { customers: CustomerRow[] }) {
  const [query, setQuery] = useState("");
  const list = useMemo(() => {
    const q = fold(query);
    return q ? customers.filter((row) => fold(`${row.name} ${row.email} ${row.phone}`).includes(q)) : customers;
  }, [customers, query]);

  return (
    <>
      <div className="admin-head">
        <h1>{c.title}</h1>
        <label className={styles.search}>
          <Search aria-hidden size={16} />
          <span className="sr-only">{c.search}</span>
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={c.search} />
        </label>
      </div>
      <p className="admin-note">{c.note}</p>
      <div className="admin-card">
        {list.length > 0 ? (
          <table className="admin-table" data-testid="customers-table">
            <thead>
              <tr><th>{c.name}</th><th>{c.contact}</th><th className="num">{c.orders}</th><th className="num">{c.spent}</th><th>{c.last}</th></tr>
            </thead>
            <tbody>
              {list.map((row) => (
                <tr key={row.key}>
                  <td><strong>{row.name}</strong></td>
                  <td>
                    <a href={`mailto:${row.email}`} className={styles.link}>{row.email}</a>
                    <br />
                    <span className="admin-note">{row.phone}</span>
                  </td>
                  <td className="num" data-label={c.orders}>{row.orders}</td>
                  <td className="num" data-label={c.spent}>{formatPrice(row.spent)}</td>
                  <td data-label={c.last}>{formatDateTime(row.lastOrderAt)} <span className="admin-note">· {row.lastOrderId}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="admin-note">{c.empty}</p>
        )}
      </div>
    </>
  );
}
