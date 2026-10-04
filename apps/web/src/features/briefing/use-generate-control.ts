import type { BriefingView, EventId, EventView, HttpErrorCode } from "@event-desk/contracts";
import { useEffect, useRef, useState } from "react";
import { ApiError } from "../../data/http/api-error";
import { useGenerateBriefing } from "../../data/mutations/use-generate-briefing";
import { useUiStore } from "../../state/ui-store";
import { useOutcomeAnnouncements } from "./use-outcome-announcements";

/** The earlier attempt may have reached the provider (F8): Retry asks before paying again (T3 §11). */
const UNCERTAIN_CODES: ReadonlySet<HttpErrorCode> = new Set([
  "AI_OUTCOME_UNKNOWN",
  "DEADLINE_EXCEEDED",
]);

export function mayHaveBeenCharged(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false;
  return error.outcomeUnknown || (error.code !== undefined && UNCERTAIN_CODES.has(error.code));
}

/**
 * Generate and Retry are the same synchronous call (A6); attendance must be saved first (F4), an open
 * briefing editor must be saved or cancelled first (F6, amended 2026-10-04), and a provider cooldown
 * (F8) holds it until the server says it ends. One state for the header button and the status shown
 * below it.
 */
export function useGenerateControl(
  eventId: EventId,
  view: EventView,
  /** After THIS tab's Generate succeeds (F4 step 7): the panel decides whether to open it. */
  onGenerated?: (preview: BriefingView) => void,
) {
  const generation = useGenerateBriefing(eventId);
  const attendanceDirty = useUiStore((state) => state.attendanceDirty);
  const briefingEditing = useUiStore((state) => state.briefingEditing);
  const [confirmingRetry, setConfirmingRetry] = useState(false);
  useOutcomeAnnouncements(view.generation.lastOutcome);

  // Plan 3B carry-forward: a Retry banner is stale once a different incoming preview arrives.
  const incomingId = view.incomingPreview?.provenance.generationId ?? null;
  const [incomingAtError, setIncomingAtError] = useState<string | null>(null);
  // The failure is judged against the preview present when it lands, not when Generate was pressed:
  // a batch may commit a new preview while the manual call is in flight.
  const latestIncoming = useRef(incomingId);
  useEffect(() => {
    latestIncoming.current = incomingId;
  }, [incomingId]);
  useEffect(() => {
    if (generation.isError && incomingId !== incomingAtError) generation.reset();
  }, [generation, incomingId, incomingAtError]);

  const elsewhere = view.generation.manual !== null && !generation.isPending;
  const busy = generation.isPending || view.generation.manual !== null;
  const { cooldownUntil } = view.generation;
  const cooling = cooldownUntil !== null;
  const start = () => {
    generation.mutate(
      { baseAttendanceRevision: view.attendanceRevision },
      {
        onSuccess: (response) => onGenerated?.(response.incomingPreview),
        onError: () => {
          setIncomingAtError(latestIncoming.current);
        },
      },
    );
  };
  const press = () => {
    if (busy || attendanceDirty || cooling || briefingEditing) return;
    if (generation.isError && mayHaveBeenCharged(generation.error)) setConfirmingRetry(true);
    else start();
  };

  return {
    generation,
    attendanceDirty,
    busy,
    /** A generation started in another tab is running. */
    elsewhere,
    cooldownUntil,
    canGenerate: !busy && !attendanceDirty && !cooling && !briefingEditing,
    press,
    confirmingRetry,
    confirmRetry: () => {
      setConfirmingRetry(false);
      start();
    },
    cancelRetry: () => {
      setConfirmingRetry(false);
    },
  };
}

export type GenerateControl = ReturnType<typeof useGenerateControl>;
