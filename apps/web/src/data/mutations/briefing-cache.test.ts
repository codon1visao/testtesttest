import { GenerationIdSchema } from "@event-desk/contracts";
import { buildBriefingView, buildSeedEventView } from "@event-desk/contracts/testing";
import { describe, expect, it } from "vitest";
import { applyBriefingSaved, applyPreviewSelected } from "./briefing-cache";

const OTHER = GenerationIdSchema.parse("0199a4e8-7c1a-7cc2-9d6e-000000000002");

describe("applyPreviewSelected", () => {
  it("moves the selected generation out of the incoming slot", () => {
    const preview = buildBriefingView();
    const next = applyPreviewSelected(buildSeedEventView({ incomingPreview: preview }), {
      selectedPreview: preview,
    });
    expect(next.selectedPreview).toEqual(preview);
    expect(next.incomingPreview).toBeNull();
  });

  it("keeps a newer incoming preview that arrived meanwhile", () => {
    const selected = buildBriefingView();
    const newer = buildBriefingView({
      provenance: { ...selected.provenance, generationId: OTHER },
    });
    const next = applyPreviewSelected(buildSeedEventView({ incomingPreview: newer }), {
      selectedPreview: selected,
    });
    expect(next.incomingPreview).toEqual(newer);
  });

  it("a late response leaves a different selection the cache already shows (the refetch decides)", () => {
    const selected = buildBriefingView();
    const elsewhere = buildBriefingView({
      provenance: { ...selected.provenance, generationId: OTHER },
    });
    const view = buildSeedEventView({ selectedPreview: elsewhere });
    expect(applyPreviewSelected(view, { selectedPreview: selected })).toBe(view);
    const empty = buildSeedEventView();
    expect(applyPreviewSelected(empty, { selectedPreview: selected })).toBe(empty);
  });

  it("re-applies a response the cache already shows as selected", () => {
    const selected = buildBriefingView();
    const next = applyPreviewSelected(buildSeedEventView({ selectedPreview: selected }), {
      selectedPreview: selected,
    });
    expect(next.selectedPreview).toEqual(selected);
  });
});

describe("applyBriefingSaved", () => {
  it("applies the saved briefing, revision and selected slot", () => {
    const saved = buildBriefingView({ savedAt: "2026-10-04T10:00:00.000Z" });
    const view = buildSeedEventView({ selectedPreview: buildBriefingView() });
    const next = applyBriefingSaved(view, {
      savedBriefing: saved,
      briefingRevision: 1,
      selectedPreview: null,
    });
    expect(next).toEqual({
      ...view,
      savedBriefing: saved,
      briefingRevision: 1,
      selectedPreview: null,
    });
  });

  it("F6 race 4: an older response never rolls the revision back", () => {
    const view = buildSeedEventView({ briefingRevision: 3 });
    const stale = {
      savedBriefing: buildBriefingView(),
      briefingRevision: 2,
      selectedPreview: null,
    };
    expect(applyBriefingSaved(view, stale)).toBe(view);
  });
});
