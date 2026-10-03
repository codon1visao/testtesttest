import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import type { BriefingView } from "@event-desk/contracts";
import { useState } from "react";
import { ConfirmDialog } from "../../shared/ui/confirm-dialog";
import { formatTimestamp } from "./briefing-copy";

/**
 * F7: a ready candidate is announced, never forced into the editor. Reviewing it while the editor
 * has unsaved text asks first (F6 table, "Selected preview has unsaved text").
 */
export function IncomingPreviewNotice({
  preview,
  isDirty,
  isOpening,
  onReview,
}: {
  preview: BriefingView;
  isDirty: boolean;
  isOpening: boolean;
  onReview: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const origin =
    preview.trigger === "manual"
      ? "Generated on request"
      : "Generated automatically from new feedback";
  const stale = preview.freshness.current ? "" : " It is already out of date.";
  const kept = isDirty ? " Your unsaved edits stay until you choose." : "";
  return (
    <>
      <Banner
        status="info"
        title="New briefing ready to review"
        description={`${origin} at ${formatTimestamp(preview.provenance.generatedAt)}.${stale}${kept}`}
        endContent={
          <Button
            label="Review new preview"
            variant="secondary"
            isLoading={isOpening}
            isDisabled={isOpening}
            onClick={() => {
              if (isDirty) setConfirming(true);
              else onReview();
            }}
          />
        }
      />
      <ConfirmDialog
        isOpen={confirming}
        title="Discard your edits and review the new preview?"
        description="Your unsaved wording will be lost. Cancel to keep editing; you can save it first."
        actionLabel="Discard and review"
        onCancel={() => {
          setConfirming(false);
        }}
        onConfirm={() => {
          setConfirming(false);
          onReview();
        }}
      />
    </>
  );
}
