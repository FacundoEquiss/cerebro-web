// POST /api/admin/upload — one product photo, already shrunk to WebP by the browser.
// The server still checks everything: session, size, and the REAL type of the bytes.

import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { requireWriter } from "@/lib/admin/auth";
import { MAX_UPLOAD_BYTES, sniffImage, storage, uploadName } from "@/lib/storage";

export async function POST(request: Request) {
  const guard = await requireWriter(request);
  if (guard.response) return guard.response;
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof Blob)) return NextResponse.json({ error: "invalid" }, { status: 400 });
  if (file.size === 0 || file.size > MAX_UPLOAD_BYTES) return NextResponse.json({ error: "too_large" }, { status: 413 });

  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = sniffImage(bytes);
  const name = type ? uploadName(String(form?.get("name") ?? ""), type, randomBytes(6).toString("hex")) : null;
  if (!type || !name) return NextResponse.json({ error: "type" }, { status: 415 });
  try {
    return NextResponse.json({ src: await storage().put(name, bytes, type) });
  } catch (e) {
    console.error("[admin-upload]", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "generic" }, { status: 500 });
  }
}
