import type { BriefingView, EventView } from "@event-desk/contracts";

export type EditableSlot = "selected" | "saved";
export interface ActiveBriefing {
  slot: EditableSlot;
  briefing: BriefingView;
}

/** What the editor works on: the selected preview, else the saved briefing (F7). Never incoming. */
export function activeBriefing(view: EventView): ActiveBriefing | null {
  if (view.selectedPreview !== null) return { slot: "selected", briefing: view.selectedPreview };
  if (view.savedBriefing !== null) return { slot: "saved", briefing: view.savedBriefing };
  return null;
}

/** What the page shows: the active briefing, else the unreviewed incoming preview. */
export function displayedBriefing(view: EventView): BriefingView | null {
  return activeBriefing(view)?.briefing ?? view.incomingPreview;
}
