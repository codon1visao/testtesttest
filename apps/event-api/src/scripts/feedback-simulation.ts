import { SubmitFeedbackResponseSchema } from "@event-desk/contracts";
import type { SimulateOptions } from "./feedback-simulate-args.js";

export interface SimulationResult {
  id: string;
  automaticBriefing: "scheduled" | "deferred";
}

/** Posts the notes in order, one new submissionId each, through the same endpoint as the form (F3). */
export async function runSimulation(
  options: SimulateOptions,
  deps: {
    fetch: typeof fetch;
    sleep: (ms: number) => Promise<void>;
    newSubmissionId: () => string;
  },
): Promise<SimulationResult[]> {
  const results: SimulationResult[] = [];
  for (let index = 0; index < options.count; index++) {
    if (index > 0) await deps.sleep(options.intervalMs);
    const text = options.texts[index % options.texts.length] ?? "";
    const response = await deps.fetch(`${options.apiUrl}/api/events/${options.eventId}/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: options.origin },
      body: JSON.stringify({ submissionId: deps.newSubmissionId(), text }),
    });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(
        `Note ${String(index + 1)} was rejected with HTTP ${String(response.status)}: ${JSON.stringify(body)}`,
      );
    }
    const parsed = SubmitFeedbackResponseSchema.parse(body);
    results.push({ id: parsed.note.id, automaticBriefing: parsed.automaticBriefing });
  }
  return results;
}
