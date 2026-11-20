#!/usr/bin/env node
// STARTING CATALOGUES. A preset is an example store for one line of business: products,
// categories, the texts of the home page and a suggested palette. Applying one replaces the demo
// content, so the store starts looking like the business it will become.
//
//   npm run preset              lists the presets
//   npm run preset <name>       applies one
//   npm run preset <name> -- --keep-theme    …without touching the colours of config/brand.ts
//
// What it writes: content/products.json (the catalogue), content/site.json (home texts),
// the eight colours of `theme` in config/brand.ts, and db/seed.sql (the same catalogue as SQL).
// EVERYTHING in a preset is an EXAMPLE: names, prices and texts are placeholders to replace.
// Nothing is deleted from a database: a database keeps its own products (load the new seed if
// you want these).
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(root, "content/presets");
const read = (name) => JSON.parse(readFileSync(join(dir, `${name}.json`), "utf8"));
const names = readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, "")).sort();
const locale = readFileSync(join(root, "config/brand.ts"), "utf8").match(/locale:\s*"(\w+)"/)?.[1] ?? "es";
const tr = (v) => (typeof v === "string" ? v : (v?.[locale] ?? v?.es ?? v?.en ?? ""));

const args = process.argv.slice(2);
const name = args.find((a) => !a.startsWith("--"));
const keepTheme = args.includes("--keep-theme");

if (!name) {
  console.log("Presets (npm run preset <name>):\n");
  for (const n of names) {
    const p = read(n);
    const types = [...new Set(p.products.map((x) => x.type ?? "physical"))].join(", ");
    console.log(`  ${n.padEnd(12)} ${tr(p.name)} — ${p.products.length} products (${types})\n  ${" ".repeat(12)} ${tr(p.description)}\n`);
  }
  process.exit(0);
}
if (!names.includes(name)) {
  console.error(`✗ There is no preset "${name}". Available: ${names.join(", ")}`);
  process.exit(1);
}

const preset = read(name);
const json = (file, value) => writeFileSync(join(root, file), `${JSON.stringify(value, null, 2)}\n`);

json("content/products.json", {
  _note: `EXAMPLE CATALOGUE (the \`${name}\` preset). Every product, price and text here is an EXAMPLE: replace them with the real ones. Texts can be a plain string or { "es": "…", "en": "…" }. stock: number = units (or kilos, metres…), null = made to order. type: physical | digital | service | quote (docs/product-types.md). Images with a "placeholder" key are drawn by \`npm run images\`; remove that key when you add a real photo.`,
  categories: preset.categories,
  products: preset.products,
});
json("content/site.json", {
  _note: "Which preset the store started from, and the texts of the home page (hero, benefits, frequently asked questions). EXAMPLE texts: replace them with the real ones. Written by `npm run preset <name>`; edit it freely afterwards. `home: null` falls back to the texts of i18n/.",
  preset: name,
  home: preset.home,
});

// The palette: the eight values of `theme` in config/brand.ts, the single source of the colours.
let themed = 0;
if (!keepTheme && preset.palette) {
  const file = join(root, "config/brand.ts");
  let source = readFileSync(file, "utf8");
  const start = source.indexOf("theme: {");
  const end = source.indexOf("}", start);
  let block = source.slice(start, end);
  for (const [key, value] of Object.entries(preset.palette)) {
    if (!/^#[0-9a-f]{6}$/i.test(value)) continue;
    const next = block.replace(new RegExp(`(\\b${key}:\\s*")#[0-9a-fA-F]{3,8}(")`), `$1${value}$2`);
    if (next !== block) themed++;
    block = next;
  }
  source = source.slice(0, start) + block + source.slice(end);
  writeFileSync(file, source);
}

// The same catalogue as SQL, for the database adapters.
spawnSync(process.execPath, [join(root, "scripts/generate-seed.mjs")], { stdio: "inherit" });

// Local development keeps the catalogue edited from the admin panel in DATA_DIR: it would hide
// the new one. It is set aside, not deleted.
const saved = join(root, process.env.DATA_DIR || ".data", "catalog.json");
let setAside = false;
if (existsSync(saved)) {
  renameSync(saved, saved.replace(/\.json$/, `.before-${name}.json`));
  setAside = true;
}

const types = [...new Set(preset.products.map((p) => p.type ?? "physical"))];
console.log(`✓ Preset "${name}" applied — ${tr(preset.name)}`);
console.log(`  · content/products.json   ${preset.products.length} products in ${preset.categories.length} categories (types: ${types.join(", ")})`);
console.log("  · content/site.json       home texts (hero, benefits, questions)");
console.log(keepTheme ? "  · config/brand.ts         colours left as they were (--keep-theme)" : `  · config/brand.ts         ${themed} colours of the suggested palette`);
console.log("  · db/seed.sql             the same catalogue as SQL");
if (setAside) console.log(`  · ${saved} was set aside (…before-${name}.json): the admin panel's local edits would hide the new catalogue`);
console.log("\nNext: restart `npm run dev` (or build again) and replace every EXAMPLE with the real data of the business.");
