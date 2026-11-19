// STORAGE ADAPTERS: where the product photos uploaded from the admin panel are kept.
// Chosen by STORAGE_PROVIDER.
//
//   local     (default) files under DATA_DIR/uploads, served by /media/…  — for local development
//             and for a single server with a persistent disk (a VPS, a Docker volume).
//   supabase  a PUBLIC bucket of Supabase Storage (SUPABASE_STORAGE_BUCKET, "products" by default).
//
// S3-compatible storage is on the roadmap. To add one implement `StorageAdapter` and register it.
// The browser already shrank the photo to WebP (1600 px at most) before it gets here.

import { promises as fs } from "node:fs";
import path from "node:path";
import { env } from "@/lib/env";

export interface StorageAdapter {
  readonly id: string;
  /** Saves the file and returns the public URL (or path) to use as `src`. */
  put(name: string, bytes: Uint8Array, contentType: string): Promise<string>;
}

export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
export const UPLOAD_TYPES: Record<string, string> = { "image/webp": "webp", "image/jpeg": "jpg", "image/png": "png" };

export const uploadsDir = () => path.join(/* turbopackIgnore: true */ path.resolve(/* turbopackIgnore: true */ process.env.DATA_DIR || ".data"), "uploads");

const local: StorageAdapter = {
  id: "local",
  async put(name, bytes) {
    await fs.mkdir(/* turbopackIgnore: true */ uploadsDir(), { recursive: true });
    await fs.writeFile(/* turbopackIgnore: true */ path.join(/* turbopackIgnore: true */ uploadsDir(), name), bytes);
    return `/media/${name}`;
  },
};

const supabase: StorageAdapter = {
  id: "supabase",
  async put(name, bytes, contentType) {
    const e = env();
    const key = e.SUPABASE_SERVICE_ROLE_KEY!;
    const res = await fetch(`${e.SUPABASE_URL}/storage/v1/object/${e.SUPABASE_STORAGE_BUCKET}/${name}`, {
      method: "POST",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": contentType, "Cache-Control": "public, max-age=31536000, immutable" },
      body: Buffer.from(bytes),
    });
    if (!res.ok) throw new Error(`storage upload failed (${res.status})`);
    return `${e.SUPABASE_URL}/storage/v1/object/public/${e.SUPABASE_STORAGE_BUCKET}/${name}`;
  },
};

export const storageAdapters: Record<string, StorageAdapter> = { local, supabase };

export function storage(): StorageAdapter {
  return storageAdapters[env().STORAGE_PROVIDER] ?? local;
}

/** A safe, unique file name: `<slug>-<random>.<ext>`. Never trusts the name the browser sent. */
export function uploadName(hint: string, contentType: string, random: string): string | null {
  const ext = UPLOAD_TYPES[contentType];
  if (!ext) return null;
  const slug = hint.normalize("NFD").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase().slice(0, 40) || "photo";
  return `${slug}-${random}.${ext}`;
}

/** The real type of the bytes (magic numbers). The `Content-Type` a client sends proves nothing. */
export function sniffImage(bytes: Uint8Array): string | null {
  const b = bytes;
  if (b.length > 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  return null;
}
