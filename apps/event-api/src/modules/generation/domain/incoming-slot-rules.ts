import type { GenerationTrigger } from "@event-desk/contracts";

export interface IncomingCandidate {
  trigger: GenerationTrigger;
  /** When the generation read its input (TX4 / TX10). */
  inputCapturedAt: Date;
}

export type IncomingDecision =
  { kind: "replace" } | { kind: "keep"; outcome: "superseded" | "superseded_by_manual" };

/**
 * F7 "Who may replace the incoming preview". A result that read its data earlier never replaces
 * a newer one; an automatic result never replaces an unreviewed manual one (coordinator priority).
 * A manual result in the incoming slot is always unreviewed: selecting it moves it out (TX7).
 */
export function decideIncoming(
  current: IncomingCandidate | null,
  candidate: IncomingCandidate,
): IncomingDecision {
  if (current === null) return { kind: "replace" };
  if (candidate.inputCapturedAt.getTime() < current.inputCapturedAt.getTime()) {
    return { kind: "keep", outcome: "superseded" };
  }
  if (current.trigger === "manual" && candidate.trigger === "feedback_batch") {
    return { kind: "keep", outcome: "superseded_by_manual" };
  }
  return { kind: "replace" };
}
