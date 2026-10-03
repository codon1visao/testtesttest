import { GenerationIdSchema } from "@event-desk/contracts";
import { buildBriefingView, buildSeedEventView } from "@event-desk/contracts/testing";
import { describe, expect, it } from "vitest";
import {
  draftMatchesSaved,
  editorKey,
  formFieldForApiField,
  toEditorBase,
  toFormValues,
  toSaveRequest,
} from "./briefing-form-model";

const briefing = buildBriefingView();
const ID = briefing.provenance.generationId;

describe("briefing form model (D2)", () => {
  it("F5-03: the save request carries wording only, one entry per stored item", () => {
    const request = toSaveRequest(toFormValues(briefing.content), ID, 3);
    expect(request).toEqual({
      baseBriefingRevision: 3,
      generationId: ID,
      textEdits: {
        attendanceOverview: briefing.content.attendanceOverview,
        feedbackSummary: briefing.content.feedbackSummary.text,
        themes: ["Requests for more rest-break time."],
        conflicts: briefing.content.conflicts.map((item) => item.text),
        suggestions: briefing.content.suggestions.map((item) => item.text),
      },
    });
    expect(JSON.stringify(request)).not.toContain("sourceIds");
  });

  it("maps API fields to form fields", () => {
    expect(formFieldForApiField("textEdits.conflicts.1")).toBe("conflicts.1.text");
    expect(formFieldForApiField("textEdits.feedbackSummary")).toBe("feedbackSummary");
    expect(formFieldForApiField("textEdits.attendanceOverview")).toBe("attendanceOverview");
    expect(formFieldForApiField("textEdits.themes")).toBeNull();
    expect(formFieldForApiField(undefined)).toBeNull();
  });

  it("F5 lost response: matches only the same generation with identical wording", () => {
    const values = toFormValues(briefing.content);
    const saved = { ...briefing, savedAt: "2026-10-04T10:00:00.000Z" };
    expect(draftMatchesSaved(values, ID, saved)).toBe(true);
    expect(draftMatchesSaved({ ...values, feedbackSummary: "Other." }, ID, saved)).toBe(false);
    expect(
      draftMatchesSaved(
        values,
        GenerationIdSchema.parse("0199a4e8-7c1a-7cc2-9d6e-000000000009"),
        saved,
      ),
    ).toBe(false);
    expect(draftMatchesSaved(values, ID, null)).toBe(false);
  });

  it("T3 §11: the editor key is slot, generation and revision", () => {
    const base = toEditorBase(
      buildSeedEventView({ selectedPreview: briefing, briefingRevision: 2 }),
      "preview",
    );
    expect(editorKey(base)).toBe(`selected:${ID}:2`);
    expect(editorKey(toEditorBase(buildSeedEventView(), "preview"))).toBe("none");
  });
});
