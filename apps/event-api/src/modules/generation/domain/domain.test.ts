import { FeedbackIdSchema, MemberIdSchema } from "@event-desk/contracts";
import { describe, expect, it } from "vitest";
import { buildAttendanceOverview } from "./attendance-overview.js";
import {
  attemptDeadline,
  isRetryableGatewayFailure,
  nextRetryDelayMs,
} from "./batch-retry-policy.js";
import { toGenerationItems } from "./generation-items.js";
import { decideIncoming } from "./incoming-slot-rules.js";
import { sameInput } from "./same-input.js";

const ids = (...values: string[]) => values.map((value) => FeedbackIdSchema.parse(value));

describe("buildAttendanceOverview (F4, F4-02, F4-18)", () => {
  it("states the seed counts and flags incomplete attendance", () => {
    expect(buildAttendanceOverview({ registered: 4, attended: 1, absent: 2, notRecorded: 1 })).toBe(
      "4 registered members: 1 attended, 2 absent, 1 not recorded (attendance is incomplete).",
    );
  });

  it("omits the clause when every member is recorded, and uses the singular for one member", () => {
    expect(buildAttendanceOverview({ registered: 4, attended: 2, absent: 2, notRecorded: 0 })).toBe(
      "4 registered members: 2 attended, 2 absent, 0 not recorded.",
    );
    expect(buildAttendanceOverview({ registered: 1, attended: 1, absent: 0, notRecorded: 0 })).toBe(
      "1 registered member: 1 attended, 0 absent, 0 not recorded.",
    );
  });
});

describe("decideIncoming (F7 'Who may replace the incoming preview')", () => {
  const at = (iso: string) => new Date(iso);
  const manual = (iso: string) => ({ trigger: "manual" as const, inputCapturedAt: at(iso) });
  const batch = (iso: string) => ({ trigger: "feedback_batch" as const, inputCapturedAt: at(iso) });

  it.each([
    ["an empty slot takes any result", null, batch("2026-10-04T10:00:00Z"), { kind: "replace" }],
    [
      "a manual result replaces an automatic one",
      batch("2026-10-04T10:00:00Z"),
      manual("2026-10-04T10:01:00Z"),
      { kind: "replace" },
    ],
    [
      "a later automatic result replaces an automatic one",
      batch("2026-10-04T10:00:00Z"),
      batch("2026-10-04T10:01:00Z"),
      { kind: "replace" },
    ],
    [
      "a later manual result replaces a manual one",
      manual("2026-10-04T10:00:00Z"),
      manual("2026-10-04T10:01:00Z"),
      { kind: "replace" },
    ],
    [
      "an automatic result never replaces an unreviewed manual one",
      manual("2026-10-04T10:00:00Z"),
      batch("2026-10-04T10:05:00Z"),
      { kind: "keep", outcome: "superseded_by_manual" },
    ],
    [
      "a result that read data earlier never replaces",
      manual("2026-10-04T10:01:00Z"),
      manual("2026-10-04T10:00:00Z"),
      { kind: "keep", outcome: "superseded" },
    ],
    [
      "an earlier automatic result never replaces an automatic one",
      batch("2026-10-04T10:01:00Z"),
      batch("2026-10-04T10:00:00Z"),
      { kind: "keep", outcome: "superseded" },
    ],
  ] as const)("%s", (_name, current, candidate, expected) => {
    expect(decideIncoming(current, candidate)).toEqual(expected);
  });
});

describe("toGenerationItems", () => {
  it("numbers items per section from 0 and keeps citation order", () => {
    let n = 0;
    const items = toGenerationItems(
      {
        feedbackSummary: { text: "Summary.", sourceIds: ids("F02", "F01") },
        themes: [{ text: "Rest breaks.", sourceIds: ids("F05", "F06") }],
        conflicts: [
          { text: "Start time.", sourceIds: ids("F03", "F04") },
          { text: "Meeting point.", sourceIds: ids("F01", "F02") },
        ],
        suggestions: [],
      },
      () => `item-${(n += 1)}`,
    );
    expect(items).toEqual([
      {
        id: "item-1",
        section: "summary",
        position: 0,
        text: "Summary.",
        sourceIds: ["F02", "F01"],
      },
      {
        id: "item-2",
        section: "theme",
        position: 0,
        text: "Rest breaks.",
        sourceIds: ["F05", "F06"],
      },
      {
        id: "item-3",
        section: "conflict",
        position: 0,
        text: "Start time.",
        sourceIds: ["F03", "F04"],
      },
      {
        id: "item-4",
        section: "conflict",
        position: 1,
        text: "Meeting point.",
        sourceIds: ["F01", "F02"],
      },
    ]);
  });
});

describe("decideIncoming edges (Plan 3B carry-forward)", () => {
  const at = new Date("2026-10-04T10:00:00Z");
  it("equal capture times: the later commit replaces (it read at least the same data)", () => {
    expect(
      decideIncoming(
        { trigger: "feedback_batch", inputCapturedAt: at },
        { trigger: "feedback_batch", inputCapturedAt: at },
      ),
    ).toEqual({ kind: "replace" });
    expect(
      decideIncoming(
        { trigger: "feedback_batch", inputCapturedAt: at },
        { trigger: "manual", inputCapturedAt: at },
      ),
    ).toEqual({ kind: "replace" });
  });
  it("an older automatic result never replaces a newer manual one", () => {
    expect(
      decideIncoming(
        { trigger: "manual", inputCapturedAt: at },
        { trigger: "feedback_batch", inputCapturedAt: new Date(at.getTime() - 1) },
      ),
    ).toEqual({ kind: "keep", outcome: "superseded" });
  });
});

describe("sameInput (F7 rule 6)", () => {
  const m = (id: string, attendance: "attended" | "absent" | "not_recorded") => ({
    memberId: MemberIdSchema.parse(id),
    attendance,
  });
  const base = {
    attendance: [m("M01", "attended"), m("M02", "absent")],
    feedbackIds: ids("F01", "F02"),
  };
  it("ignores order", () => {
    expect(
      sameInput(base, {
        attendance: [m("M02", "absent"), m("M01", "attended")],
        feedbackIds: ids("F02", "F01"),
      }),
    ).toBe(true);
  });
  it("differs on any status, any note, or a different roster", () => {
    expect(sameInput(base, { ...base, attendance: [m("M01", "absent"), m("M02", "absent")] })).toBe(
      false,
    );
    expect(sameInput(base, { ...base, feedbackIds: ids("F01", "F02", "F09") })).toBe(false);
    expect(sameInput(base, { ...base, attendance: [m("M01", "attended")] })).toBe(false);
  });
});

describe("isRetryableGatewayFailure (F7 'Failures, retries', F8)", () => {
  it.each([
    ["PROVIDER_TEMPORARY", false, true],
    ["PROVIDER_RATE_LIMITED", false, true],
    ["GATEWAY_UNAVAILABLE", true, true],
    ["GATEWAY_UNAVAILABLE", false, false],
    ["DEADLINE_EXCEEDED", true, true],
    ["DEADLINE_EXCEEDED", false, false],
    ["AI_OUTCOME_UNKNOWN", false, false],
    ["GATEWAY_AUTH_FAILED", true, false],
    ["PROVIDER_NOT_CONFIGURED", true, false],
    ["PROVIDER_REFUSED", false, false],
    ["OUTPUT_INVALID", false, false],
    ["OUTPUT_INCOMPLETE", false, false],
    ["DAILY_LIMIT_REACHED", true, false],
    ["VALIDATION_FAILED", true, false],
    ["INTERNAL", false, false],
  ] as const)("%s (notSent %s) → retryable %s", (code, notSent, expected) => {
    expect(isRetryableGatewayFailure(code, notSent)).toBe(expected);
  });
});

describe("nextRetryDelayMs (F7: 3 attempts, 5 minutes, backoff with jitter, cooldown honoured)", () => {
  const base = { attempt: 1, maxAttempts: 3, now: 0, executionDeadline: 300_000, random: 0.5 };
  it("backs off exponentially with ±20% jitter", () => {
    expect(nextRetryDelayMs(base)).toBe(2_000);
    expect(nextRetryDelayMs({ ...base, attempt: 2 })).toBe(4_000);
    expect(nextRetryDelayMs({ ...base, random: 0 })).toBe(1_600);
    expect(nextRetryDelayMs({ ...base, random: 0.999_999 })).toBe(2_400);
  });
  it("waits at least the provider's retry-after and the cooldown", () => {
    expect(nextRetryDelayMs({ ...base, retryAfterMs: 30_000 })).toBe(30_000);
    expect(nextRetryDelayMs({ ...base, cooldownRemainingMs: 45_000 })).toBe(45_000);
  });
  it("stops after the last attempt or when the wait would pass the deadline", () => {
    expect(nextRetryDelayMs({ ...base, attempt: 3 })).toBeNull();
    expect(nextRetryDelayMs({ ...base, now: 299_000 })).toBeNull();
  });
  it("caps one attempt's deadline at the execution deadline", () => {
    expect(attemptDeadline(0, 300_000)).toEqual(new Date(60_000));
    expect(attemptDeadline(280_000, 300_000)).toEqual(new Date(300_000));
  });
});
