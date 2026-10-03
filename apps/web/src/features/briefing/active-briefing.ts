import type { BriefingView, EventView } from "@event-desk/contracts";
import type { ActiveView } from "../../state/ui-store";

export type EditableSlot = "selected" | "saved";
export interface ActiveBriefing {
  slot: EditableSlot;
  briefing: BriefingView;
}

/**
 * What the editor works on (F7, T3 §11): when both a selected preview and a saved briefing exist,
 * the active view picks one; otherwise the one that exists. Never the incoming preview.
 */
export function activeBriefing(view: EventView, activeView: ActiveView): ActiveBriefing | null {
  const { selectedPreview, savedBriefing } = view;
  if (selectedPreview !== null && (savedBriefing === null || activeView === "preview")) {
    return { slot: "selected", briefing: selectedPreview };
  }
  if (savedBriefing !== null) return { slot: "saved", briefing: savedBriefing };
  return null;
}

/** What the page shows: the active briefing, else the unreviewed incoming preview. */
export function displayedBriefing(view: EventView, activeView: ActiveView): BriefingView | null {
  return activeBriefing(view, activeView)?.briefing ?? view.incomingPreview;
}
