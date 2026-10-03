import {
  type BriefingView,
  computeFreshness,
  type EventId,
  type FeedbackNote,
  feedbackDigest,
  type Freshness,
  type Member,
} from "@event-desk/contracts";
import type { ReadScope, StoredBriefing } from "../../ports/unit-of-work.js";

export interface BriefingViews {
  savedBriefing: BriefingView | null;
  selectedPreview: BriefingView | null;
  incomingPreview: BriefingView | null;
}

/**
 * Loads the three briefing slots and computes each one's freshness against the given saved
 * records (D5). Shared by the event read and the attendance save so the rule exists once.
 */
export async function loadBriefingViews(
  scope: Pick<ReadScope, "briefings">,
  eventId: EventId,
  members: readonly Member[],
  feedback: readonly FeedbackNote[],
): Promise<BriefingViews> {
  const slots = await scope.briefings.loadSlots(eventId);
  if (slots.saved === null && slots.selected === null && slots.incoming === null) {
    return { savedBriefing: null, selectedPreview: null, incomingPreview: null };
  }
  const current = {
    members,
    feedbackIds: feedback.map((note) => note.id),
    feedbackDigest: await feedbackDigest(feedback),
  };
  const toView = (stored: StoredBriefing | null): BriefingView | null =>
    stored === null
      ? null
      : { ...stored, freshness: computeFreshness(stored.provenance.input, current) };
  return {
    savedBriefing: toView(slots.saved),
    selectedPreview: toView(slots.selected),
    incomingPreview: toView(slots.incoming),
  };
}

export function freshnessSummary(
  views: BriefingViews,
): Record<keyof BriefingViews, Freshness | null> {
  return {
    savedBriefing: views.savedBriefing?.freshness ?? null,
    selectedPreview: views.selectedPreview?.freshness ?? null,
    incomingPreview: views.incomingPreview?.freshness ?? null,
  };
}
