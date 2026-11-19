#!/usr/bin/env node
// Creates the line for the ADMIN_USERS variable: an e-mail plus the scrypt hash of a password.
// The password is never stored or printed.
//
//   npm run admin:hash                         → asks for e-mail and password
//   npm run admin:hash -- you@example.com      → asks only for the password
//   echo "the password" | npm run admin:hash -- you@example.com     (for scripts)
//
// Same algorithm and format as lib/admin/password.ts: scrypt.<salt>.<hash> (base64url).
import { randomBytes, scryptSync } from "node:crypto";
import { createInterface } from "node:readline";

const KEY_LENGTH = 64;
const OPTIONS = { N: 16384, r: 8, p: 1 };

export function hashPassword(password, salt = randomBytes(16)) {
  const hash = scryptSync(password.normalize("NFKC"), salt, KEY_LENGTH, OPTIONS);
  return `scrypt.${salt.toString("base64url")}.${hash.toString("base64url")}`;
}

function ask(question, hidden = false) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY });
    if (hidden && process.stdin.isTTY) {
      // Do not echo the password while it is typed.
      rl._writeToOutput = (text) => rl.output.write(text.includes(question) ? text : "");
    }
    rl.question(question, (answer) => {
      rl.close();
      if (hidden && process.stdin.isTTY) process.stdout.write("\n");
      resolve(answer.trim());
    });
  });
}

if (process.argv[1]?.endsWith("admin-hash.mjs")) {
  const email = (process.argv[2] ?? (await ask("Admin e-mail: "))).trim().toLowerCase();
  if (!/^[^@\s:,]+@[^@\s:,]+$/.test(email)) {
    console.error("✗ That does not look like an e-mail address.");
    process.exit(1);
  }
  const password = await ask("Password (8+ characters): ", true);
  if (password.length < 8) {
    console.error("✗ Use at least 8 characters.");
    process.exit(1);
  }
  console.log("\nAdd this to ADMIN_USERS (several users: separate them with commas):\n");
  console.log(`${email}:${hashPassword(password)}`);
  console.log("\nAlso set ADMIN_SESSION_SECRET to 32+ random characters, for example:\n");
  console.log(randomBytes(32).toString("base64url"));
}
