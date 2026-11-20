#!/usr/bin/env node
// create-cerebro-web — starts a new store from the Cerebro Web template, in one command:
//
//   npm create cerebro-web@latest my-store
//   npm create cerebro-web@latest my-store -- --preset almacen --no-install
//
// What it does: gets the template (git clone, or the GitHub tarball when git is not there), asks
// which line of business the store is in and applies that preset, installs the dependencies,
// starts a fresh git repository and prints what to do next. No dependencies: Node 20.9+ only.
//
// Flags (all optional — with them nothing is asked, so an agent can run it):
//   --preset <name>   the starting catalogue (mixto, moda, hogar, tecnologia, almacen,
//                     gastronomia, servicios, digital, a-medida). Default when not asked: mixto
//   --no-install      do not run `npm install`
//   --no-git          do not start a git repository
//   --yes             never ask: take the defaults
//   --lang en         messages in English (default: Spanish)
//   --ref <name>      another branch or tag of the template
//
// A new store keeps the brain (cerebro/), AGENTS.md and CLAUDE.md, because the agent that adapts
// it needs them, and ROADMAP.md, because AGENTS.md and the docs point to it for what the base
// does not do yet. It starts its own CHANGELOG and leaves packages/ and the preset CI behind:
// those belong to the template's repository.
//
// CEREBRO_WEB_TEMPLATE=<folder> uses a local copy of the template instead of downloading it
// (that is how the tests run it).
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";

const REPO = "FacundoEquiss/cerebro-web";
const SKIP = new Set(["node_modules", ".git", ".next", ".next-fixtures", ".data", ".vercel", "out", "coverage", "test-results", "playwright-report", "screenshots", ".preset-backups", ".brand-blocklist", "tsconfig.tsbuildinfo"]);

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const WITH_VALUE = ["--preset", "--lang", "--ref"];
const value = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const positional = args.filter((a, i) => !a.startsWith("--") && !WITH_VALUE.includes(args[i - 1] ?? ""));
const en = value("--lang") === "en";
const say = (es, english) => console.log(en ? english : es);
/** Undoes what this run created: a folder it made is removed, a folder that was there (empty) is emptied. */
let cleanup = () => {};
const fail = (es, english) => {
  cleanup();
  console.error(`✗ ${en ? english : es}`);
  process.exit(1);
};
for (const name of WITH_VALUE) {
  const v = value(name);
  if (args.includes(name) && (v === undefined || v.startsWith("--"))) fail(`A ${name} le falta el valor (por ejemplo: ${name} ${name === "--preset" ? "almacen" : name === "--lang" ? "en" : "main"}).`, `${name} needs a value (for example: ${name} ${name === "--preset" ? "almacen" : name === "--lang" ? "en" : "main"}).`);
}
// git and tar are real programs: they run WITHOUT a shell, so a folder with spaces or an odd
// character reaches them as one argument, on every system.
const run = (command, commandArgs, cwd, quiet = true) => spawnSync(command, commandArgs, { cwd, stdio: quiet ? "ignore" : "inherit", shell: false });
// npm is a .cmd file on Windows and only runs through the shell there. The command line is fixed
// text (no path in it: the folder travels in `cwd`), so there is nothing to quote.
const npm = (commandArgs, cwd) =>
  process.platform === "win32"
    ? spawnSync(`npm.cmd ${commandArgs.join(" ")}`, { cwd, stdio: "inherit", shell: true })
    : spawnSync("npm", commandArgs, { cwd, stdio: "inherit", shell: false });
const interactive = process.stdin.isTTY && !flag("--yes");

async function ask(question, fallback) {
  if (!interactive) return fallback;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question(question)).trim();
  rl.close();
  return answer || fallback;
}

/** The template, in `target`: a local folder, a shallow clone, or the tarball. */
async function fetchTemplate(target) {
  const local = process.env.CEREBRO_WEB_TEMPLATE;
  const ref = value("--ref") ?? "main";
  if (local) {
    const from = resolve(local);
    cpSync(from, target, { recursive: true, filter: (source) => !SKIP.has(basename(source)) && !/^\.env(\.(?!example$).*)?$/.test(basename(source)) });
    return "local";
  }
  if (run("git", ["clone", "--depth", "1", "--branch", ref, `https://github.com/${REPO}.git`, target]).status === 0) return "git";
  // No git (or no access through it): the same files as a tarball, unpacked with the system tar.
  rmSync(target, { recursive: true, force: true });
  mkdirSync(target, { recursive: true });
  // A branch first, then a tag of the same name.
  let response = await fetch(`https://codeload.github.com/${REPO}/tar.gz/refs/heads/${ref}`).catch(() => null);
  if (!response?.ok) response = await fetch(`https://codeload.github.com/${REPO}/tar.gz/refs/tags/${ref}`).catch(() => null);
  if (!response) fail("No se pudo descargar la plantilla: no hay conexión con GitHub.", "The template could not be downloaded: GitHub cannot be reached.");
  if (!response.ok) fail(`No se pudo descargar la plantilla (${response.status}).`, `The template could not be downloaded (${response.status}).`);
  const archive = join(target, ".template.tar.gz");
  writeFileSync(archive, Buffer.from(await response.arrayBuffer()));
  const untar = run("tar", ["-xzf", archive, "--strip-components=1", "-C", target]);
  rmSync(archive, { force: true });
  if (untar.status !== 0) fail("No se pudo descomprimir la plantilla: hace falta `git` o `tar`.", "The template could not be unpacked: `git` or `tar` is needed.");
  return "tarball";
}

const name = positional[0] ?? (await ask(en ? "Folder of the new store: " : "Carpeta de la tienda nueva: ", "mi-tienda"));
const target = resolve(name);
const existed = existsSync(target);
if (existed && !statSync(target).isDirectory()) fail(`${name} ya existe y es un archivo: elegí otro nombre para la carpeta.`, `${name} already exists and is a file: choose another name for the folder.`);
if (existed && readdirSync(target).length > 0) fail(`La carpeta ${name} ya existe y no está vacía.`, `The folder ${name} already exists and is not empty.`);

say(`\nCreando ${basename(target)} desde Cerebro Web…`, `\nCreating ${basename(target)} from Cerebro Web…`);
cleanup = () => {
  if (!existed) rmSync(target, { recursive: true, force: true });
  else for (const entry of existsSync(target) ? readdirSync(target) : []) rmSync(join(target, entry), { recursive: true, force: true });
};
await fetchTemplate(target);
// What belongs to the template's own repository, not to a store.
for (const leftover of [".git", "packages", ".github/workflows/presets.yml"]) rmSync(join(target, leftover), { recursive: true, force: true });

const presetsDir = join(target, "content/presets");
const presets = existsSync(presetsDir) ? readdirSync(presetsDir).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, "")).sort() : [];
let preset = value("--preset");
if (!preset && presets.length > 0) {
  const titles = presets.map((p) => {
    const data = JSON.parse(readFileSync(join(presetsDir, `${p}.json`), "utf8"));
    return `  ${p.padEnd(12)} ${data.name?.[en ? "en" : "es"] ?? ""}`;
  });
  if (interactive) say(`\n¿De qué rubro es la tienda?\n${titles.join("\n")}`, `\nWhich line of business is the store in?\n${titles.join("\n")}`);
  preset = await ask(en ? "Preset [mixto]: " : "Preset [mixto]: ", "mixto");
}
if (preset && !presets.includes(preset)) {
  fail(`No existe el preset «${preset}». Disponibles: ${presets.join(", ")}.`, `There is no preset "${preset}". Available: ${presets.join(", ")}.`);
}

// The new project is the owner's: its own name, its own version, no link to the template's repository.
const slug = basename(target).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase() || "my-store";
const pkgFile = join(target, "package.json");
const pkg = JSON.parse(readFileSync(pkgFile, "utf8"));
const { repository: _r, bugs: _b, homepage: _h, ...rest } = pkg;
writeFileSync(pkgFile, `${JSON.stringify({ ...rest, name: slug, version: "0.1.0", private: true }, null, 2)}\n`);

// Its own history starts here; the template's stays in the template.
const today = new Date().toISOString().slice(0, 10);
writeFileSync(
  join(target, "CHANGELOG.md"),
  en
    ? `# Changelog\n\nWhat changes in this store, newest first.\n\n## 0.1.0 — ${today}\n\n- Started from the Cerebro Web ${pkg.version} template${preset ? ` with the "${preset}" preset` : ""}.\n`
    : `# Cambios\n\nLo que cambia en esta tienda, lo más nuevo arriba.\n\n## 0.1.0 — ${today}\n\n- Arranca de la plantilla Cerebro Web ${pkg.version}${preset ? ` con el preset «${preset}»` : ""}.\n`,
);

if (preset && preset !== "mixto") {
  // --force: this is a brand-new copy, there is no work of anyone's to protect in it.
  const applied = spawnSync(process.execPath, [join(target, "scripts/preset.mjs"), preset, "--force"], { cwd: target, encoding: "utf8" });
  if (applied.status !== 0) fail(`No se pudo aplicar el preset: ${applied.stderr}`, `The preset could not be applied: ${applied.stderr}`);
  rmSync(join(target, ".preset-backups"), { recursive: true, force: true });
}
say(`✓ Plantilla lista, con el preset «${preset ?? "mixto"}».`, `✓ Template ready, with the "${preset ?? "mixto"}" preset.`);

let installed = false;
if (!flag("--no-install")) {
  say("Instalando dependencias (npm install)…", "Installing dependencies (npm install)…");
  installed = npm(["install", "--no-audit", "--no-fund"], target).status === 0;
  if (!installed) say("• `npm install` falló: corrélo a mano dentro de la carpeta.", "• `npm install` failed: run it by hand inside the folder.");
}

if (!flag("--no-git") && run("git", ["init", "-q"], target).status === 0) {
  run("git", ["add", "-A"], target);
  // The first commit needs an identity; without one the repository is simply left ready.
  run("git", ["commit", "-q", "-m", "Start from Cerebro Web"], target);
  say("✓ Repositorio git nuevo.", "✓ Fresh git repository.");
}

// From here on the store exists: a later problem does not delete it.
cleanup = () => {};
const cd = /^[A-Za-z0-9._\/-]+$/.test(name) ? `cd ${name}` : `cd "${name}"`;
say(
  `\nListo. Lo que sigue:\n\n  ${cd}${installed ? "" : "\n  npm install"}\n  npm run dev            # la tienda en http://localhost:3000 y el panel en /admin\n  npm run doctor         # qué está listo y cuál es el próximo paso\n\nSi trabajás con un agente de IA, decile: «Adaptá esto a mi negocio siguiendo el cerebro».\nÉl empieza por AGENTS.es.md y GETTING-STARTED.es.md. Para salir a vender: docs/go-live.es.md.\nTodo lo que trae el preset es de EJEMPLO: reemplazalo por los datos reales del negocio.\n`,
  `\nDone. Next:\n\n  ${cd}${installed ? "" : "\n  npm install"}\n  npm run dev            # the store at http://localhost:3000 and the admin panel at /admin\n  npm run doctor         # what is ready and which step comes next\n\nIf you work with an AI agent, tell it: "Adapt this to my business following the brain".\nIt starts with AGENTS.md and GETTING-STARTED.md. To go live: docs/go-live.md.\nEverything in the preset is an EXAMPLE: replace it with the real data of the business.\n`,
);
