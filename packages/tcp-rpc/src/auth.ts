import { createHash, timingSafeEqual } from "node:crypto";

const digest = (value: string) => createHash("sha256").update(value, "utf8").digest();

/** Constant-time comparison over SHA-256 digests, so lengths leak nothing either (F8, T3 §9). */
export function secretsMatch(provided: unknown, expected: string): boolean {
  if (typeof provided !== "string") return false;
  return timingSafeEqual(digest(provided), digest(expected));
}
