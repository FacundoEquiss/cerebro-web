#!/usr/bin/env node
// Starts the built site for the end-to-end tests (and for `npm run screenshots`):
//   · an EMPTY data folder (.data/e2e), so every run starts from the demo catalogue;
//   · the `json` adapter in local mode (it writes to that folder);
//   · one real admin (admin@example.com / the password below) plus the read-only demo user.
// The password is hashed here, on every start: no hash and no secret live in the repository.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { hashPassword } from "./admin-hash.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
/** The test admin (a local, throwaway account): e2e/admin-user.json. */
export const E2E_ADMIN = JSON.parse(readFileSync(join(root, "e2e/admin-user.json"), "utf8"));
const port = process.env.PORT ?? "3100";
const dataDir = join(root, ".data", "e2e");

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const base = Number(port);
  const next = join(root, "node_modules/next/dist/bin/next");
  // With CEREBRO_FIXTURES=1 the store is the one of tests/fixtures. Its images are served from
  // public/fixtures/ (a copy made here, ignored by git, removed on the way out).
  const fixtures = process.env.CEREBRO_FIXTURES === "1";
  const fixtureImages = join(root, "public", "fixtures");
  if (fixtures) {
    rmSync(fixtureImages, { recursive: true, force: true });
    cpSync(join(root, "tests/fixtures/public"), fixtureImages, { recursive: true });
  }
  // --build: a fresh production build first (the fixtures build goes to .next-fixtures).
  if (process.argv.includes("--build")) execFileSync(process.execPath, [next, "build"], { cwd: root, stdio: "inherit", env: process.env });
  else if (fixtures && !existsSync(join(root, ".next-fixtures"))) throw new Error("no fixtures build yet: run this with --build");
  const admin = { ADMIN_USERS: `${E2E_ADMIN.email}:${hashPassword(E2E_ADMIN.password)}`, ADMIN_SESSION_SECRET: randomBytes(32).toString("base64url") };
  // THREE servers on the SAME build:
  //   port      the store with a data folder that works (orders are stored);
  //   port + 2  json that stores NOTHING, in demo mode — what the published demo is;
  //   port + 3  json that stores nothing, as a REAL store — bookings and quotes must be refused.
  const servers = [
    { port: base, dir: dataDir, env: { DEMO_MODE: "true" } },
    { port: base + 2, dir: join(root, ".data", "e2e-demo"), env: { DEMO_MODE: "true", JSON_READ_ONLY: "1" } },
    { port: base + 3, dir: join(root, ".data", "e2e-no-store"), env: { DEMO_MODE: "false", JSON_READ_ONLY: "1" } },
  ];
  const children = servers.map((server) => {
    rmSync(server.dir, { recursive: true, force: true });
    return spawn(process.execPath, [next, "start", "-p", String(server.port)], {
      cwd: root,
      stdio: "inherit",
      env: {
        ...process.env,
        DATA_DIR: server.dir,
        DATA_SOURCE: "json",
        PAYMENT_PROVIDER: "manual",
        ...admin,
        NEXT_PUBLIC_SITE_URL: `http://localhost:${server.port}`,
        // Each test announces itself as a different visitor (e2e/helpers.ts): the rate limits stay
        // on, and one test cannot use up another's allowance.
        TRUSTED_PROXY_HEADER: "x-e2e-client",
        ...server.env,
      },
    });
  });
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
      if (fixtures) rmSync(fixtureImages, { recursive: true, force: true });
      children.forEach((c) => c.kill(signal));
    });
  }
  children[0].on("exit", (code) => {
    children.forEach((c) => c.kill());
    if (fixtures) rmSync(fixtureImages, { recursive: true, force: true });
    process.exit(code ?? 0);
  });
}
