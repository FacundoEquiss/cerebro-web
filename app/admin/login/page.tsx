import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { brand } from "@/config/brand";
import { t } from "@/i18n";
import { getSession } from "@/lib/admin/auth";
import { DEMO_USER } from "@/lib/admin/login";
import { env } from "@/lib/env";
import { LoginForm } from "@/components/admin/LoginForm";

export const metadata: Metadata = { title: t.admin.login.title };
export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (await getSession()) redirect("/admin");
  const e = env();
  return (
    <LoginForm
      brandName={brand.name}
      // Shown on purpose: the demo user can look at everything and change nothing.
      demo={e.demoMode ? DEMO_USER : null}
      hasUsers={e.adminUsers.length > 0}
    />
  );
}
