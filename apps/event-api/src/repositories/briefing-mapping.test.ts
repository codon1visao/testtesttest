import { describe, expect, it } from "vitest";
import type {
  BriefingItemRow,
  BriefingItemSection,
  BriefingItemSourceRow,
} from "../persistence/entities/generation.entities.js";
import { assembleStoredBriefing, type GenerationRecord } from "./briefing-mapping.js";

const GEN = "0199a4e8-7c1a-7cc2-9d6e-2f3b4c5d6e7f";
const AT = new Date("2026-10-03T09:00:00.000Z");

const item = (
  id: string,
  section: BriefingItemSection,
  position: number,
  text: string,
): BriefingItemRow => ({
  id,
  generationId: GEN,
  section,
  position,
  text,
});
const source = (itemId: string, feedbackId: string, position: number): BriefingItemSourceRow => ({
  itemId,
  generationId: GEN,
  feedbackId,
  position,
});

function record(overrides: Partial<GenerationRecord> = {}): GenerationRecord {
  return {
    generation: {
      id: GEN,
      eventId: "E101",
      runId: "manual:fixture",
      triggerType: "manual",
      model: "fixture-model",
      promptVersion: "briefing-v1",
      attendanceOverview:
        "4 registered members: 1 attended, 2 absent, 1 not recorded (attendance is incomplete).",
      feedbackDigest: "a".repeat(64),
      inputCapturedAt: AT,
      generatedAt: AT,
    },
    attendanceInputs: [
      { generationId: GEN, eventId: "E101", memberId: "M02", attendance: "absent" },
      { generationId: GEN, eventId: "E101", memberId: "M01", attendance: "attended" },
      { generationId: GEN, eventId: "E101", memberId: "M04", attendance: "absent" },
      { generationId: GEN, eventId: "E101", memberId: "M03", attendance: "not_recorded" },
    ],
    feedbackInputs: ["F10", "F09", "F02", "F01"].map((feedbackId) => ({
      generationId: GEN,
      eventId: "E101",
      feedbackId,
    })),
    items: [
      item("i-suggest", "suggestion", 0, "Consider reviewing the route length."),
      item("i-theme-1", "theme", 1, "Second theme."),
      item("i-summary", "summary", 0, "Summary."),
      item("i-theme-0", "theme", 0, "First theme."),
    ],
    sources: [
      source("i-summary", "F02", 1),
      source("i-summary", "F01", 0),
      source("i-theme-0", "F01", 0),
      source("i-theme-0", "F02", 1),
      source("i-theme-1", "F09", 0),
      source("i-theme-1", "F10", 1),
      source("i-suggest", "F10", 0),
    ],
    ...overrides,
  };
}

describe("assembleStoredBriefing", () => {
  it("orders sections and citations and derives the captured counts (T4 §5)", () => {
    const briefing = assembleStoredBriefing(record());
    expect(briefing.content).toEqual({
      attendanceOverview:
        "4 registered members: 1 attended, 2 absent, 1 not recorded (attendance is incomplete).",
      feedbackSummary: { text: "Summary.", sourceIds: ["F01", "F02"] },
      themes: [
        { text: "First theme.", sourceIds: ["F01", "F02"] },
        { text: "Second theme.", sourceIds: ["F09", "F10"] },
      ],
      conflicts: [],
      suggestions: [{ text: "Consider reviewing the route length.", sourceIds: ["F10"] }],
    });
    expect(briefing.provenance.input.attendance.map((a) => a.memberId)).toEqual([
      "M01",
      "M02",
      "M03",
      "M04",
    ]);
    expect(briefing.provenance.input.counts).toEqual({
      registered: 4,
      attended: 1,
      absent: 2,
      notRecorded: 1,
    });
    expect(briefing.provenance.input.feedbackIds).toEqual(["F01", "F02", "F09", "F10"]);
    expect(briefing.provenance.generatedAt).toBe("2026-10-03T09:00:00.000Z");
    expect(briefing.trigger).toBe("manual");
    expect(briefing.savedAt).toBeUndefined();
  });

  it("uses saved wording and overview but keeps the generated references (D2)", () => {
    const briefing = assembleStoredBriefing(record(), {
      attendanceOverview: "Edited overview.",
      savedAt: AT,
      itemTexts: new Map([
        ["i-summary", "Edited summary."],
        ["i-theme-0", "Edited first."],
        ["i-theme-1", "Edited second."],
        ["i-suggest", "Edited suggestion."],
      ]),
    });
    expect(briefing.content.attendanceOverview).toBe("Edited overview.");
    expect(briefing.content.feedbackSummary).toEqual({
      text: "Edited summary.",
      sourceIds: ["F01", "F02"],
    });
    expect(briefing.content.themes[1]).toEqual({
      text: "Edited second.",
      sourceIds: ["F09", "F10"],
    });
    expect(briefing.savedAt).toBe("2026-10-03T09:00:00.000Z");
  });

  it("reports a saved briefing with a missing item text as STORE_CORRUPT", () => {
    expect(() =>
      assembleStoredBriefing(record(), {
        attendanceOverview: "x",
        savedAt: AT,
        itemTexts: new Map(),
      }),
    ).toThrow(expect.objectContaining({ code: "STORE_CORRUPT" }));
  });

  it("requires exactly one feedback summary", () => {
    const noSummary = record({ items: record().items.filter((i) => i.section !== "summary") });
    expect(() => assembleStoredBriefing(noSummary)).toThrow(
      expect.objectContaining({ code: "STORE_CORRUPT" }),
    );
  });

  it("rejects stored IDs that are not exact feedback IDs", () => {
    const lowercase = record({ sources: [...record().sources, source("i-suggest", "f01", 1)] });
    expect(() => assembleStoredBriefing(lowercase)).toThrow(
      expect.objectContaining({ code: "STORE_CORRUPT" }),
    );
  });
});
