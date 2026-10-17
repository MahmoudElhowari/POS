import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb) as (pin: string, salt: Buffer, len: number) => Promise<Buffer>;

export const PIN_PATTERN = /^\d{4,6}$/;

/** Staff PINs are stored as `scrypt$<salt>$<hash>`, never in plain text. */
export async function hashPin(pin: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(pin, salt, 32);
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export async function verifyPin(pin: string, stored: string): Promise<boolean> {
  const [scheme, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64");
  const actual = await scrypt(pin, Buffer.from(salt, "base64"), expected.length);
  return timingSafeEqual(actual, expected);
}
