import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { brand } from "@/config/brand";
import { t } from "@/i18n";
import { canWrite, getSession } from "@/lib/admin/auth";
import { AdminNav, AdminTopActions } from "@/components/admin/AdminNav";

export const dynamic = "force-dynamic";

export default async function PanelLayout({ children }: { children: ReactNode }) {
  // The proxy already checked the cookie. This checks it again: the layout never trusts the proxy.
  const session = await getSession();
  if (!session) redirect("/admin/login");
  const writable = await canWrite(session);
  return (
    <div className="admin-shell">
      <header className="admin-top">
        <a href="/admin" className="admin-brand">{brand.name} <small>{t.admin.title}</small></a>
        <span className="admin-user" data-testid="admin-user">{session.email}</span>
        <AdminTopActions />
      </header>
      <AdminNav />
      <main className="admin-main" id="content">
        {!writable ? (
          <p className="admin-banner" role="note" data-testid="read-only-banner">
            {session.role === "demo" ? t.admin.readOnlyDemoUser : t.admin.readOnly}
          </p>
        ) : null}
        {children}
      </main>
    </div>
  );
}
