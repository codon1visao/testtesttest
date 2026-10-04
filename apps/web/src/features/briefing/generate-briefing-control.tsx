import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { VStack } from "@astryxdesign/core/Layout";
import { Text } from "@astryxdesign/core/Text";
import type { EventView } from "@event-desk/contracts";
import { ApiError, describeApiError } from "../../data/http/api-error";
import { ConfirmDialog } from "../../shared/ui/confirm-dialog";
import { BatchStatus } from "./batch-status";
import { formatClock } from "./batch-status-text";
import type { GenerateControl } from "./use-generate-control";

/** Generate briefing (or Retry), on the right of the Briefing section's header. */
export function GenerateBriefingButton({ control }: { control: GenerateControl }) {
  const { busy, generation, attendanceDirty, cooldownUntil, press } = control;
  return (
    <div>
      {/* While busy, Astryx renders aria-disabled (not native disabled) when a tooltip is set, so
          the button keeps keyboard focus (README "Screen and interaction"); press() ignores it.
          Unsaved attendance stays natively disabled: nothing was activated. */}
      <Button
        variant="primary"
        label={busy ? "Generating briefing…" : generation.isError ? "Retry" : "Generate briefing"}
        isLoading={busy}
        isDisabled={attendanceDirty || cooldownUntil !== null}
        {...(busy ? { tooltip: "Wait for the current generation to finish." } : {})}
        onClick={press}
      />
    </div>
  );
}

/** What Generate is doing or waiting for, the batch status, failures and the paid-retry check. */
export function GenerateBriefingStatus({
  control,
  view,
}: {
  control: GenerateControl;
  view: EventView;
}) {
  const { busy, elsewhere, attendanceDirty, cooldownUntil, generation } = control;
  return (
    <VStack gap={2}>
      <div role="status" aria-live="polite">
        {busy ? (
          <Text>
            {elsewhere
              ? "A briefing is being generated in another tab…"
              : "Generating briefing… This can take up to a minute."}
          </Text>
        ) : attendanceDirty ? (
          <Text>Save or discard your attendance changes before generating.</Text>
        ) : cooldownUntil !== null ? (
          <Text>
            {`The AI provider is limiting requests. Generate is available again at ${formatClock(cooldownUntil)}.`}
          </Text>
        ) : null}
      </div>
      <BatchStatus view={view} canGenerate={control.canGenerate} onGenerate={control.press} />
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
        isOpen={control.confirmingRetry}
        title="Generate again?"
        description="The last attempt may have reached the AI provider and been charged. Check the briefing below first: generating again starts a new paid attempt."
        actionLabel="Generate again"
        isDestructive={false}
        onCancel={control.cancelRetry}
        onConfirm={control.confirmRetry}
      />
    </VStack>
  );
}
