import type { GenerationActivity } from "../../ports/generation-activity.js";

/** Until Plans 3 and 5 add manual generation and the batch queue, nothing is ever running. */
export const noGenerationActivity: GenerationActivity = {
  current: () => Promise.resolve({ manual: null, batch: null, cooldownUntil: null }),
};
