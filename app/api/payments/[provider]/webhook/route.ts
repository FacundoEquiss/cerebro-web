// POST /api/payments/<provider>/webhook — where a payment gateway tells the store that money
// moved. Order of operations, always: verify the signature → ask the gateway's API what really
// happened → compare the amount with the official total → credit ONCE.

import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { paymentAdapters } from "@/lib/payments";
import { creditPayment } from "@/lib/payments/credit";

export async function POST(request: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const adapter = paymentAdapters[provider];
  // Only the ACTIVE provider has a webhook: the others do not exist.
  if (!adapter || provider !== env().PAYMENT_PROVIDER || provider === "manual") {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const rawBody = await request.text();
  try {
    const result = await adapter.parseWebhook({ rawBody, headers: request.headers, url: new URL(request.url) });
    if (result.type === "invalid") {
      console.warn(`[webhook:${provider}] rejected: ${result.reason}`);
      return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
    }
    if (result.type === "ignored") return NextResponse.json({ ok: true });
    const outcome = await creditPayment(result.payment, result.metadata, result.email);
    return NextResponse.json({ ok: true, outcome });
  } catch (e) {
    // 500 makes the gateway retry later; crediting is idempotent, so a retry is safe.
    console.error(`[webhook:${provider}]`, e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "temporary" }, { status: 500 });
  }
}
