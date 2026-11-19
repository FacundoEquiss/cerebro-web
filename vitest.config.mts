import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // The SQL tests start an in-process PostgreSQL: give them room.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
