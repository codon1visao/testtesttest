import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { HStack, VStack } from "@astryxdesign/core/Layout";
import { Heading, Text } from "@astryxdesign/core/Text";
import { TextArea } from "@astryxdesign/core/TextArea";
import { assertNever, type EventId, type EventView, LIST_SECTIONS } from "@event-desk/contracts";
import { useEffect, useId, useRef, useState } from "react";
import { type Control, Controller } from "react-hook-form";
import { ConfirmDialog } from "../../shared/ui/confirm-dialog";
import { formatAttendanceCounts } from "../attendance/attendance-counts";
import type { RefetchEvent } from "../attendance/use-attendance-form";
import { SourceReferences } from "../feedback/source-reference";
import { EVIDENCE_LIMIT_NOTICE, formatTimestamp, SECTION_COPY } from "./briefing-copy";
import type {
  BriefingFieldPath,
  BriefingFormOutput,
  BriefingFormValues,
  EditorBase,
} from "./briefing-form-model";
import { BriefingPreview } from "./briefing-preview";
import { FreshnessNotice } from "./freshness-notice";
import { type BriefingNotice, useBriefingForm } from "./use-briefing-form";

function TextField({
  control,
  name,
  label,
  isDisabled,
}: {
  control: Control<BriefingFormValues, unknown, BriefingFormOutput>;
  name: BriefingFieldPath;
  label: string;
  isDisabled: boolean;
}) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <TextArea
          ref={field.ref}
          label={label}
          value={field.value}
          rows={3}
          isDisabled={isDisabled}
          onChange={(value) => {
            field.onChange(value);
          }}
          onBlur={field.onBlur}
          {...(fieldState.error?.message === undefined
            ? {}
            : { status: { type: "error" as const, message: fieldState.error.message } })}
        />
      )}
    />
  );
}

function NoticeBanner({
  notice,
  isBusy,
  onReload,
  onRetry,
  onCheckAgain,
}: {
  notice: BriefingNotice;
  isBusy: boolean;
  onReload: () => void;
  onRetry: () => void;
  onCheckAgain: () => void;
}) {
  const reload = (
    <Button
      label="Reload saved briefing"
      variant="secondary"
      isDisabled={isBusy}
      onClick={onReload}
    />
  );
  switch (notice.kind) {
    case "conflict":
      return (
        <Banner
          status="warning"
          title="The briefing changed elsewhere"
          description={`${notice.message} Your text is kept until you choose to reload.`}
          endContent={reload}
        />
      );
    case "unavailable":
      return (
        <Banner
          status="warning"
          title="This briefing can no longer be saved"
          description={`${notice.message} Your text is kept until you choose to reload.`}
          endContent={reload}
        />
      );
    case "invalid":
      return <Banner status="error" title="Briefing was not saved" description={notice.message} />;
    case "failed":
      return (
        <Banner
          status="error"
          title="Briefing was not saved"
          description={`${notice.message} Your text is kept; press Save to try again.`}
          endContent={
            <Button label="Retry save" variant="secondary" isDisabled={isBusy} onClick={onRetry} />
          }
        />
      );
    case "unconfirmed":
      return (
        <Banner
          status="warning"
          title="Could not confirm the save"
          description="The saved briefing does not match your text. It is kept; check it and save again."
        />
      );
    case "check-failed":
      return (
        <Banner
          status="warning"
          title="Could not check the saved briefing"
          description={`It is not known whether your text was saved. It is kept; try again. ${notice.message}`}
          endContent={
            <Button
              label="Check again"
              variant="secondary"
              isDisabled={isBusy}
              onClick={onCheckAgain}
            />
          }
        />
      );
    default:
      return assertNever(notice, "briefing notice");
  }
}

/** F5: edit the wording of one briefing; structure, references and provenance stay fixed. */
export function BriefingEditor({
  eventId,
  view,
  base,
  refetch,
  onSaved,
  onReset,
  consumePendingFocus,
}: {
  eventId: EventId;
  view: EventView;
  base: EditorBase;
  refetch: RefetchEvent;
  onSaved: (outcome: { reconciled: boolean }) => void;
  /** Just before an explicit discard or reload drops the draft: a remounted editor takes focus. */
  onReset: () => void;
  consumePendingFocus: () => boolean;
}) {
  const editor = useBriefingForm(eventId, base, refetch, onSaved, onReset);
  const [confirming, setConfirming] = useState<"discard" | "reload" | null>(null);
  // The dialog is a native modal: while it is open the page is inert, and on close the browser
  // returns focus to the trigger, which a reset unmounts. Focus moves only once it has closed.
  // A request counter (not a boolean cleared in the effect): each request is handled once.
  const [focusAfterClose, setFocusAfterClose] = useState(0);
  const handledFocus = useRef(0);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const headingId = useId();
  useEffect(() => {
    if (consumePendingFocus()) headingRef.current?.focus();
  }, [consumePendingFocus]);
  useEffect(() => {
    if (confirming !== null || focusAfterClose === handledFocus.current) return;
    handledFocus.current = focusAfterClose;
    headingRef.current?.focus();
  }, [confirming, focusAfterClose]);
  const requestFocusAfterClose = () => {
    setFocusAfterClose((count) => count + 1);
  };

  const { briefing } = base;
  const content = briefing.content;
  // Freshness follows the saved records even while the draft keeps its base (F5-12).
  const live =
    [view.selectedPreview, view.savedBriefing].find(
      (candidate) => candidate?.provenance.generationId === briefing.provenance.generationId,
    ) ?? briefing;
  const title =
    base.slot === "selected"
      ? "Generated preview — not saved as briefing"
      : briefing.savedAt === undefined
        ? "Saved briefing"
        : `Saved briefing · last saved ${formatTimestamp(briefing.savedAt)}`;
  const saveLabel =
    base.slot === "selected" && view.savedBriefing !== null
      ? "Save and replace briefing"
      : "Save briefing";
  const canSave = base.slot === "selected" || editor.isDirty;
  const control = editor.form.control;

  return (
    <article aria-labelledby={headingId}>
      <VStack gap={3}>
        <Heading level={3} id={headingId} ref={headingRef} tabIndex={-1}>
          {title}
        </Heading>
        <Text type="supporting">
          Generated {formatTimestamp(briefing.provenance.generatedAt)} · {briefing.provenance.model}{" "}
          · {briefing.trigger === "manual" ? "requested by you" : "automatic"}
        </Text>
        <FreshnessNotice briefing={live} members={view.members} counts={view.counts} />
        <Text type="supporting">{EVIDENCE_LIMIT_NOTICE}</Text>
        <form
          noValidate
          onSubmit={(event) => {
            void editor.submit(event);
          }}
        >
          <VStack gap={4}>
            <VStack gap={2}>
              <Heading level={4}>What happened</Heading>
              <TextField
                control={control}
                name="attendanceOverview"
                label="Attendance overview"
                isDisabled={editor.isBusy}
              />
              <VStack gap={0}>
                <Text type="supporting">Check edited wording against the counts.</Text>
                <Text type="supporting">
                  Generated from: {formatAttendanceCounts(briefing.provenance.input.counts)}
                </Text>
                <Text type="supporting">
                  Saved records now: {formatAttendanceCounts(view.counts)}
                </Text>
              </VStack>
              <TextField
                control={control}
                name="feedbackSummary"
                label="Feedback summary"
                isDisabled={editor.isBusy}
              />
              <SourceReferences
                sourceIds={content.feedbackSummary.sourceIds}
                notes={view.feedback}
              />
            </VStack>
            {LIST_SECTIONS.map((section) => (
              <VStack key={section} gap={2}>
                <Heading level={4}>{SECTION_COPY[section].title}</Heading>
                {content[section].length === 0 ? (
                  <Text type="supporting">{SECTION_COPY[section].empty}</Text>
                ) : (
                  <ol>
                    {content[section].map((item, index) => (
                      <li key={`${section}-${String(index)}`}>
                        <VStack gap={1}>
                          <TextField
                            control={control}
                            name={`${section}.${index}.text`}
                            label={`${SECTION_COPY[section].itemLabel} ${String(index + 1)}`}
                            isDisabled={editor.isBusy}
                          />
                          <SourceReferences sourceIds={item.sourceIds} notes={view.feedback} />
                        </VStack>
                      </li>
                    ))}
                  </ol>
                )}
              </VStack>
            ))}
            <div role="status" aria-live="polite">
              {editor.isSaving ? (
                <Text>Saving briefing…</Text>
              ) : editor.isDirty ? (
                <Text>Unsaved changes to the briefing text.</Text>
              ) : null}
            </div>
            {editor.notice === null ? null : (
              <NoticeBanner
                notice={editor.notice}
                isBusy={editor.isBusy}
                onReload={() => {
                  setConfirming("reload");
                }}
                onRetry={() => {
                  void editor.submit();
                }}
                onCheckAgain={() => {
                  void editor.checkAgain();
                }}
              />
            )}
            {(editor.notice?.kind === "conflict" || editor.notice?.kind === "unavailable") &&
            view.savedBriefing !== null ? (
              // Spec 05 "Revision conflict": the current saved state, read-only, beside the kept draft.
              <BriefingPreview title="Latest saved briefing" briefing={view.savedBriefing} />
            ) : null}
            <HStack gap={2}>
              <Button
                type="submit"
                variant="primary"
                label={saveLabel}
                isDisabled={!canSave || editor.isBusy}
                isLoading={editor.isSaving}
              />
              {editor.isDirty ? (
                <Button
                  variant="secondary"
                  label="Discard edits"
                  isDisabled={editor.isBusy}
                  onClick={() => {
                    setConfirming("discard");
                  }}
                />
              ) : null}
            </HStack>
          </VStack>
        </form>
      </VStack>
      <ConfirmDialog
        isOpen={confirming === "discard"}
        title="Discard your edits?"
        description="Your unsaved wording will be lost. The saved briefing does not change."
        actionLabel="Discard"
        onCancel={() => {
          setConfirming(null);
        }}
        onConfirm={() => {
          setConfirming(null);
          editor.discard();
          requestFocusAfterClose();
        }}
      />
      <ConfirmDialog
        isOpen={confirming === "reload"}
        title="Reload the saved briefing?"
        description="Your unsaved wording will be discarded and replaced by the latest briefing."
        actionLabel="Discard and reload"
        onCancel={() => {
          setConfirming(null);
        }}
        onConfirm={() => {
          setConfirming(null);
          void editor.reloadLatest().then((reloaded) => {
            if (reloaded) requestFocusAfterClose();
          });
        }}
      />
    </article>
  );
}
