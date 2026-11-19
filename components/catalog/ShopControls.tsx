"use client";
// Two tiny enhancements over the plain GET form of the shop. Without JavaScript the form still
// works: <details> opens the filters and a submit button applies everything.

import { useEffect, useRef, type ReactNode } from "react";

/** The filters <details>: closes on Escape and on a click outside. */
export function FiltersDisclosure({ className, children }: { className?: string; children: ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && el.open) {
        el.open = false;
        el.querySelector("summary")?.focus();
      }
    };
    const onClick = (e: MouseEvent) => {
      if (el.open && e.target instanceof Node && !el.contains(e.target)) el.open = false;
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("click", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("click", onClick);
    };
  }, []);
  return <details ref={ref} className={className}>{children}</details>;
}

/** A <select> that submits its form when it changes. */
export function SortSelect({ name, defaultValue, className, options }: { name: string; defaultValue: string; className?: string; options: { key: string; label: string }[] }) {
  return (
    <select name={name} defaultValue={defaultValue} className={className} onChange={(e) => e.currentTarget.form?.requestSubmit()} data-testid="sort-select">
      {options.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
    </select>
  );
}
