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

describe("activeBriefing / displayedBriefing (F7, T3 §11 active view)", () => {
  const saved = other(1);
  const selected = other(2);
  const incoming = other(3);

  it("with both a selected preview and a saved briefing, the active view picks one", () => {
    const view = buildSeedEventView({ savedBriefing: saved, selectedPreview: selected });
    expect(activeBriefing(view, "preview")).toEqual({ slot: "selected", briefing: selected });
    expect(activeBriefing(view, "saved")).toEqual({ slot: "saved", briefing: saved });
    expect(displayedBriefing(view, "preview")).toEqual(selected);
    expect(displayedBriefing(view, "saved")).toEqual(saved);
  });

  it("otherwise works on the one that exists, never the incoming one", () => {
    for (const activeView of ["preview", "saved"] as const) {
      expect(
        activeBriefing(
          buildSeedEventView({ savedBriefing: saved, incomingPreview: incoming }),
          activeView,
        ),
      ).toEqual({ slot: "saved", briefing: saved });
      expect(activeBriefing(buildSeedEventView({ selectedPreview: selected }), activeView)).toEqual(
        { slot: "selected", briefing: selected },
      );
      expect(
        activeBriefing(buildSeedEventView({ incomingPreview: incoming }), activeView),
      ).toBeNull();
      expect(
        displayedBriefing(buildSeedEventView({ incomingPreview: incoming }), activeView),
      ).toEqual(incoming);
      expect(displayedBriefing(buildSeedEventView(), activeView)).toBeNull();
    }
  });
});
