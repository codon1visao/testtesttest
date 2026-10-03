import { randomBytes } from "node:crypto";
import { GenerationIdSchema, RunIdSchema } from "@event-desk/contracts";
import type { IdGenerator } from "../ports/id-generator.js";

/**
 * RFC 9562 UUIDv7: 48-bit Unix milliseconds, version 7, variant 0b10, 74 random bits. Lowercase,
 * as the ascii_bin columns require. Time-ordered, so new generation rows append to the index.
 */
export function uuidV7(nowMs: number = Date.now(), random: Buffer = randomBytes(10)): string {
  const bytes = Buffer.alloc(16);
  bytes.writeUIntBE(nowMs, 0, 6);
  random.copy(bytes, 6, 0, 10);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export const uuidV7IdGenerator: IdGenerator = {
  generationId: () => GenerationIdSchema.parse(uuidV7()),
  itemId: () => uuidV7(),
  manualRunId: () => RunIdSchema.parse(`manual:${uuidV7()}`),
  batchRunId: () => RunIdSchema.parse(`batch_${uuidV7()}`),
};
