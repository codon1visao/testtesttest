import { useToast } from "@astryxdesign/core/Toast";
import type { GenerationStatusView } from "@event-desk/contracts";
import { useEffect, useRef } from "react";
import { BATCH_READY_TEXT, batchFailureText } from "./batch-status-text";

const key = (runId: string) => `event-desk:announced:${runId}`;
const seen = (runId: string): boolean => {
  try {
    return window.sessionStorage.getItem(key(runId)) !== null;
  } catch {
    return false;
  }
};
const remember = (runId: string): void => {
  try {
    window.sessionStorage.setItem(key(runId), "1");
  } catch {
    // Storage unavailable: announcements fall back to once per page.
  }
};

/** Announces each automatic outcome once (toast), never on first load, and once per run across reloads (sessionStorage). */
export function useOutcomeAnnouncements(lastOutcome: GenerationStatusView["lastOutcome"]): void {
  const showToast = useToast();
  const initial = useRef<string | null | undefined>(undefined);
  const runId = lastOutcome?.runId ?? null;
  useEffect(() => {
    if (initial.current === undefined) {
      initial.current = runId; // the outcome present on load is not news
      if (runId !== null) remember(runId);
      return;
    }
    if (lastOutcome?.trigger !== "feedback_batch" || seen(lastOutcome.runId)) return;
    remember(lastOutcome.runId);
    if (lastOutcome.status === "succeeded") showToast({ type: "info", body: BATCH_READY_TEXT });
    else if (lastOutcome.status === "failed")
      showToast({ type: "error", body: batchFailureText(lastOutcome.code) });
  }, [runId, lastOutcome, showToast]);
}
