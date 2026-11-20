#!/usr/bin/env node
// NO TRACE OF A PRIVATE BRAND. This template is generic, and a site derived from a real store
// must not leak that store into something public: its name, its owner, its products, its
// domains, its account ids, a phone or a real e-mail address. This script reads EVERY text file
// of the repository and fails on a hit. It runs in `npm run check` and before every build.
//
//  · GENERIC PATTERNS are always checked: long numbers (account ids, phones), measurement and
//    project ids, e-mail addresses that are not example.com, database hosts.
//  · YOUR OWN TERMS are optional and NEVER live in the repository — not encoded, not hashed
//    (both can be reversed). Put them in a local file ignored by git, `.brand-blocklist` at the
//    root (or the file named by BRAND_BLOCKLIST_FILE): one term per line, `=word` to match a
//    whole word only, `#` for comments. Without the file only the patterns run, with a notice.
//  · The names of hosted e-commerce platforms are allowed only where the project explains
//    itself (the READMEs, docs/ and the brain) — never in code, UI texts or config.
//
//   node scripts/check-brand.mjs            → checks the repository
//   node scripts/check-brand.mjs --stdin    → checks what arrives on standard input (git history…)
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
function loadBlocklist() {
  const file = [process.env.BRAND_BLOCKLIST_FILE, join(root, ".brand-blocklist")].filter(Boolean).find((f) => existsSync(f));
  if (!file) return { file: null, parts: [], whole: [] };
  const lines = readFileSync(file, "utf8").split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  return { file, parts: lines.filter((l) => !l.startsWith("=")), whole: lines.filter((l) => l.startsWith("=")).map((l) => l.slice(1).trim()).filter(Boolean) };
}

export const blocklist = loadBlocklist();
// Hosted platforms (public names, written in halves so this file passes its own rule): fine in
// the READMEs and docs, forbidden everywhere else.
const PLATFORMS = [["shop", "ify"], ["tienda", "nube"], ["woo", "commerce"]].map((p) => p.join(""));
const FORBIDDEN = blocklist.parts;
const FORBIDDEN_WHOLE = blocklist.whole;
const PATTERNS = [
  [/\d{11,}/, "long number (an account id or a phone?)"],
  [/\bG-[A-Z0-9]{8,}\b/, "measurement id"],
  [/\b(?:prj|team)_[A-Za-z0-9]{12,}\b/, "project id"],
  [/[A-Za-z0-9._%+-]+@(?!example\.(?:com|org)\b)[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/i, "e-mail address that is not example.com"],
  [/\b[a-z0-9]{20}\.supabase\.co\b/, "address of a database project"],
];

// The ONE allowed mention: the public address of this repository.
// (Written in two halves so this file does not trip over its own rule.)
const REPOSITORY = ["Fac", "undoEquiss/cerebro-web"].join("");
const ALLOWED = [new RegExp(REPOSITORY.replace("/", "\\/"), "gi")];

const SKIP_DIRS = new Set(["node_modules", ".next", ".git", ".vercel", ".data", "out", "coverage", "test-results", "playwright-report", ".preset-backups"]);
const SKIP_FILES = new Set([".brand-blocklist", "package-lock.json", "tsconfig.tsbuildinfo", "next-env.d.ts"]); // generated: hashes and third-party metadata
const BINARY = /\.(png|jpe?g|webp|avif|gif|ico|woff2?|ttf|otf|pdf|zip|gz|mp4|webm)$/i;
const DOCS = (file) => /^README(\.[a-z]{2})?\.md$/.test(file) || file.startsWith(`docs${sep}`) || file.startsWith(`cerebro${sep}`);

const plain = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Problems found in a text. `docs` = the platform names are allowed in it. */
export function findProblems(text, { docs = false } = {}) {
  let source = String(text);
  for (const re of ALLOWED) source = source.replace(re, "");
  const t = plain(source);
  const found = [];
  for (const w of FORBIDDEN) if (t.includes(plain(w))) found.push(`term ${FORBIDDEN.indexOf(w) + 1} of the local blocklist`);
  for (const w of FORBIDDEN_WHOLE) {
    if (new RegExp(`(^|[^a-z0-9])${escape(plain(w))}([^a-z0-9]|$)`).test(t)) found.push(`whole-word term ${FORBIDDEN_WHOLE.indexOf(w) + 1} of the local blocklist`);
  }
  if (!docs) for (const w of PLATFORMS) if (t.includes(w)) found.push(`platform name «${w}» outside the READMEs and docs`);
  for (const [re, what] of PATTERNS) {
    const m = source.match(re);
    if (m) found.push(`${what}: «${m[0]}»`);
  }
  return found;
}

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (!BINARY.test(name) && !SKIP_FILES.has(name)) yield full;
  }
}

const notice = () => {
  if (!blocklist.file) console.warn("• check-brand: no local blocklist (.brand-blocklist) — only the generic patterns are checked.");
};

if (process.argv.includes("--stdin")) {
  // Line by line, so a hit can be located; platform names are allowed (docs travel in history).
  notice();
  const lines = readFileSync(0, "utf8").split("\n");
  const errors = [];
  lines.forEach((line, i) => {
    for (const p of findProblems(line, { docs: true })) errors.push(`line ${i + 1}: ${p}`);
  });
  if (errors.length > 0) {
    console.error(`✗ check-brand: ${errors.length} problem(s) in ${lines.length} lines`);
    for (const e of errors.slice(0, 40)) console.error(`   - ${e}`);
    process.exit(1);
  }
  console.log(`✓ check-brand: ${lines.length} lines${blocklist.file ? `, ${FORBIDDEN.length + FORBIDDEN_WHOLE.length} local terms` : ""}, clean`);
} else if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  notice();
  let files = 0;
  const errors = [];
  for (const file of walk(root)) {
    files++;
    const rel = relative(root, file);
    // File names count too.
    for (const p of findProblems(rel, { docs: true })) errors.push(`${rel} (file name): ${p}`);
    for (const p of findProblems(readFileSync(file, "utf8"), { docs: DOCS(rel) })) errors.push(`${rel}: ${p}`);
  }
  if (errors.length > 0) {
    console.error(`✗ check-brand: ${errors.length} problem(s) in ${files} files`);
    for (const e of errors.slice(0, 80)) console.error(`   - ${e}`);
    process.exit(1);
  }
  console.log(`✓ check-brand: ${files} files${blocklist.file ? `, ${FORBIDDEN.length + FORBIDDEN_WHOLE.length} local terms` : ""}, no trace of a private brand`);
}
