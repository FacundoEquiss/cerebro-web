#!/usr/bin/env node
// STARTING CATALOGUES. A preset is an example store for one line of business: products,
// categories, the texts of the home page and a suggested palette. Applying one replaces the demo
// content, so the store starts looking like the business it will become.
//
//   npm run preset              lists the presets
//   npm run preset <name>       applies one
//   npm run preset <name> -- --keep-theme    …without touching the colours of config/brand.ts
//   npm run preset <name> -- --force         …even over a catalogue that is already yours
//
// IT REPLACES FILES. So it refuses to run — unless you pass --force — when the catalogue, the home
// texts or the colours are no longer the ones of a preset (someone already made them theirs), or
// when those files have changes git has not committed. And before writing it always keeps a copy
// of what was there in .preset-backups/<date-time>/ (never overwritten, never committed).
//
// What it writes: content/products.json (the catalogue), content/site.json (home texts),
// the eight colours of `theme` in config/brand.ts, and db/seed.sql (the same catalogue as SQL).
// EVERYTHING in a preset is an EXAMPLE: names, prices and texts are placeholders to replace.
// Nothing is deleted from a database: a database keeps its own products (load the new seed if
// you want these).
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
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
const force = args.includes("--force");
const FILES = ["content/products.json", "content/site.json", "config/brand.ts", "db/seed.sql"];
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const safeRead = (file) => {
  try {
    return readFileSync(join(root, file), "utf8");
  } catch {
    return null;
  }
};
const safeJson = (file) => {
  try {
    return JSON.parse(safeRead(file) ?? "null");
  } catch {
    return undefined; // unreadable = not a preset's
  }
};

/** Why applying a preset would destroy work, one line per reason. Empty = it is safe. */
function reasonsToStop() {
  const reasons = [];
  const presets = names.map(read);
  const catalogue = safeJson("content/products.json");
  if (catalogue !== null && !presets.some((p) => same(p.products, catalogue?.products) && same(p.categories, catalogue?.categories))) {
    reasons.push("content/products.json is not the catalogue of any preset: it looks like it is already yours");
  }
  const site = safeJson("content/site.json");
  if (site !== null && !presets.some((p) => same(p.home, site?.home))) {
    reasons.push("content/site.json has home texts that are not the ones of any preset");
  }
  if (!keepTheme) {
    const brand = safeRead("config/brand.ts") ?? "";
    const block = brand.slice(brand.indexOf("theme: {"), brand.indexOf("}", brand.indexOf("theme: {")));
    const theme = Object.fromEntries([...block.matchAll(/\b(\w+):\s*"(#[0-9a-fA-F]{3,8})"/g)].map((m) => [m[1], m[2].toLowerCase()]));
    if (Object.keys(theme).length > 0 && !presets.some((p) => Object.entries(p.palette).every(([k, v]) => theme[k] === v.toLowerCase()))) {
      reasons.push("the colours of config/brand.ts are not the palette of any preset (use --keep-theme to leave them alone)");
    }
  }
  // Changes that git does not have yet would be lost for good.
  const git = spawnSync("git", ["status", "--porcelain", "--", ...FILES], { cwd: root, encoding: "utf8" });
  if (git.status === 0 && git.stdout.trim()) {
    for (const line of git.stdout.trim().split("\n")) reasons.push(`uncommitted changes: ${line.trim()}`);
  }
  return reasons;
}

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

const reasons = reasonsToStop();
if (reasons.length > 0 && !force) {
  console.error(`✗ Preset "${name}" was NOT applied: it would overwrite work that is not a preset's.\n`);
  for (const r of reasons) console.error(`  · ${r}`);
  console.error(`\nNothing was changed. Commit or save what you want to keep, then run:\n  npm run preset ${name} -- --force\n(a copy of the current files is kept in .preset-backups/ either way).`);
  process.exit(1);
}

// A copy of everything that is about to be replaced. One folder per run: never overwritten.
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
let backupDir = join(root, ".preset-backups", stamp);
for (let n = 2; existsSync(backupDir); n++) backupDir = join(root, ".preset-backups", `${stamp}-${n}`);
const keep = (from, as) => {
  if (!existsSync(from)) return false;
  mkdirSync(dirname(join(backupDir, as)), { recursive: true });
  copyFileSync(from, join(backupDir, as));
  return true;
};
for (const file of FILES) keep(join(root, file), file);
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

// The example images and files ship with the template, but a store may have deleted them: what
// this preset shows and is not there is drawn again (placeholders made from scratch, no photos).
const missingImage = preset.products.some((p) => (p.images ?? []).some((i) => i.placeholder && !existsSync(join(root, "public", i.src))));
if (missingImage) spawnSync(process.execPath, [join(root, "scripts/generate-images.mjs")], { stdio: "ignore" });
const missingFile = preset.products.some((p) => p.digital?.file && !existsSync(join(root, "content/downloads", p.digital.file)));
if (missingFile) spawnSync(process.execPath, [join(root, "scripts/generate-samples.mjs")], { stdio: "ignore" });

// The same catalogue as SQL, for the database adapters.
spawnSync(process.execPath, [join(root, "scripts/generate-seed.mjs")], { stdio: "inherit" });

// Local development keeps what the admin panel saved in DATA_DIR: the catalogue edited there
// would hide the new one, and its orders point at products that may no longer exist. Both are
// set aside (copied to the backup and moved out of the way), never deleted. DATA_DIR may be
// absolute, as in lib/data/json.ts.
const dataDir = resolve(root, process.env.DATA_DIR || ".data");
const setAside = [];
for (const file of ["catalog.json", "orders.json"]) {
  const saved = join(dataDir, file);
  if (!existsSync(saved)) continue;
  keep(saved, join("data", file));
  renameSync(saved, join(dataDir, file.replace(/\.json$/, `.before-preset-${stamp}.json`)));
  setAside.push(file);
}

const types = [...new Set(preset.products.map((p) => p.type ?? "physical"))];
console.log(`✓ Preset "${name}" applied — ${tr(preset.name)}`);
console.log(`  · content/products.json   ${preset.products.length} products in ${preset.categories.length} categories (types: ${types.join(", ")})`);
console.log("  · content/site.json       home texts (hero, benefits, questions)");
console.log(keepTheme ? "  · config/brand.ts         colours left as they were (--keep-theme)" : `  · config/brand.ts         ${themed} colours of the suggested palette`);
console.log("  · db/seed.sql             the same catalogue as SQL");
if (missingImage || missingFile) console.log(`  · ${[missingImage ? "public/products/" : "", missingFile ? "content/downloads/" : ""].filter(Boolean).join(" and ")}   the example ${missingImage ? "images" : "files"}${missingImage && missingFile ? " and files" : ""} that were missing, drawn again`);
if (setAside.length > 0) console.log(`  · ${dataDir}: ${setAside.join(" and ")} set aside (…before-preset-${stamp}.json): local edits would hide the new catalogue, and old orders point at products that are gone`);
console.log(`  · a copy of what was replaced is in ${backupDir.slice(root.length + 1)}/`);
if (reasons.length > 0) console.log(`  · --force: applied over ${reasons.length} warning(s)`);
console.log("\nNext: restart `npm run dev` (or build again) and replace every EXAMPLE with the real data of the business.");
