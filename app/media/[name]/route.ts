// GET /media/<file> — serves the photos saved by the `local` storage adapter (DATA_DIR/uploads).
// Only plain file names are accepted: no folders, no way out of the uploads directory.

import { promises as fs } from "node:fs";
import path from "node:path";
import { uploadsDir } from "@/lib/storage";

const TYPES: Record<string, string> = { webp: "image/webp", jpg: "image/jpeg", png: "image/png" };

export async function GET(_request: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const match = /^[a-z0-9-]+\.(webp|jpg|png)$/.exec(name);
  if (!match) return new Response("Not found", { status: 404 });
  try {
    const bytes = await fs.readFile(/* turbopackIgnore: true */ path.join(/* turbopackIgnore: true */ uploadsDir(), name));
    return new Response(new Uint8Array(bytes), {
      headers: { "Content-Type": TYPES[match[1]!]!, "Cache-Control": "public, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
