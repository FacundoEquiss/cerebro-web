// POST /api/admin/upload-file — the file of a DIGITAL product. It goes to the private side of the
// storage adapter and the answer is its key, never a URL: nothing here is publicly reachable.

import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { requireWriter } from "@/lib/admin/auth";
import { DIGITAL_TYPES, extensionOf, MAX_DIGITAL_BYTES, privateName, storage } from "@/lib/storage";

export async function POST(request: Request) {
  const guard = await requireWriter(request);
  if (guard.response) return guard.response;
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof Blob)) return NextResponse.json({ error: "invalid" }, { status: 400 });
  if (file.size === 0 || file.size > MAX_DIGITAL_BYTES) return NextResponse.json({ error: "too_large" }, { status: 413 });
  const original = String(form?.get("name") ?? (file as File).name ?? "");
  const key = privateName(original, randomBytes(8).toString("hex"));
  if (!key) return NextResponse.json({ error: "type" }, { status: 415 });
  try {
    await storage().putPrivate(key, new Uint8Array(await file.arrayBuffer()), DIGITAL_TYPES[extensionOf(key)]!);
    return NextResponse.json({ file: key, name: original.replace(/[^\w. -]+/g, "_").slice(0, 200) });
  } catch (e) {
    console.error("[admin-upload-file]", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "generic" }, { status: 500 });
  }
}
