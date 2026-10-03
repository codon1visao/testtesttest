import {
  type FeedbackNote,
  FeedbackIdSchema,
  type Member,
  SUPPLIED_EVENT,
  SUPPLIED_FEEDBACK,
  SUPPLIED_MEMBERS,
} from "@event-desk/contracts";
import { buildBriefingView, FIXTURE_TIME } from "@event-desk/contracts/testing";
import { describe, expect, it } from "vitest";
import type { BriefingSlots, StoredBriefing } from "../../ports/unit-of-work.js";
import { freshnessSummary, loadBriefingViews } from "./briefing-views.js";

const { freshness: _ignored, savedAt, ...stored } = buildBriefingView();
// BriefingView types savedAt as `string | undefined`; StoredBriefing omits it when absent.
const storedBriefing: StoredBriefing = { ...stored, ...(savedAt === undefined ? {} : { savedAt }) };
const notes: FeedbackNote[] = SUPPLIED_FEEDBACK.map((note) => ({
  ...note,
  receivedAt: FIXTURE_TIME,
}));

const scopeWith = (slots: BriefingSlots) => ({
  briefings: { loadSlots: () => Promise.resolve(slots) },
});
const withChris = (attendance: Member["attendance"]): Member[] =>
  SUPPLIED_MEMBERS.map((m) => (m.id === "M03" ? { ...m, attendance } : m));

describe("loadBriefingViews", () => {
  it("returns nulls when no briefing exists", async () => {
    const views = await loadBriefingViews(
      scopeWith({ saved: null, selected: null, incoming: null }),
      SUPPLIED_EVENT.id,
      SUPPLIED_MEMBERS,
      notes,
    );
    expect(views).toEqual({ savedBriefing: null, selectedPreview: null, incomingPreview: null });
  });

  it("marks a briefing current when saved records match its snapshot", async () => {
    const views = await loadBriefingViews(
      scopeWith({ saved: storedBriefing, selected: null, incoming: null }),
      SUPPLIED_EVENT.id,
      SUPPLIED_MEMBERS,
      notes,
    );
    expect(views.savedBriefing?.freshness).toEqual({
      current: true,
      attendanceChanges: [],
      newFeedbackIds: [],
    });
    expect(views.savedBriefing?.content).toEqual(storedBriefing.content);
  });

  it("names the attendance change that made it stale (F6)", async () => {
    const views = await loadBriefingViews(
      scopeWith({ saved: null, selected: null, incoming: storedBriefing }),
      SUPPLIED_EVENT.id,
      withChris("attended"),
      notes,
    );
    expect(views.incomingPreview?.freshness).toEqual({
      current: false,
      attendanceChanges: [{ memberId: "M03", from: "not_recorded", to: "attended" }],
      newFeedbackIds: [],
    });
  });

  it("lists notes added since the briefing", async () => {
    const withNewNote: FeedbackNote[] = [
      ...notes,
      { id: FeedbackIdSchema.parse("F09"), text: "Lovely views.", receivedAt: FIXTURE_TIME },
    ];
    const views = await loadBriefingViews(
      scopeWith({ saved: null, selected: storedBriefing, incoming: null }),
      SUPPLIED_EVENT.id,
      SUPPLIED_MEMBERS,
      withNewNote,
    );
    expect(views.selectedPreview?.freshness.newFeedbackIds).toEqual(["F09"]);
    expect(views.selectedPreview?.freshness.current).toBe(false);
  });

  it("summarises freshness per slot for the attendance response", async () => {
    const views = await loadBriefingViews(
      scopeWith({ saved: storedBriefing, selected: null, incoming: null }),
      SUPPLIED_EVENT.id,
      SUPPLIED_MEMBERS,
      notes,
    );
    expect(freshnessSummary(views)).toEqual({
      savedBriefing: { current: true, attendanceChanges: [], newFeedbackIds: [] },
      selectedPreview: null,
      incomingPreview: null,
    });
  });
});
