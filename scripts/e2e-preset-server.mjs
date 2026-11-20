#!/usr/bin/env node
// For the end-to-end test "apply a preset and the store changes": runs the REAL command
// (`node scripts/preset.mjs <name>`) on a throwaway copy of the project, builds that copy and
// serves it. The working tree is never touched.
//
//   PRESET=servicios PRESET_PORT=3101 node scripts/e2e-preset-server.mjs
import { execFileSync, spawn } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const preset = process.env.PRESET ?? "servicios";
const port = process.env.PRESET_PORT ?? "3101";
const copy = mkdtempSync(join(tmpdir(), `preset-${preset}-`));
const SKIP = new Set(["node_modules", ".next", ".next-fixtures", ".git", ".data", "test-results", "playwright-report", "screenshots", ".vercel", ".preset-backups"]);

cpSync(root, copy, { recursive: true, filter: (source) => !SKIP.has(source.slice(root.length + 1).split(/[\\/]/)[0] ?? "") });
// The dependencies: hard links when the disk allows it (instant), a link to the folder otherwise.
try {
  execFileSync("cp", ["-al", join(root, "node_modules"), join(copy, "node_modules")], { stdio: "ignore" });
} catch {
  rmSync(join(copy, "node_modules"), { recursive: true, force: true });
  symlinkSync(join(root, "node_modules"), join(copy, "node_modules"), "dir");
}

const next = join(copy, "node_modules/next/dist/bin/next");
const env = { ...process.env, DATA_DIR: join(copy, ".data"), DATA_SOURCE: "json", PAYMENT_PROVIDER: "manual", DEMO_MODE: "false", NEXT_PUBLIC_SITE_URL: `http://localhost:${port}`, PORT: port, CEREBRO_FIXTURES: "" };
const run = (args) => execFileSync(process.execPath, args, { cwd: copy, stdio: "inherit", env });

// --force: the store this runs in may already have a catalogue of its own (the copy is thrown away).
run([join(copy, "scripts/preset.mjs"), preset, "--force"]);
run([next, "build"]);
if (!existsSync(join(copy, ".next"))) throw new Error("the copy did not build");

const child = spawn(process.execPath, [next, "start", "-p", port], { cwd: copy, stdio: "inherit", env });
const stop = (code) => {
  rmSync(copy, { recursive: true, force: true });
  process.exit(code ?? 0);
};
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("exit", stop);
