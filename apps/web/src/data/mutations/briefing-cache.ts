import type { EventView, SaveBriefingResponse, SelectPreviewResponse } from "@event-desk/contracts";

/**
 * TX7 moved the incoming preview to selected; a newer incoming preview that arrived meanwhile stays.
 * A late response the cache has moved past (the generation is neither waiting nor selected there)
 * changes nothing: the onSettled refetch decides what is selected now.
 */
export function applyPreviewSelected(view: EventView, response: SelectPreviewResponse): EventView {
  const selectedId = response.selectedPreview.provenance.generationId;
  if (
    view.incomingPreview?.provenance.generationId !== selectedId &&
    view.selectedPreview?.provenance.generationId !== selectedId
  ) {
    return view;
  }
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
