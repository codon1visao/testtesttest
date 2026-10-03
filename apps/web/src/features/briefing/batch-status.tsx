import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Text } from "@astryxdesign/core/Text";
import type { EventView } from "@event-desk/contracts";
import { batchFailureText, batchStateText } from "./batch-status-text";

/** F7: automatic work in text, shown beside (never instead of) the manual generation state. */
export function BatchStatus({
  view,
  canGenerate,
  onGenerate,
}: {
  view: EventView;
  canGenerate: boolean;
  onGenerate: () => void;
}) {
  const { batch, lastOutcome } = view.generation;
  const failed =
    batch === null && lastOutcome?.trigger === "feedback_batch" && lastOutcome.status === "failed";
  return (
    <>
      <div role="status" aria-live="polite">
        {batch === null ? null : <Text>{batchStateText(batch)}</Text>}
      </div>
      {failed ? (
        <Banner
          status="error"
          title={batchFailureText(lastOutcome.code)}
          endContent={
            <Button
              label="Generate briefing"
              variant="secondary"
              isDisabled={!canGenerate}
              onClick={onGenerate}
            />
          }
        />
      ) : null}
    </>
  );
}
