import { GenerationIdSchema, RunIdSchema } from "@event-desk/contracts";
import { describe, expect, it } from "vitest";
import { uuidV7, uuidV7IdGenerator } from "./uuid-v7-id-generator.js";

describe("uuidV7", () => {
  it("encodes the millisecond timestamp, version 7 and the RFC 9562 variant", () => {
    const id = uuidV7(0x0199a4e87c1a, Buffer.alloc(10, 0xff));
    expect(id).toBe("0199a4e8-7c1a-7fff-bfff-ffffffffffff");
  });

  it("sorts by creation time and matches the contracts' GenerationId", () => {
    const earlier = uuidV7(1_000);
    const later = uuidV7(2_000);
    expect(earlier < later).toBe(true);
    expect(GenerationIdSchema.safeParse(uuidV7()).success).toBe(true);
  });

  it("produces manual run IDs and item IDs", () => {
    expect(uuidV7IdGenerator.manualRunId()).toMatch(/^manual:[0-9a-f-]{36}$/);
    expect(RunIdSchema.safeParse(uuidV7IdGenerator.manualRunId()).success).toBe(true);
    expect(uuidV7IdGenerator.itemId()).not.toBe(uuidV7IdGenerator.itemId());
  });

  it("produces batch run IDs that are valid BullMQ custom job IDs (no ':')", () => {
    expect(uuidV7IdGenerator.batchRunId()).toMatch(/^batch_[0-9a-f-]{36}$/);
    expect(RunIdSchema.safeParse(uuidV7IdGenerator.batchRunId()).success).toBe(true);
  });
});
