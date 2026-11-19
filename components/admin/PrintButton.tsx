"use client";
import { Printer } from "lucide-react";

export function PrintButton({ label }: { label: string }) {
  return (
    <button type="button" className="btn no-print" onClick={() => window.print()}>
      <Printer aria-hidden size={18} /> {label}
    </button>
  );
}
