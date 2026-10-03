import { FeedbackIdSchema, RunIdSchema } from "@event-desk/contracts";
import { describe, expect, it } from "vitest";
import { batchFailureText, batchStateText } from "./batch-status-text";

const clock = (iso: string) => iso.slice(11, 19);
const batch = (overrides = {}) => ({
  state: "collecting" as const,
  jobId: RunIdSchema.parse("batch_a"),
  closesAt: "2026-10-04T14:02:03.000Z",
  maxAttempts: 3,
  newNoteIds: ["F09", "F10", "F11"].map((id) => FeedbackIdSchema.parse(id)),
  ...overrides,
});

describe("batch state text (F7 table, verbatim)", () => {
  it.each([
    [batch(), "New feedback received (3 notes). Preparing an automatic briefing at 14:02:03."],
    [
      batch({ newNoteIds: [FeedbackIdSchema.parse("F09")] }),
      "New feedback received (1 note). Preparing an automatic briefing at 14:02:03.",
    ],
    [
      batch({ state: "waiting" }),
      "Automatic briefing queued; waiting for the current generation to finish.",
    ],
    [batch({ state: "generating" }), "Generating automatic briefing…"],
    [
      batch({ state: "retry_wait", nextAttemptAt: "2026-10-04T14:02:40.000Z", attempt: 2 }),
      "Automatic briefing will retry at 14:02:40 (attempt 2 of 3).",
    ],
    [batch({ state: "retry_wait" }), "Automatic briefing will retry shortly."],
    [
      batch({ state: "retry_wait", nextAttemptAt: "2026-10-04T14:02:40.000Z" }),
      "Automatic briefing will retry at 14:02:40.",
    ],
  ])("%#", (value, text) => {
    expect(batchStateText(value, clock)).toBe(text);
  });

  it("words failures for the coordinator", () => {
    expect(batchFailureText("GATEWAY_UNAVAILABLE")).toBe(
      "Automatic briefing failed: AI service unavailable. Your saved briefing is unchanged.",
    );
    expect(batchFailureText("ATTEMPTS_EXHAUSTED")).toBe(
      "Automatic briefing failed: AI service unavailable. Your saved briefing is unchanged.",
    );
    expect(batchFailureText("DAILY_LIMIT_REACHED")).toBe(
      "Automatic briefing failed: today's automatic generation limit is reached. Your saved briefing is unchanged.",
    );
    expect(batchFailureText(undefined)).toBe(
      "Automatic briefing failed: an unexpected error. Your saved briefing is unchanged.",
    );
  });
});
