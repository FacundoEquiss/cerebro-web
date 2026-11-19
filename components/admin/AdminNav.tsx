"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, ClipboardList, LogOut, Package, Settings, Store, Users } from "lucide-react";
import { paths, t } from "@/i18n";
import { adminFetch } from "./api";

const ITEMS = [
  { href: "/admin", label: t.admin.nav.orders, Icon: ClipboardList, exact: true },
  { href: "/admin/summary", label: t.admin.nav.summary, Icon: BarChart3 },
  { href: "/admin/products", label: t.admin.nav.products, Icon: Package },
  { href: "/admin/customers", label: t.admin.nav.customers, Icon: Users },
  { href: "/admin/settings", label: t.admin.nav.settings, Icon: Settings },
];

export function AdminNav() {
  const pathname = usePathname();
  return (
    <nav className="admin-nav" aria-label={t.admin.nav.main}>
      {ITEMS.map(({ href, label, Icon, exact }) => {
        const active = exact ? pathname === href : pathname.startsWith(href);
        return (
          <Link key={href} href={href} aria-current={active ? "page" : undefined} data-testid={`admin-nav-${href.split("/")[2] ?? "orders"}`}>
            <Icon aria-hidden /> <span>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

export function AdminTopActions() {
  async function logout() {
    await adminFetch("/api/admin/logout", { json: {} });
    window.location.assign("/admin/login");
  }
  return (
    <>
      <Link href={paths.home()} className="admin-link" target="_blank"><Store aria-hidden size={17} /> <span>{t.admin.nav.store}</span></Link>
      <button type="button" onClick={logout} data-testid="admin-logout"><LogOut aria-hidden size={17} /> <span>{t.admin.nav.logout}</span></button>
    </>
  );
}
