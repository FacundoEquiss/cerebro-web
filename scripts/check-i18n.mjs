#!/usr/bin/env node
// Checks that every dictionary in i18n/ has exactly the same keys (and the same {placeholders})
// as the reference one, es.ts. TypeScript already fails the build on a missing key; this also
// catches a placeholder that was translated or dropped, and runs without compiling anything.
// Needs Node 22.18+ (it imports the .ts files directly).
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const load = async (name) => (await import(pathToFileURL(join(root, "i18n", `${name}.ts`)).href))[name];

let es, en;
try {
  [es, en] = await Promise.all([load("es"), load("en")]);
} catch (e) {
  if (e?.code === "ERR_UNKNOWN_FILE_EXTENSION") {
    console.log("• check-i18n skipped: this Node version cannot import .ts files (use Node 22.18 or newer).");
    process.exit(0);
  }
  throw e;
}

const placeholders = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
const errors = [];

function compare(a, b, path) {
  if (typeof a === "string") {
    if (typeof b !== "string") errors.push(`${path}: is text in es, not in en`);
    else if (placeholders(a) !== placeholders(b)) errors.push(`${path}: placeholders differ ({${placeholders(a)}} vs {${placeholders(b)}})`);
    return;
  }
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) errors.push(`${path}: lists of different length`);
    else a.forEach((item, i) => compare(item, b[i], `${path}[${i}]`));
    return;
  }
  for (const key of Object.keys(a)) {
    if (!(key in (b ?? {}))) errors.push(`${path}.${key}: missing in en`);
    else compare(a[key], b[key], `${path}.${key}`);
  }
  for (const key of Object.keys(b ?? {})) if (!(key in a)) errors.push(`${path}.${key}: only in en`);
}

compare(es, en, "t");
if (errors.length > 0) {
  console.error(`✗ i18n: ${errors.length} difference(s) between es and en`);
  for (const e of errors.slice(0, 50)) console.error(`   - ${e}`);
  process.exit(1);
}
console.log("✓ i18n: es and en have the same keys and placeholders");
