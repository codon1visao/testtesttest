import { type BriefingTextEdits, FeedbackIdSchema } from "@event-desk/contracts";
import { describe, expect, it } from "vitest";
import type { NewItem } from "../../generation/domain/generation-items.js";
import { applyTextEdits, type EditableStructure, sameAsSaved } from "./apply-text-edits.js";

const ids = (...raw: string[]) => raw.map((id) => FeedbackIdSchema.parse(id));
const item = (
  id: string,
  section: NewItem["section"],
  position: number,
  sources: string[],
): NewItem => ({
  id,
  section,
  position,
  text: `Generated ${id}`,
  sourceIds: ids(...sources),
});
const STRUCTURE: EditableStructure = {
  feedbackIds: ids("F01", "F02", "F03", "F04", "F05", "F06", "F07", "F08"),
  items: [
    item("summary-0", "summary", 0, ["F01", "F02"]),
    item("theme-0", "theme", 0, ["F05", "F06"]),
    item("conflict-0", "conflict", 0, ["F03", "F04"]),
    item("suggestion-0", "suggestion", 0, ["F07"]),
  ],
};
const EDITS: BriefingTextEdits = {
  attendanceOverview: "Edited overview.",
  feedbackSummary: "Edited summary.",
  themes: ["  Rest breaks, in our words.  "],
  conflicts: ["Start time."],
  suggestions: ["Route length."],
};

describe("applyTextEdits (D2: wording only)", () => {
  it("F5-01: maps each position to its stored item and keeps the text exactly as typed", () => {
    const result = applyTextEdits(STRUCTURE, EDITS);
    expect(result).toEqual({
      ok: true,
      wording: {
        attendanceOverview: "Edited overview.",
        itemTexts: new Map([
          ["summary-0", "Edited summary."],
          ["theme-0", "  Rest breaks, in our words.  "],
          ["conflict-0", "Start time."],
          ["suggestion-0", "Route length."],
        ]),
      },
    });
  });

  it.each([
    ["themes", { themes: [] }],
    ["conflicts", { conflicts: ["One.", "Two."] }],
    ["suggestions", { suggestions: [] }],
  ])(
    "F5-04: a wrong item count for %s is CONTENT_INVALID on that section",
    (section: string, patch: Partial<BriefingTextEdits>) => {
      expect(applyTextEdits(STRUCTURE, { ...EDITS, ...patch })).toMatchObject({
        ok: false,
        code: "CONTENT_INVALID",
        field: `textEdits.${section}`,
      });
    },
  );

  it("F5-04: blank text names the item", () => {
    expect(applyTextEdits(STRUCTURE, { ...EDITS, conflicts: ["   "] })).toMatchObject({
      ok: false,
      code: "CONTENT_INVALID",
      field: "textEdits.conflicts.0",
    });
    expect(applyTextEdits(STRUCTURE, { ...EDITS, attendanceOverview: " " })).toMatchObject({
      ok: false,
      field: "textEdits.attendanceOverview",
    });
  });

  it("F5-13: a stored reference outside the generation's input is REFERENCE_INVALID, never repaired", () => {
    const corrupt: EditableStructure = {
      ...STRUCTURE,
      items: STRUCTURE.items.map((i) =>
        i.section === "theme" ? { ...i, sourceIds: ids("F05", "F99") } : i,
      ),
    };
    expect(applyTextEdits(corrupt, { ...EDITS, themes: ["   "] })).toMatchObject({
      ok: false,
      code: "REFERENCE_INVALID",
      field: "textEdits.themes",
    });
  });
});

describe("sameAsSaved (F5: a no-op needs no new revision)", () => {
  const applied = applyTextEdits(STRUCTURE, EDITS);
  if (!applied.ok) throw new Error("fixture edits must apply");
  const saved = { generationId: "g1", ...applied.wording };

  it("is true only for the same generation with identical wording", () => {
    expect(sameAsSaved(saved, "g1", applied.wording)).toBe(true);
    expect(sameAsSaved(null, "g1", applied.wording)).toBe(false);
    expect(sameAsSaved(saved, "g2", applied.wording)).toBe(false);
    const changed = new Map(applied.wording.itemTexts).set("theme-0", "Rest breaks.");
    expect(sameAsSaved(saved, "g1", { ...applied.wording, itemTexts: changed })).toBe(false);
    expect(sameAsSaved(saved, "g1", { ...applied.wording, attendanceOverview: "Other." })).toBe(
      false,
    );
  });
});
