import type { Metadata } from "next";
import type { ReactNode } from "react";
import { t } from "@/i18n";
import "./admin.css";

// The whole panel is private: never indexed, never followed (the proxy also sends X-Robots-Tag).
export const metadata: Metadata = {
  title: { default: t.admin.title, template: `%s · ${t.admin.title}` },
  robots: { index: false, follow: false, nocache: true },
};

export default function AdminRootLayout({ children }: { children: ReactNode }) {
  return <div className="admin">{children}</div>;
}
