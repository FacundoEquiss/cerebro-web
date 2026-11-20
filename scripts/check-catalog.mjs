#!/usr/bin/env node
// Checks YOUR catalogue — content/products.json and content/site.json — before it reaches a
// customer. It is part of `npm run check`.
//
//   npm run check:catalog            errors stop the check; warnings are summed up
//   npm run check:catalog -- --all   …and every warning is listed
//
// ERRORS (the store would break or sell something wrong): a product without id, slug, name or
// category; a slug used twice; a category that does not exist; a type that does not exist; an
// image or a variant that points nowhere; a service without duration and seats; a date badly
// written; a quantity rule that cannot be met.
// WARNINGS (it works, but it is not finished): texts still marked EXAMPLE / EJEMPLO / COMPLETAR /
// FILL IN; DRAFTS (products without a price — they are not for sale until the owner gives one);
// a price of 0; an event with no date left; the file of a digital product that is not here.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = join(dirname(fileURLToPath(import.meta.url)), "..");
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TYPES = ["physical", "digital", "service", "quote"];
const SESSION = /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/;
const LEFTOVER = /\b(EJEMPLO|EXAMPLE|COMPLETAR|FILL IN)\b/;
const text = (v) => (v == null ? "" : typeof v === "string" ? v : Object.values(v).join(" "));

/** Validates the catalogue of a project. Pure: returns what it found, prints nothing. */
export function checkCatalog(root = here, now = Date.now()) {
  const errors = [];
  const warnings = [];
  const drafts = [];
  const examples = [];
  let data;
  try {
    data = JSON.parse(readFileSync(join(root, "content/products.json"), "utf8"));
  } catch (e) {
    return { errors: [`content/products.json cannot be read: ${e.message}`], warnings, drafts, examples, products: 0 };
  }
  const categories = Array.isArray(data.categories) ? data.categories : [];
  const products = Array.isArray(data.products) ? data.products : [];
  if (!Array.isArray(data.categories)) errors.push("`categories` must be a list");
  if (!Array.isArray(data.products)) errors.push("`products` must be a list");
  const slugs = new Set();
  for (const c of categories) {
    if (!SLUG.test(c.slug ?? "")) errors.push(`category "${c.slug}": the slug must be lowercase words joined by dashes`);
    if (slugs.has(c.slug)) errors.push(`category "${c.slug}" is repeated`);
    slugs.add(c.slug);
    if (!text(c.name)) errors.push(`category "${c.slug}" has no name`);
    if (LEFTOVER.test(`${text(c.name)} ${text(c.description)}`)) examples.push(`category ${c.slug}`);
  }
  const seen = { id: new Set(), slug: new Set() };
  for (const p of products) {
    const at = `product "${p.id ?? p.slug ?? "?"}"`;
    for (const key of ["id", "slug"]) {
      if (!SLUG.test(p[key] ?? "")) errors.push(`${at}: \`${key}\` must be lowercase words joined by dashes`);
      else if (seen[key].has(p[key])) errors.push(`${at}: the ${key} "${p[key]}" is used twice`);
      seen[key].add(p[key]);
    }
    if (!text(p.name)) errors.push(`${at} has no name`);
    if (!slugs.has(p.category)) errors.push(`${at}: the category "${p.category}" does not exist`);
    const type = p.type ?? "physical";
    if (!TYPES.includes(type)) errors.push(`${at}: the type "${type}" does not exist (${TYPES.join(", ")})`);
    const draft = p.draft === true || p.price == null;
    if (p.price != null && !(typeof p.price === "number" && p.price >= 0)) errors.push(`${at}: the price must be a number, or null while it is not known`);
    if (draft) drafts.push(p.id);
    else if (p.price === 0 && type !== "quote") warnings.push(`${at} costs 0: if the price is not known yet, write "price": null (a draft) instead`);
    const step = p.step ?? 1;
    const min = p.minQuantity ?? 1;
    if (!(step > 0) || !(min > 0)) errors.push(`${at}: \`step\` and \`minQuantity\` must be above 0`);
    else if (Math.abs(Math.round((min / step) * 1000) / 1000 - Math.round(min / step)) > 1e-9) errors.push(`${at}: the minimum (${min}) is not a multiple of the step (${step}): nobody could buy it`);
    if (p.maxQuantity != null && !(p.maxQuantity >= min)) errors.push(`${at}: the maximum is below the minimum`);
    if (type === "service") {
      const s = p.service;
      if (!s || !Number.isInteger(s.durationMinutes) || !Number.isInteger(s.capacity) || s.durationMinutes < 5 || s.capacity < 1) {
        errors.push(`${at}: a service needs \`service.durationMinutes\` and \`service.capacity\``);
      }
      if (s?.sessions !== undefined) {
        if (!Array.isArray(s.sessions) || s.sessions.some((x) => !SESSION.test(x?.start ?? ""))) errors.push(`${at}: every date of \`service.sessions\` is written "YYYY-MM-DDTHH:MM"`);
        // Compared as text against today (the exact check, in the store's time zone, is the server's).
        else if (!s.sessions.some((x) => x.start > new Date(now).toISOString().slice(0, 16))) warnings.push(`${at} is an event with no date left: add the next ones or pause it`);
      }
    }
    if (type === "digital") {
      if (!text(p.digital?.name)) errors.push(`${at}: a digital product needs \`digital.name\` (what the customer downloads)`);
      else if (!p.digital.file) warnings.push(`${at} has no file yet: upload it from the admin panel`);
      else if (!existsSync(join(root, "content/downloads", p.digital.file))) warnings.push(`${at}: its file is not in content/downloads (fine if it was uploaded to the private storage)`);
    }
    const options = Array.isArray(p.options) ? p.options : [];
    for (const v of p.variants ?? []) {
      const ok = options.length > 0 && options.every((o) => (o.values ?? []).some((val) => val.id === v.options?.[o.id]));
      if (!ok) errors.push(`${at}: the variant "${v.id}" does not match the declared options`);
    }
    if (!Array.isArray(p.images) || p.images.length === 0) warnings.push(`${at} has no image`);
    for (const image of p.images ?? []) {
      const src = image.src ?? "";
      if (src.startsWith("/") && !src.startsWith("/media/") && !existsSync(join(root, "public", src))) errors.push(`${at}: the image ${src} is not in public/`);
      if (!text(image.alt)) warnings.push(`${at}: the image ${src} has no description (alt)`);
    }
    if (LEFTOVER.test(`${text(p.name)} ${text(p.description)}`)) examples.push(`product ${p.id}`);
  }
  try {
    const site = JSON.parse(readFileSync(join(root, "content/site.json"), "utf8"));
    if (LEFTOVER.test(JSON.stringify(site.home ?? {}))) examples.push("the home texts (content/site.json)");
  } catch (e) {
    if (existsSync(join(root, "content/site.json"))) errors.push(`content/site.json cannot be read: ${e.message}`);
  }
  return { errors, warnings, drafts, examples, products: products.length };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const all = process.argv.includes("--all");
  const r = checkCatalog();
  for (const e of r.errors) console.error(`   ✗ ${e}`);
  const notes = [...r.warnings];
  if (r.drafts.length > 0) notes.push(`${r.drafts.length} draft(s) without a price, not for sale until the owner gives it: ${r.drafts.join(", ")}`);
  if (r.examples.length > 0) notes.push(`${r.examples.length} text(s) still marked EXAMPLE / EJEMPLO / COMPLETAR${all ? `: ${r.examples.join(", ")}` : " (list them with: npm run check:catalog -- --all)"}`);
  for (const w of all ? notes : notes.slice(0, 6)) console.log(`   • ${w}`);
  if (!all && notes.length > 6) console.log(`   • …and ${notes.length - 6} more (npm run check:catalog -- --all)`);
  if (r.errors.length > 0) {
    console.error(`✗ check-catalog: ${r.errors.length} error(s) in content/products.json`);
    process.exit(1);
  }
  console.log(`✓ check-catalog: ${r.products} products, no errors${notes.length > 0 ? `, ${notes.length} thing(s) to finish` : ""}`);
}
