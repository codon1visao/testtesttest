import { describe, expect, it } from "vitest";
import { BriefingContentSchema, BriefingTextEditsSchema } from "./briefing-content.js";

const content = {
  attendanceOverview:
    "4 registered members: 1 attended, 2 absent, 1 not recorded (attendance is incomplete).",
  feedbackSummary: { text: "Feedback describes the walk as enjoyable.", sourceIds: ["F01"] },
  themes: [{ text: "Requests for more rest-break time.", sourceIds: ["F05", "F06"] }],
  conflicts: [],
  suggestions: [{ text: "Consider reviewing route length.", sourceIds: ["F07"] }],
};

describe("BriefingContentSchema", () => {
  it("accepts the stored shape", () => {
    expect(BriefingContentSchema.safeParse(content).success).toBe(true);
  });

  it("rejects unknown sections and write-like fields", () => {
    expect(BriefingContentSchema.safeParse({ ...content, actions: [] }).success).toBe(false);
  });
});

describe("BriefingTextEditsSchema (D2: text only)", () => {
  const edits = {
    attendanceOverview: "Overview",
    feedbackSummary: "Summary",
    themes: ["Rest breaks"],
    conflicts: [],
    suggestions: ["Route"],
  };

  it("accepts text arrays", () => {
    expect(BriefingTextEditsSchema.safeParse(edits).success).toBe(true);
  });

  it("rejects evidence objects or source IDs in place of text (F5-03)", () => {
    const withSources = { ...edits, themes: [{ text: "Rest breaks", sourceIds: ["F05", "F06"] }] };
    expect(BriefingTextEditsSchema.safeParse(withSources).success).toBe(false);
  });

  it("rejects blank item text and unknown sections (F5-04)", () => {
    expect(BriefingTextEditsSchema.safeParse({ ...edits, themes: ["   "] }).success).toBe(false);
    expect(BriefingTextEditsSchema.safeParse({ ...edits, notes: [] }).success).toBe(false);
  });
});
