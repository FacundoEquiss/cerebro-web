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
// written; a quantity rule that cannot be met. A file with the wrong shape is an error with a
// sentence, never a crash.
// WARNINGS (it works, but it is not finished): texts still marked EXAMPLE / EJEMPLO / COMPLETAR /
// FILL IN; DRAFTS (products without a price — they are not for sale until the owner gives one);
// a price of 0; an event with no date left, with a date written twice, with a date at an hour
// the clocks skip that day, or with dates that overlap; the file of a digital product that is
// not here.
//
// "price": null means «not known yet» → a DRAFT. The one exception is `type: "quote"`: a quote
// has no public price by nature, so null (or 0) there is normal and the product is on show.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = join(dirname(fileURLToPath(import.meta.url)), "..");
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
// An id is never shown: any code the business already uses is fine ("SKU_123", "A-01.b").
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
const TYPES = ["physical", "digital", "service", "quote"];
const SESSION = /^(\d{4}-\d{2}-\d{2})T(([01]\d|2[0-3]):[0-5]\d)$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const WEEKS = [1, 2, 3, 4, "last", "every"];
const LEFTOVER = /\b(EJEMPLO|EXAMPLE|COMPLETAR|FILL IN)\b/;
const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const text = (v) => (v == null ? "" : typeof v === "string" ? v : isObject(v) ? Object.values(v).filter((x) => typeof x === "string").join(" ") : "");
const amount = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0;

/** The clock of `timeZone` at an instant, as "YYYY-MM-DDTHH:MM". */
function wall(instant, timeZone) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(instant)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

/** The instant at which the clocks of `timeZone` show `start`, or null when they never do (the hour skipped by daylight saving). */
function instantOf(start, timeZone) {
  const wanted = Date.parse(`${start}:00Z`);
  let guess = wanted;
  for (let i = 0; i < 2; i++) guess += wanted - Date.parse(`${wall(guess, timeZone)}:00Z`);
  return wall(guess, timeZone) === start ? guess : null;
}

/** The time zone of the store, read from config/commerce.ts as text (UTC if it is not there). */
function storeTimeZone(root) {
  try {
    const zone = /\btimeZone:\s*"([^"]+)"/.exec(readFileSync(join(root, "config/commerce.ts"), "utf8"))?.[1] ?? "UTC";
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return zone;
  } catch {
    return "UTC";
  }
}

/** Validates the catalogue of a project. Pure: returns what it found, prints nothing, never throws. */
export function checkCatalog(root = here, now = Date.now()) {
  const errors = [];
  const warnings = [];
  const drafts = [];
  const examples = [];
  const done = (products = 0) => ({ errors, warnings, drafts, examples, products });
  const file = join(root, "content/products.json");
  if (!existsSync(file)) {
    errors.push("content/products.json is not there: the store needs it (start from a preset with `npm run preset <name>`)");
    return done();
  }
  let data;
  try {
    data = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    errors.push(`content/products.json is not valid JSON: ${e.message}`);
    return done();
  }
  if (!isObject(data)) {
    errors.push('content/products.json must be an object: { "categories": [...], "products": [...] }');
    return done();
  }
  if (!Array.isArray(data.categories)) errors.push("`categories` must be a list");
  if (!Array.isArray(data.products)) errors.push("`products` must be a list");
  const categories = Array.isArray(data.categories) ? data.categories : [];
  const products = Array.isArray(data.products) ? data.products : [];
  const zone = storeTimeZone(root);
  const slugs = new Set();
  categories.forEach((c, i) => {
    if (!isObject(c)) return void errors.push(`category #${i + 1} must be an object with \`slug\` and \`name\``);
    if (typeof c.slug !== "string" || !SLUG.test(c.slug)) errors.push(`category "${c.slug}": the slug must be lowercase words joined by dashes`);
    if (slugs.has(c.slug)) errors.push(`category "${c.slug}" is repeated`);
    slugs.add(c.slug);
    if (!text(c.name)) errors.push(`category "${c.slug}" has no name`);
    if (LEFTOVER.test(`${text(c.name)} ${text(c.description)}`)) examples.push(`category ${c.slug}`);
  });
  const seen = { id: new Set(), slug: new Set() };
  products.forEach((p, i) => {
    if (!isObject(p)) return void errors.push(`product #${i + 1} must be an object`);
    const at = `product "${typeof p.id === "string" && p.id ? p.id : typeof p.slug === "string" && p.slug ? p.slug : `#${i + 1}`}"`;
    if (typeof p.id !== "string" || !ID.test(p.id)) errors.push(`${at}: \`id\` must be a code of letters, numbers, dashes, dots or underscores (it is never shown)`);
    else if (seen.id.has(p.id)) errors.push(`${at}: the id "${p.id}" is used twice`);
    if (typeof p.slug !== "string" || !SLUG.test(p.slug)) errors.push(`${at}: \`slug\` must be lowercase words joined by dashes (it is the address of the product)`);
    else if (seen.slug.has(p.slug)) errors.push(`${at}: the slug "${p.slug}" is used twice`);
    seen.id.add(p.id);
    seen.slug.add(p.slug);
    if (!text(p.name)) errors.push(`${at} has no name`);
    if (!slugs.has(p.category)) errors.push(`${at}: the category "${p.category}" does not exist`);
    const type = p.type ?? "physical";
    if (!TYPES.includes(type)) errors.push(`${at}: the type "${type}" does not exist (${TYPES.join(", ")})`);
    // No price = a draft… except for a quote, which has no public price by nature.
    const draft = p.draft === true || (p.price == null && type !== "quote");
    if (p.price != null && !amount(p.price)) errors.push(`${at}: the price must be a number (0 or more), or null while it is not known`);
    if (draft) drafts.push(String(p.id ?? p.slug ?? `#${i + 1}`));
    else if (p.price === 0 && type !== "quote") warnings.push(`${at} costs 0: if the price is not known yet, write "price": null (a draft) instead`);
    if (p.compareAtPrice != null && !amount(p.compareAtPrice)) errors.push(`${at}: \`compareAtPrice\` must be a number (0 or more) or null`);
    if (p.stock != null && !amount(p.stock)) errors.push(`${at}: \`stock\` must be a number (0 or more), or null for "made to order"`);
    const step = p.step ?? 1;
    const min = p.minQuantity ?? 1;
    if (typeof step !== "number" || typeof min !== "number" || !(step > 0) || !(min > 0)) errors.push(`${at}: \`step\` and \`minQuantity\` must be numbers above 0`);
    else if (Math.abs(Math.round((min / step) * 1000) / 1000 - Math.round(min / step)) > 1e-9) errors.push(`${at}: the minimum (${min}) is not a multiple of the step (${step}): nobody could buy it`);
    if (p.maxQuantity != null && !(typeof p.maxQuantity === "number" && p.maxQuantity >= min)) errors.push(`${at}: the maximum is below the minimum`);
    if (type === "service") {
      const s = p.service;
      if (!isObject(s) || !Number.isInteger(s.durationMinutes) || !Number.isInteger(s.capacity) || s.durationMinutes < 5 || s.capacity < 1) {
        errors.push(`${at}: a service needs \`service.durationMinutes\` (5 or more) and \`service.capacity\` (1 or more)`);
      } else {
        checkEvent(s, at);
      }
    }
    if (type === "digital") {
      if (!isObject(p.digital) || !text(p.digital.name)) errors.push(`${at}: a digital product needs \`digital.name\` (what the customer downloads)`);
      else if (!p.digital.file) warnings.push(`${at} has no file yet: upload it from the admin panel`);
      else if (!existsSync(join(root, "content/downloads", String(p.digital.file)))) warnings.push(`${at}: its file is not in content/downloads (fine if it was uploaded to the private storage)`);
    }
    if (p.options != null && !Array.isArray(p.options)) errors.push(`${at}: \`options\` must be a list`);
    if (p.variants != null && !Array.isArray(p.variants)) errors.push(`${at}: \`variants\` must be a list`);
    const options = Array.isArray(p.options) ? p.options.filter(isObject) : [];
    for (const v of Array.isArray(p.variants) ? p.variants : []) {
      const ok = isObject(v) && options.length > 0 && options.every((o) => (Array.isArray(o.values) ? o.values : []).some((val) => val?.id === v.options?.[o.id]));
      if (!ok) errors.push(`${at}: the variant "${isObject(v) ? v.id : v}" does not match the declared options`);
    }
    if (p.images != null && !Array.isArray(p.images)) errors.push(`${at}: \`images\` must be a list`);
    const images = Array.isArray(p.images) ? p.images : [];
    if (images.length === 0) warnings.push(`${at} has no image`);
    for (const image of images) {
      if (!isObject(image) || typeof image.src !== "string") {
        errors.push(`${at}: every image needs \`src\`, \`alt\`, \`width\` and \`height\``);
        continue;
      }
      const src = image.src;
      if (src.startsWith("/") && !src.startsWith("/media/") && !existsSync(join(root, "public", src))) errors.push(`${at}: the image ${src} is not in public/`);
      if (!text(image.alt)) warnings.push(`${at}: the image ${src} has no description (alt)`);
    }
    if (LEFTOVER.test(`${text(p.name)} ${text(p.description)}`)) examples.push(`product ${p.id}`);
  });

  /** The dates of an event: a list (`sessions`), a rule that repeats (`repeat`), or both. */
  function checkEvent(s, at) {
    if (s.repeat !== undefined) {
      const r = s.repeat;
      if (!isObject(r) || !WEEKS.includes(r.week) || !WEEKDAYS.includes(r.weekday) || !TIME.test(r.time ?? "")) {
        errors.push(`${at}: \`service.repeat\` is written { "week": 1 | 2 | 3 | 4 | "last" | "every", "weekday": "sat", "time": "10:00", "count": 3 }`);
      } else if (r.count !== undefined && !(Number.isInteger(r.count) && r.count >= 1 && r.count <= 24)) {
        errors.push(`${at}: \`service.repeat.count\` is a whole number from 1 to 24`);
      }
    }
    if (s.sessions === undefined) return;
    if (!Array.isArray(s.sessions) || s.sessions.some((x) => !isObject(x) || !SESSION.test(x.start ?? ""))) {
      return void errors.push(`${at}: every date of \`service.sessions\` is written { "start": "YYYY-MM-DDTHH:MM" }`);
    }
    if (s.sessions.some((x) => x.durationMinutes !== undefined && !(Number.isInteger(x.durationMinutes) && x.durationMinutes >= 5))) {
      errors.push(`${at}: the \`durationMinutes\` of a date is a whole number of minutes, 5 or more`);
    }
    const starts = s.sessions.map((x) => x.start);
    const twice = [...new Set(starts.filter((x, n) => starts.indexOf(x) !== n))];
    if (twice.length > 0) warnings.push(`${at}: the date ${twice.join(", ")} is written twice (it counts as one)`);
    const spans = [];
    for (const x of s.sessions) {
      const start = instantOf(x.start, zone);
      if (start === null) warnings.push(`${at}: ${x.start} does not exist in ${zone} (the clocks skip that hour that day): nobody can sign up for it`);
      else spans.push([x.start, start, start + (Number.isInteger(x.durationMinutes) ? x.durationMinutes : s.durationMinutes) * 60_000]);
    }
    if (s.repeat === undefined && !spans.some(([, start]) => start > now)) warnings.push(`${at} is an event with no date left: add the next ones, give it a \`repeat\` rule or pause it`);
    const unique = spans.filter(([slot], n) => spans.findIndex(([other]) => other === slot) === n).sort((a, b) => a[1] - b[1]);
    for (let n = 1; n < unique.length; n++) {
      if (unique[n][1] < unique[n - 1][2]) warnings.push(`${at}: the dates ${unique[n - 1][0]} and ${unique[n][0]} overlap: they share the same seats (people in one take places from the other)`);
    }
  }

  try {
    const site = JSON.parse(readFileSync(join(root, "content/site.json"), "utf8"));
    if (LEFTOVER.test(JSON.stringify(site?.home ?? {}))) examples.push("the home texts (content/site.json)");
  } catch (e) {
    if (existsSync(join(root, "content/site.json"))) errors.push(`content/site.json is not valid JSON: ${e.message}`);
  }
  return done(products.length);
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
