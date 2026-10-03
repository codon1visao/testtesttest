import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { VStack } from "@astryxdesign/core/Layout";
import { Text } from "@astryxdesign/core/Text";
import type { BriefingView, EventId, EventView, HttpErrorCode } from "@event-desk/contracts";
import { useEffect, useState } from "react";
import { ApiError, describeApiError } from "../../data/http/api-error";
import { useGenerateBriefing } from "../../data/mutations/use-generate-briefing";
import { ConfirmDialog } from "../../shared/ui/confirm-dialog";
import { useUiStore } from "../../state/ui-store";
import { BatchStatus } from "./batch-status";
import { formatClock } from "./batch-status-text";
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
 * Generate and Retry are the same synchronous call (A6); attendance must be saved first (F4), and a
 * provider cooldown (F8) holds it until the server says it ends.
 */
export function GenerateBriefingControl({
  eventId,
  view,
  onGenerated,
}: {
  eventId: EventId;
  view: EventView;
  /** After THIS tab's Generate succeeds (F4 step 7): the panel decides whether to open it. */
  onGenerated?: (preview: BriefingView) => void;
}) {
  const generation = useGenerateBriefing(eventId);
  const attendanceDirty = useUiStore((state) => state.attendanceDirty);
  const [confirmingRetry, setConfirmingRetry] = useState(false);
  useOutcomeAnnouncements(view.generation.lastOutcome);

  // Plan 3B carry-forward: a Retry banner is stale once a different incoming preview arrives.
  const incomingId = view.incomingPreview?.provenance.generationId ?? null;
  const [incomingAtError, setIncomingAtError] = useState<string | null>(null);
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
          setIncomingAtError(incomingId);
        },
      },
    );
  };
  const press = () => {
    if (busy || attendanceDirty || cooling) return;
    if (generation.isError && mayHaveBeenCharged(generation.error)) setConfirmingRetry(true);
    else start();
  };

  return (
    <VStack gap={2}>
      <div>
        {/* While busy, Astryx renders aria-disabled (not native disabled) when a tooltip is set, so
            the button keeps keyboard focus (README "Screen and interaction"); press() ignores it.
            Unsaved attendance stays natively disabled: nothing was activated. */}
        <Button
          variant="primary"
          label={busy ? "Generating briefing…" : generation.isError ? "Retry" : "Generate briefing"}
          isLoading={busy}
          isDisabled={attendanceDirty || cooling}
          {...(busy ? { tooltip: "Wait for the current generation to finish." } : {})}
          onClick={press}
        />
      </div>
      <div role="status" aria-live="polite">
        {busy ? (
          <Text>
            {elsewhere
              ? "A briefing is being generated in another tab…"
              : "Generating briefing… This can take up to a minute."}
          </Text>
        ) : attendanceDirty ? (
          <Text>Save or discard your attendance changes before generating.</Text>
        ) : cooling ? (
          <Text>
            {`The AI provider is limiting requests. Generate is available again at ${formatClock(cooldownUntil)}.`}
          </Text>
        ) : null}
      </div>
      <BatchStatus
        view={view}
        canGenerate={!busy && !attendanceDirty && !cooling}
        onGenerate={press}
      />
      {generation.isError && !busy ? (
        <Banner
          status="error"
          title={
            generation.error instanceof ApiError && generation.error.outcomeUnknown
              ? "Could not confirm the generation"
              : "Briefing was not generated"
          }
          description={describeApiError(generation.error)}
        />
      ) : null}
      <ConfirmDialog
        isOpen={confirmingRetry}
        title="Generate again?"
        description="The last attempt may have reached the AI provider and been charged. Check the briefing below first: generating again starts a new paid attempt."
        actionLabel="Generate again"
        onCancel={() => {
          setConfirmingRetry(false);
        }}
        onConfirm={() => {
          setConfirmingRetry(false);
          start();
        }}
      />
    </VStack>
  );
}
