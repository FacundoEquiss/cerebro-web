"use client";
// The optional "are you human" challenge (Turnstile). THE RULE: its token is SINGLE-USE. After
// every submit — successful or not — the old token is dead, so the widget is reset and the form
// must wait for a fresh one before it can be sent again. `onToken(null)` means "not ready".

import { useEffect, useRef } from "react";
import Script from "next/script";
import { publicEnv } from "@/lib/public-env";

interface Turnstile {
  render(el: HTMLElement, options: Record<string, unknown>): string;
  reset(id?: string): void;
  remove(id?: string): void;
}
declare global {
  interface Window {
    turnstile?: Turnstile;
  }
}

export function AntibotWidget({ provider, onToken, resetSignal }: { provider: string; onToken: (token: string | null) => void; resetSignal: number }) {
  const box = useRef<HTMLDivElement>(null);
  const widget = useRef<string | null>(null);
  const active = provider === "turnstile" && Boolean(publicEnv.turnstileSiteKey);

  function mount() {
    if (!active || !box.current || !window.turnstile || widget.current) return;
    widget.current = window.turnstile.render(box.current, {
      sitekey: publicEnv.turnstileSiteKey,
      callback: (token: string) => onToken(token),
      "expired-callback": () => onToken(null),
      "error-callback": () => onToken(null),
    });
  }

  useEffect(() => {
    mount();
    return () => {
      if (widget.current) window.turnstile?.remove(widget.current);
      widget.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A submit happened: the token was spent. Ask for a new one.
  useEffect(() => {
    if (!active || resetSignal === 0) return;
    onToken(null);
    if (widget.current) window.turnstile?.reset(widget.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetSignal]);

  if (!active) return null;
  return (
    <>
      <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" strategy="afterInteractive" onReady={mount} />
      <div ref={box} data-testid="antibot" />
    </>
  );
}
