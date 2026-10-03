import type { EventView, GenerateBriefingResponse } from "@event-desk/contracts";

/** A manual result always lands in the incoming slot (F7); nothing else in the view changes. */
export function applyGenerated(view: EventView, response: GenerateBriefingResponse): EventView {
  return { ...view, incomingPreview: response.incomingPreview };
}
