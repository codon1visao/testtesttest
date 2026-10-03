import { buildBriefingView, buildSeedEventView } from "@event-desk/contracts/testing";
import { describe, expect, it } from "vitest";
import { applyGenerated } from "./generation-cache";

describe("applyGenerated", () => {
  it("puts the new preview in the incoming slot and leaves everything else alone", () => {
    const view = buildSeedEventView();
    const incomingPreview = buildBriefingView();
    const next = applyGenerated(view, { incomingPreview });
    expect(next.incomingPreview).toBe(incomingPreview);
    expect({ ...next, incomingPreview: null }).toEqual(view);
  });
});
