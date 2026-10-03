import { FeedbackIdSchema } from "@event-desk/contracts";
import { describe, expect, it } from "vitest";
import { buildAttendanceOverview } from "./attendance-overview.js";
import { toGenerationItems } from "./generation-items.js";
import { decideIncoming } from "./incoming-slot-rules.js";

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
