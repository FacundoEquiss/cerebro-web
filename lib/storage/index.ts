// STORAGE ADAPTERS: where the product photos uploaded from the admin panel are kept.
// Chosen by STORAGE_PROVIDER.
//
//   local     (default) files under DATA_DIR/uploads, served by /media/…  — for local development
//             and for a single server with a persistent disk (a VPS, a Docker volume).
//   supabase  a PUBLIC bucket of Supabase Storage (SUPABASE_STORAGE_BUCKET, "products" by default).
//
// THE PRIVATE SIDE (`putPrivate` / `getPrivate`) keeps the files of the DIGITAL products. Nothing
// there has a public address: a file leaves only through /api/downloads/…, for a paid order.
//   local     DATA_DIR/private (never served). Example files of the presets: content/downloads.
//   supabase  a PRIVATE bucket (SUPABASE_PRIVATE_BUCKET, "downloads" by default), read with the
//             service key on the server.
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
  /** Saves a PRIVATE file and returns its key (what `DigitalFile.file` stores). Never a URL. */
  putPrivate(name: string, bytes: Uint8Array, contentType: string): Promise<string>;
  /** The bytes of a private file, or `null` if it does not exist. */
  getPrivate(key: string): Promise<Uint8Array | null>;
}

export const MAX_DIGITAL_BYTES = 50 * 1024 * 1024;
/** What a digital product may be, by extension → the type it is served with. */
export const DIGITAL_TYPES: Record<string, string> = {
  pdf: "application/pdf", zip: "application/zip", epub: "application/epub+zip", mp3: "audio/mpeg", mp4: "video/mp4",
  png: "image/png", jpg: "image/jpeg", webp: "image/webp", csv: "text/csv", txt: "text/plain; charset=utf-8",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

/** A key is a plain file name: no folders, no dots at the start — it can never climb out of its folder. */
export const safeKey = (key: string) => /^[a-z0-9][a-z0-9._-]{0,200}$/i.test(key) && !key.includes("..");
export const extensionOf = (name: string) => (/\.([a-z0-9]{1,5})$/i.exec(name)?.[1] ?? "").toLowerCase();

/** A safe, unique key for an uploaded digital file, or `null` if its type is not accepted. */
export function privateName(original: string, random: string): string | null {
  const ext = extensionOf(original);
  if (!DIGITAL_TYPES[ext]) return null;
  const slug = original.slice(0, -(ext.length + 1)).normalize("NFD").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase().slice(0, 60) || "file";
  return `${slug}-${random}.${ext}`;
}

const privateDir = () => path.join(/* turbopackIgnore: true */ path.resolve(/* turbopackIgnore: true */ process.env.DATA_DIR || ".data"), "private");
/** The example files of the presets (generated, harmless). Not under public/: they are only served to paid orders. */
const samplesDir = () => path.join(/* turbopackIgnore: true */ process.cwd(), "content", "downloads");

async function readIfThere(file: string): Promise<Uint8Array | null> {
  try {
    return new Uint8Array(await fs.readFile(/* turbopackIgnore: true */ file));
  } catch {
    return null;
  }
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
  async putPrivate(name, bytes) {
    if (!safeKey(name)) throw new Error("invalid file name");
    await fs.mkdir(/* turbopackIgnore: true */ privateDir(), { recursive: true });
    await fs.writeFile(/* turbopackIgnore: true */ path.join(/* turbopackIgnore: true */ privateDir(), name), bytes);
    return name;
  },
  async getPrivate(key) {
    if (!safeKey(key)) return null;
    return (
      (await readIfThere(path.join(/* turbopackIgnore: true */ privateDir(), key))) ??
      (await readIfThere(path.join(/* turbopackIgnore: true */ samplesDir(), key)))
    );
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
  async putPrivate(name, bytes, contentType) {
    if (!safeKey(name)) throw new Error("invalid file name");
    const e = env();
    const key = e.SUPABASE_SERVICE_ROLE_KEY!;
    const res = await fetch(`${e.SUPABASE_URL}/storage/v1/object/${e.SUPABASE_PRIVATE_BUCKET}/${name}`, {
      method: "POST",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": contentType },
      body: Buffer.from(bytes),
    });
    if (!res.ok) throw new Error(`private storage upload failed (${res.status})`);
    return name;
  },
  async getPrivate(key) {
    if (!safeKey(key)) return null;
    const e = env();
    const service = e.SUPABASE_SERVICE_ROLE_KEY!;
    // The bucket is PRIVATE: only this request, made by the server with the service key, can read it.
    const res = await fetch(`${e.SUPABASE_URL}/storage/v1/object/${e.SUPABASE_PRIVATE_BUCKET}/${key}`, {
      headers: { apikey: service, Authorization: `Bearer ${service}` },
      cache: "no-store",
    });
    if (res.ok) return new Uint8Array(await res.arrayBuffer());
    // The example files of a preset are not in the bucket: they ship with the code.
    return readIfThere(path.join(/* turbopackIgnore: true */ samplesDir(), key));
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
