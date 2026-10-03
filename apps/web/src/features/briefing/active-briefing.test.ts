import { GenerationIdSchema } from "@event-desk/contracts";
import { buildBriefingView, buildSeedEventView } from "@event-desk/contracts/testing";
import { describe, expect, it } from "vitest";
import { activeBriefing, displayedBriefing } from "./active-briefing";

const other = (n: number) => {
  const base = buildBriefingView();
  return buildBriefingView({
    provenance: {
      ...base.provenance,
      generationId: GenerationIdSchema.parse(`0199a4e8-7c1a-7cc2-9d6e-00000000000${String(n)}`),
    },
  });
};

describe("activeBriefing / displayedBriefing (F7)", () => {
  it("prefers the selected preview, then the saved briefing; never the incoming one", () => {
    const saved = other(1);
    const selected = other(2);
    const incoming = other(3);
    expect(
      activeBriefing(buildSeedEventView({ savedBriefing: saved, selectedPreview: selected })),
    ).toEqual({ slot: "selected", briefing: selected });
    expect(
      activeBriefing(buildSeedEventView({ savedBriefing: saved, incomingPreview: incoming })),
    ).toEqual({ slot: "saved", briefing: saved });
    expect(activeBriefing(buildSeedEventView({ incomingPreview: incoming }))).toBeNull();
    expect(displayedBriefing(buildSeedEventView({ incomingPreview: incoming }))).toEqual(incoming);
    expect(displayedBriefing(buildSeedEventView())).toBeNull();
  });
});
