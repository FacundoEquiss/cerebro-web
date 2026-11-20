import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  // The tests run against their OWN store (tests/fixtures): the catalogue, the home texts, the
  // brand and the commercial rules of the owner are never read, so they can be anything.
  resolve: {
    alias: [
      { find: /^@\/config\/(brand|commerce)$/, replacement: `${root}tests/fixtures/config/$1.ts` },
      { find: /^@\/content\/(products|site)\.json$/, replacement: `${root}tests/fixtures/$1.json` },
      { find: /^@\//, replacement: root },
    ],
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // The sample files of the digital products come from tests/fixtures/downloads (lib/storage).
    env: { CEREBRO_FIXTURES: "1" },
    // The SQL tests start an in-process PostgreSQL: give them room.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
