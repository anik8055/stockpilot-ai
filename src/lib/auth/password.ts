import { hash, verify } from "@node-rs/argon2";
import { z } from "zod";

// argon2id with OWASP-recommended baseline parameters (19 MiB, t=2, p=1).
const OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1, outputLen: 32 } as const;

export const passwordSchema = z
  .string()
  .min(10, "Use at least 10 characters")
  .max(200, "Password is too long")
  .refine((v) => /[a-zA-Z]/.test(v) && /[0-9]/.test(v), "Include at least one letter and one number");

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

// Used to keep login timing similar for unknown emails.
let dummyHash: Promise<string> | undefined;
export function dummyVerify(password: string) {
  dummyHash ??= hashPassword("dummy-password-for-timing-1");
  return dummyHash.then((h) => verifyPassword(h, password));
}
