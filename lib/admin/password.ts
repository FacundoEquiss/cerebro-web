// ADMIN PASSWORDS. No external identity provider: a password is stored as a scrypt hash
// (`node:crypto`, memory-hard) in the ADMIN_USERS variable, never in plain text.
//
//   npm run admin:hash          → asks for the password and prints the line for ADMIN_USERS
//
// Format: `scrypt.<salt>.<hash>`, both base64url. No `$` on purpose: `.env` loaders expand it.
// scrypt is slow by design, so it runs on the thread pool (async): it never blocks the server.

import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const KEY_LENGTH = 64;
const OPTIONS = { N: 16384, r: 8, p: 1 };

function derive(password: string, salt: Buffer, length: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password.normalize("NFKC"), salt, length, OPTIONS, (error, key) => (error ? reject(error) : resolve(key)));
  });
}

export async function hashPassword(password: string, salt: Buffer = randomBytes(16)): Promise<string> {
  const hash = await derive(password, salt, KEY_LENGTH);
  return `scrypt.${salt.toString("base64url")}.${hash.toString("base64url")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, salt, hash, ...rest] = stored.split(".");
  if (scheme !== "scrypt" || !salt || !hash || rest.length > 0) return false;
  try {
    const expected = Buffer.from(hash, "base64url");
    if (expected.length === 0) return false;
    const given = await derive(password, Buffer.from(salt, "base64url"), expected.length);
    return expected.length === given.length && timingSafeEqual(expected, given);
  } catch {
    return false;
  }
}
