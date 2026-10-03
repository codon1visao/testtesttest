import type { EventView, SaveBriefingResponse, SelectPreviewResponse } from "@event-desk/contracts";

/** TX7 moved the incoming preview to selected; a newer incoming preview that arrived meanwhile stays. */
export function applyPreviewSelected(view: EventView, response: SelectPreviewResponse): EventView {
  const selectedId = response.selectedPreview.provenance.generationId;
  return {
    ...view,
    selectedPreview: response.selectedPreview,
    incomingPreview:
      view.incomingPreview?.provenance.generationId === selectedId ? null : view.incomingPreview,
  };
}

/** TX8's result; an older response never rolls the displayed revision backward (F6 race 4). */
export function applyBriefingSaved(view: EventView, response: SaveBriefingResponse): EventView {
  if (response.briefingRevision < view.briefingRevision) return view;
  return {
    ...view,
    savedBriefing: response.savedBriefing,
    briefingRevision: response.briefingRevision,
    selectedPreview: response.selectedPreview,
  };
}
