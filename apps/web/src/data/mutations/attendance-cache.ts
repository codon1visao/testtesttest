import type {
  BriefingView,
  EventView,
  Freshness,
  SaveAttendanceResponse,
} from "@event-desk/contracts";

const withFreshness = (
  briefing: BriefingView | null,
  freshness: Freshness | null,
): BriefingView | null =>
  briefing === null || freshness === null ? briefing : { ...briefing, freshness };

/** Applies a successful attendance save to the cached view (members, counts, revision, briefing freshness). */
export function applyAttendanceSaved(view: EventView, saved: SaveAttendanceResponse): EventView {
  return {
    ...view,
    members: saved.members,
    counts: saved.counts,
    attendanceRevision: saved.attendanceRevision,
    savedBriefing: withFreshness(view.savedBriefing, saved.freshness.savedBriefing),
    selectedPreview: withFreshness(view.selectedPreview, saved.freshness.selectedPreview),
    incomingPreview: withFreshness(view.incomingPreview, saved.freshness.incomingPreview),
  };
}
