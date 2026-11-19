"use client";
// The cart lives in the browser (localStorage), so it survives a reload and needs no account.
// It stores WHAT was chosen, never what it costs: prices are read from the catalogue when the
// cart is shown, and the server sets the official ones when the order is created.

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { lineKey } from "@/lib/cart-key";

export interface CartLine {
  key: string;
  productId: string;
  variantId: string | null;
  selection: Record<string, string>;
  quantity: number;
}

interface CartState {
  lines: CartLine[];
  /** True once the saved cart was read from the device (avoids a flash of "empty cart"). */
  hydrated: boolean;
  add(line: Omit<CartLine, "key">, optionOrder: string[], max: number): void;
  setQuantity(key: string, quantity: number): void;
  remove(key: string): void;
  clear(): void;
}

export const useCart = create<CartState>()(
  persist(
    (set) => ({
      lines: [],
      hydrated: false,
      add(line, optionOrder, max) {
        const key = lineKey(line.productId, line.variantId, line.selection, optionOrder);
        set((s) => {
          const existing = s.lines.find((l) => l.key === key);
          if (existing) {
            return { lines: s.lines.map((l) => (l.key === key ? { ...l, quantity: Math.min(max, l.quantity + line.quantity) } : l)) };
          }
          return { lines: [...s.lines, { ...line, key, quantity: Math.min(max, line.quantity) }] };
        });
      },
      setQuantity(key, quantity) {
        set((s) => ({ lines: s.lines.map((l) => (l.key === key ? { ...l, quantity: Math.max(1, Math.trunc(quantity)) } : l)) }));
      },
      remove(key) {
        set((s) => ({ lines: s.lines.filter((l) => l.key !== key) }));
      },
      clear() {
        set({ lines: [] });
      },
    }),
    {
      name: "cart.v1",
      partialize: (s) => ({ lines: s.lines }),
      // Read the saved cart AFTER the first render (see `hydrateCart`): the server HTML and the
      // first client render must be identical.
      skipHydration: true,
    },
  ),
);

export const cartCount = (lines: CartLine[]) => lines.reduce((n, l) => n + l.quantity, 0);

/** Call once in the browser, after mount. */
export async function hydrateCart(): Promise<void> {
  if (useCart.getState().hydrated) return;
  await useCart.persist.rehydrate();
  useCart.setState({ hydrated: true });
}
