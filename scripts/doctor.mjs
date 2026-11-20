#!/usr/bin/env node
// THE DOCTOR: looks at how this store is configured and says, in plain words, what is ready and
// which ONE step comes next on the way from the demo to selling. It changes nothing.
//
//   npm run doctor                    reads .env.local / .env and the files of this project
//   npm run doctor -- --env <file>    …another variables file (e.g. the one of `vercel env pull`)
//   npm run doctor -- --lang en       in English (default: the language of config/brand.ts)
//
// The variables of a hosting service live THERE, not in this folder: download them first, or
// read the result as "what this computer has". The steps are explained in docs/go-live.md.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkCatalog } from "./check-catalog.mjs";

const here = join(dirname(fileURLToPath(import.meta.url)), "..");

function readEnvFile(file) {
  const out = {};
  if (!existsSync(file)) return out;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m) out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
  }
  return out;
}

const T = {
  es: {
    title: "Estado de la tienda", ready: "Listo", todo: "Falta", info: "Para saber", next: "PRÓXIMO PASO", allDone: "Todo lo que se puede comprobar desde acá está listo. Hacé una compra de prueba de punta a punta.",
    guide: "La guía paso a paso está en docs/go-live.es.md", source: "Variables leídas de",
    catalogErr: (n) => `El catálogo tiene ${n} error(es): corré «npm run check:catalog».`,
    catalogOk: (n) => `El catálogo se puede leer (${n} productos).`,
    examples: (n) => `Quedan ${n} textos marcados como EJEMPLO en el catálogo o en la portada: reemplazalos por los reales (npm run check:catalog -- --all).`,
    noExamples: "El catálogo y la portada ya no tienen textos de ejemplo.",
    drafts: (ids) => `${ids.length} producto(s) en borrador, sin precio, que no se venden: ${ids.join(", ")}. Pedile el precio al dueño.`,
    brandTodo: "La marca todavía es la de ejemplo (nombre, e-mail o WhatsApp de config/brand.ts).", brandOk: (n) => `La marca está cargada: ${n}.`,
    commerceTodo: (n) => `config/commerce.ts tiene ${n} dato(s) de EJEMPLO o por COMPLETAR (envíos, datos bancarios, plazos).`, commerceOk: "Las reglas comerciales no tienen datos de ejemplo.",
    dbTodo: "Los pedidos no se guardan: DATA_SOURCE es «json». Conectá una base de datos (supabase o postgres).", dbKeys: (k) => `DATA_SOURCE pide variables que faltan: ${k}.`, dbOk: (s) => `Base de datos conectada (${s}).`,
    needsDb: "Tu catálogo tiene servicios, presupuestos o digitales: sin base de datos no se pueden vender por la web.",
    secretTodo: "Falta ORDER_SECRET (32 caracteres al azar o más): firma los comprobantes de los pedidos.", secretOk: "ORDER_SECRET está definido.",
    adminTodo: "No hay usuario del panel: creá uno con «npm run admin:hash» y cargalo en ADMIN_USERS (más ADMIN_SESSION_SECRET).", adminOk: (n) => `El panel tiene ${n} usuario(s).`,
    demoTodo: "El modo demo sigue encendido: poné DEMO_MODE=false.", demoOk: "El modo demo está apagado.",
    payManual: "Cobrás a mano (transferencia o WhatsApp). Para cobrar con tarjeta: PAYMENT_PROVIDER=mercadopago o stripe.", payKeys: (k) => `Al medio de pago le faltan variables: ${k}.`, payOk: (p) => `Pagos en línea con ${p}.`,
    mailTodo: "No sale ningún e-mail (MAIL_PROVIDER no está definido): ni avisos de pedido, ni presupuestos, ni descargas.", mailKeys: (k) => `Al correo le faltan variables: ${k}.`, mailOk: (p) => `El correo sale por ${p}.`, notifyTodo: "Falta ORDER_NOTIFY_EMAIL: el dueño no recibe un e-mail por cada pedido.",
    bucket: "Vendés digitales con archivos en Supabase: el bucket privado tiene que existir y ser PRIVADO.", localStorage: "Las fotos y los archivos se guardan en el disco del servidor (STORAGE_PROVIDER=local): en un hospedaje sin disco persistente se pierden.",
    urlTodo: "Falta NEXT_PUBLIC_SITE_URL con la dirección pública (https://…).", urlOk: (u) => `Dirección pública: ${u}.`,
    indexTodo: "Los buscadores no indexan la tienda: cuando esté todo listo, ALLOW_INDEXING=1.", indexOk: "La tienda permite que la indexen los buscadores.",
  },
  en: {
    title: "State of the store", ready: "Ready", todo: "Missing", info: "Good to know", next: "NEXT STEP", allDone: "Everything that can be checked from here is ready. Make a test purchase from end to end.",
    guide: "The step-by-step guide is docs/go-live.md", source: "Variables read from",
    catalogErr: (n) => `The catalogue has ${n} error(s): run "npm run check:catalog".`,
    catalogOk: (n) => `The catalogue can be read (${n} products).`,
    examples: (n) => `${n} texts in the catalogue or the home page are still marked EXAMPLE: replace them with the real ones (npm run check:catalog -- --all).`,
    noExamples: "The catalogue and the home page have no example texts left.",
    drafts: (ids) => `${ids.length} draft product(s) without a price, not for sale: ${ids.join(", ")}. Ask the owner for the price.`,
    brandTodo: "The brand is still the example one (name, e-mail or WhatsApp in config/brand.ts).", brandOk: (n) => `The brand is filled in: ${n}.`,
    commerceTodo: (n) => `config/commerce.ts has ${n} EXAMPLE or FILL IN value(s) (shipping, bank details, lead times).`, commerceOk: "The commercial rules have no example values.",
    dbTodo: 'Orders are not stored: DATA_SOURCE is "json". Connect a database (supabase or postgres).', dbKeys: (k) => `DATA_SOURCE needs variables that are missing: ${k}.`, dbOk: (s) => `Database connected (${s}).`,
    needsDb: "Your catalogue has services, quotes or digital products: without a database they cannot be sold online.",
    secretTodo: "ORDER_SECRET is missing (32+ random characters): it signs the order receipts.", secretOk: "ORDER_SECRET is set.",
    adminTodo: 'There is no admin user: create one with "npm run admin:hash" and put it in ADMIN_USERS (plus ADMIN_SESSION_SECRET).', adminOk: (n) => `The admin panel has ${n} user(s).`,
    demoTodo: "Demo mode is still on: set DEMO_MODE=false.", demoOk: "Demo mode is off.",
    payManual: "You charge by hand (bank transfer or WhatsApp). To take cards: PAYMENT_PROVIDER=mercadopago or stripe.", payKeys: (k) => `The payment provider is missing variables: ${k}.`, payOk: (p) => `Online payments with ${p}.`,
    mailTodo: "No e-mail is sent (MAIL_PROVIDER is not set): no order notices, no quotes, no downloads.", mailKeys: (k) => `The mail provider is missing variables: ${k}.`, mailOk: (p) => `E-mail goes out through ${p}.`, notifyTodo: "ORDER_NOTIFY_EMAIL is missing: the owner gets no e-mail per order.",
    bucket: "You sell digital products with files on Supabase: the private bucket must exist and be PRIVATE.", localStorage: "Photos and files are kept on the server's disk (STORAGE_PROVIDER=local): on hosting without a persistent disk they are lost.",
    urlTodo: "NEXT_PUBLIC_SITE_URL is missing: the public address (https://…).", urlOk: (u) => `Public address: ${u}.`,
    indexTodo: "Search engines do not index the store: when everything is ready, ALLOW_INDEXING=1.", indexOk: "The store lets search engines index it.",
  },
};

/** Pure: the diagnosis of a project folder with a set of variables. */
export function diagnose(root = here, env = {}, lang = "es") {
  const t = T[lang] ?? T.es;
  const items = []; // { ok: true | false | null (info), text }
  const add = (ok, text) => items.push({ ok, text });
  const missing = (...keys) => keys.filter((k) => !env[k]);

  const catalog = checkCatalog(root);
  let types = [];
  try {
    types = JSON.parse(readFileSync(join(root, "content/products.json"), "utf8")).products.map((p) => p.type ?? "physical");
  } catch {}
  if (catalog.errors.length > 0) add(false, t.catalogErr(catalog.errors.length));
  else add(true, t.catalogOk(catalog.products));
  if (catalog.examples.length > 0) add(false, t.examples(catalog.examples.length));
  else add(true, t.noExamples);
  if (catalog.drafts.length > 0) add(false, t.drafts(catalog.drafts));

  const brand = existsSync(join(root, "config/brand.ts")) ? readFileSync(join(root, "config/brand.ts"), "utf8") : "";
  const name = /\bname:\s*"([^"]*)"/.exec(brand)?.[1] ?? "";
  if (name === "Tu Marca" || /email:\s*"[^"]*@example\.com"/.test(brand) || /whatsapp:\s*"0+"/.test(brand)) add(false, t.brandTodo);
  else add(true, t.brandOk(name));
  const commerce = existsSync(join(root, "config/commerce.ts")) ? readFileSync(join(root, "config/commerce.ts"), "utf8") : "";
  // Only the VALUES count (texts between quotes), not the comments that explain the file.
  const leftovers = (commerce.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "").match(/"[^"\n]*\b(EJEMPLO|EXAMPLE|COMPLETAR|FILL IN)\b[^"\n]*"/g) ?? []).length;
  if (leftovers > 0) add(false, t.commerceTodo(leftovers));
  else add(true, t.commerceOk);

  const source = env.DATA_SOURCE || "json";
  const dbMissing = source === "supabase" ? missing("SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY") : source === "postgres" ? missing("DATABASE_URL") : [];
  if (source === "json") {
    add(false, t.dbTodo);
    if (types.some((x) => x !== "physical")) add(null, t.needsDb);
  } else if (dbMissing.length > 0) add(false, t.dbKeys(dbMissing.join(", ")));
  else add(true, t.dbOk(source));

  add((env.ORDER_SECRET ?? "").length >= 32, (env.ORDER_SECRET ?? "").length >= 32 ? t.secretOk : t.secretTodo);
  const admins = (env.ADMIN_USERS ?? "").split(/[,\n]/).filter((x) => x.includes(":scrypt.")).length;
  add(admins > 0 && Boolean(env.ADMIN_SESSION_SECRET || env.ORDER_SECRET), admins > 0 ? t.adminOk(admins) : t.adminTodo);
  const demo = env.DEMO_MODE === "true" || (env.DEMO_MODE !== "false" && admins === 0 && source === "json");
  add(!demo, demo ? t.demoTodo : t.demoOk);

  const pay = env.PAYMENT_PROVIDER || "manual";
  const payMissing = pay === "mercadopago" ? missing("MERCADOPAGO_ACCESS_TOKEN", "MERCADOPAGO_WEBHOOK_SECRET") : pay === "stripe" ? missing("STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET") : [];
  if (pay === "manual") add(null, t.payManual);
  else add(payMissing.length === 0, payMissing.length === 0 ? t.payOk(pay) : t.payKeys(payMissing.join(", ")));

  const mail = !env.MAIL_PROVIDER || env.MAIL_PROVIDER === "none" ? "console" : env.MAIL_PROVIDER;
  const mailMissing = mail === "resend" ? missing("RESEND_API_KEY", "MAIL_FROM") : mail === "smtp" ? missing("SMTP_URL", "MAIL_FROM") : [];
  if (mail === "console") add(false, t.mailTodo);
  else {
    add(mailMissing.length === 0, mailMissing.length === 0 ? t.mailOk(mail) : t.mailKeys(mailMissing.join(", ")));
    if (!env.ORDER_NOTIFY_EMAIL) add(false, t.notifyTodo);
  }
  if ((env.STORAGE_PROVIDER || "local") === "supabase" && types.includes("digital")) add(null, t.bucket);
  if ((env.STORAGE_PROVIDER || "local") === "local" && source !== "json") add(null, t.localStorage);

  const url = env.NEXT_PUBLIC_SITE_URL ?? "";
  add(/^https:\/\//.test(url), /^https:\/\//.test(url) ? t.urlOk(url) : t.urlTodo);
  add(env.ALLOW_INDEXING === "1", env.ALLOW_INDEXING === "1" ? t.indexOk : t.indexTodo);

  const next = items.find((i) => i.ok === false)?.text ?? null;
  return { items, next, labels: t };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const value = (flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined);
  const files = value("--env") ? [value("--env")] : [".env", ".env.local"].map((f) => join(here, f));
  const env = Object.assign({}, ...files.map(readEnvFile), Object.fromEntries(Object.entries(process.env).filter(([k]) => /^[A-Z0-9_]+$/.test(k))));
  const brand = existsSync(join(here, "config/brand.ts")) ? readFileSync(join(here, "config/brand.ts"), "utf8") : "";
  const lang = value("--lang") ?? /locale:\s*"(\w+)"/.exec(brand)?.[1] ?? "es";
  const { items, next, labels: t } = diagnose(here, env, lang);
  const used = files.filter((f) => existsSync(f)).map((f) => f.replace(`${here}/`, ""));
  console.log(`\n${t.title}\n${"─".repeat(t.title.length)}`);
  console.log(`${t.source}: ${used.length > 0 ? used.join(", ") : "—"} + process.env\n`);
  for (const [ok, label, mark] of [[true, t.ready, "✓"], [false, t.todo, "✗"], [null, t.info, "•"]]) {
    const list = items.filter((i) => i.ok === ok);
    if (list.length === 0) continue;
    console.log(`${label}:`);
    for (const i of list) console.log(`  ${mark} ${i.text}`);
    console.log("");
  }
  console.log(`${t.next}: ${next ?? t.allDone}`);
  console.log(`${t.guide}\n`);
}
