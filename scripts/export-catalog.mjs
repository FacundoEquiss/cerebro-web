#!/usr/bin/env node
// With the `json` data adapter, products edited in the local admin panel are saved to
// DATA_DIR/catalog.json (never committed). This copies that catalogue back to
// content/products.json, the file that ships with the site:
//
//   npm run data:export
//
// Review the diff and commit it. (With a database adapter there is nothing to export.)
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(resolve(root, process.env.DATA_DIR || ".data"), "catalog.json");
if (!existsSync(source)) {
  console.log(`• Nothing to export: ${source} does not exist (no product was edited locally).`);
  process.exit(0);
}
const catalog = JSON.parse(readFileSync(source, "utf8"));
const target = join(root, "content/products.json");
const previous = JSON.parse(readFileSync(target, "utf8"));
writeFileSync(target, `${JSON.stringify({ _note: previous._note, categories: catalog.categories, products: catalog.products }, null, 2)}\n`);
console.log(`✓ content/products.json updated with ${catalog.products.length} products. Review the diff and commit it.`);
