import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { HStack, VStack } from "@astryxdesign/core/Layout";
import { Heading, Text } from "@astryxdesign/core/Text";
import { TextArea } from "@astryxdesign/core/TextArea";
import { assertNever, type EventId, type EventView } from "@event-desk/contracts";
import { useEffect, useId, useRef, useState } from "react";
import { type Control, Controller } from "react-hook-form";
import { ConfirmDialog } from "../../shared/ui/confirm-dialog";
import { formatAttendanceCounts } from "../attendance/attendance-counts";
import type { RefetchEvent } from "../attendance/use-attendance-form";
import { SourceDisclosure } from "../feedback/source-disclosure";
import { EVIDENCE_LIMIT_NOTICE, formatTimestamp, SECTION_COPY } from "./briefing-copy";
import { BriefingContentView } from "./briefing-content-view";
import {
  type BriefingFieldPath,
  type BriefingFormOutput,
  type BriefingFormValues,
  type EditorBase,
  firstErrorField,
} from "./briefing-form-model";
import { BriefingSectionsLayout, SummaryCard } from "./briefing-sections";
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
  isLocked = false,
}: {
  eventId: EventId;
  view: EventView;
  base: EditorBase;
  refetch: RefetchEvent;
  /** The panel is replacing this base (an automatic select in flight): no new text meanwhile. */
  isLocked?: boolean;
  onSaved: (outcome: { reconciled: boolean }) => void;
  /** Just before an explicit discard or reload drops the draft: a remounted editor takes focus. */
  onReset: () => void;
  consumePendingFocus: () => boolean;
}) {
  const editor = useBriefingForm(eventId, base, refetch, onSaved, onReset);
  const [confirming, setConfirming] = useState<"discard" | "reload" | null>(null);
  // The briefing opens read-only (spec 2026-10-04); Edit briefing opens the text areas. Local state:
  // a remount (after a save, or a clean editor following the view) returns to the read view, and a
  // dirty draft never remounts, so typed text is never hidden or replaced without a choice.
  const [isEditing, setIsEditing] = useState(false);
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
  // F5: a save attempt that ended with a notice moves focus to it (field errors focus their field).
  const noticeRef = useRef<HTMLDivElement>(null);
  const handledNoticeFocus = useRef(0);
  useEffect(() => {
    if (editor.noticeFocusRequest === handledNoticeFocus.current) return;
    handledNoticeFocus.current = editor.noticeFocusRequest;
    noticeRef.current?.focus();
  }, [editor.noticeFocusRequest]);
  const requestFocusAfterClose = () => {
    setFocusAfterClose((count) => count + 1);
  };
  // A field to focus once the text areas are on screen: the first after Edit briefing, the failing
  // one after a field error. A request counter, like the others.
  const [fieldFocus, setFieldFocus] = useState<{ path: BriefingFieldPath; request: number } | null>(
    null,
  );
  const handledFieldFocus = useRef(0);
  useEffect(() => {
    if (fieldFocus === null || fieldFocus.request === handledFieldFocus.current) return;
    handledFieldFocus.current = fieldFocus.request;
    editor.form.setFocus(fieldFocus.path);
  }, [fieldFocus, editor.form]);
  const requestFieldFocus = (path: BriefingFieldPath) => {
    setFieldFocus((current) => ({ path, request: (current?.request ?? 0) + 1 }));
  };
  // A field error needs its field: a save started from the read view opens the editor on it.
  // Adjusted during render, React's pattern for state derived from form state.
  const errorField = firstErrorField(editor.form.formState.errors, editor.form.getValues());
  if (errorField !== null && !isEditing) {
    setIsEditing(true);
    requestFieldFocus(errorField);
  }
  const startEditing = () => {
    setIsEditing(true);
    requestFieldFocus("feedbackSummary");
  };
  // Without changes Cancel edit just closes the text areas; with changes it asks first (F5-10).
  const cancelEditing = () => {
    if (editor.isDirty) {
      setConfirming("discard");
      return;
    }
    editor.form.clearErrors();
    setIsEditing(false);
    requestFocusAfterClose();
  };

  const { briefing } = base;
  const content = briefing.content;
  const scope = briefing.provenance.generationId;
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
  const fieldsDisabled = editor.areFieldsLocked || isLocked;
  const saveButton = (
    <Button
      type="submit"
      variant="primary"
      label={saveLabel}
      isDisabled={!canSave || editor.isBusy}
      isLoading={editor.isSaving}
    />
  );

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
            {isEditing ? (
              <BriefingSectionsLayout
                summary={
                  <SummaryCard>
                    <TextField
                      control={control}
                      name="feedbackSummary"
                      label="Feedback summary"
                      isDisabled={fieldsDisabled}
                    />
                    <SourceDisclosure
                      sourceIds={content.feedbackSummary.sourceIds}
                      notes={view.feedback}
                      disclosureScope={`${scope}:feedbackSummary`}
                    />
                    <TextField
                      control={control}
                      name="attendanceOverview"
                      label="Attendance overview"
                      isDisabled={fieldsDisabled}
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
                  </SummaryCard>
                }
                renderItems={(section) =>
                  content[section].map((item, index) => (
                    <VStack gap={1}>
                      <TextField
                        control={control}
                        name={`${section}.${index}.text`}
                        label={`${SECTION_COPY[section].itemLabel} ${String(index + 1)}`}
                        isDisabled={fieldsDisabled}
                      />
                      <SourceDisclosure
                        sourceIds={item.sourceIds}
                        notes={view.feedback}
                        disclosureScope={`${scope}:${section}.${String(index)}`}
                      />
                    </VStack>
                  ))
                }
              />
            ) : (
              <BriefingContentView
                content={content}
                notes={view.feedback}
                disclosureScope={scope}
              />
            )}
            <div role="status" aria-live="polite">
              {editor.isSaving ? (
                <Text>Saving briefing…</Text>
              ) : editor.isDirty ? (
                <Text>Unsaved changes to the briefing text.</Text>
              ) : null}
            </div>
            {editor.notice === null ? null : (
              <div ref={noticeRef} tabIndex={-1}>
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
              </div>
            )}
            {(editor.notice?.kind === "conflict" || editor.notice?.kind === "unavailable") &&
            view.savedBriefing !== null ? (
              // Spec 05 "Revision conflict": the current saved state, read-only, beside the kept draft.
              <BriefingPreview
                title="Latest saved briefing"
                briefing={view.savedBriefing}
                view={view}
              />
            ) : null}
            <HStack gap={2}>
              {isEditing ? (
                <>
                  {saveButton}
                  <Button
                    variant="secondary"
                    label="Cancel edit"
                    isDisabled={editor.isBusy}
                    onClick={cancelEditing}
                  />
                </>
              ) : (
                <>
                  {/* A selected preview can be saved as it is (spec 2026-10-04). */}
                  {base.slot === "selected" ? saveButton : null}
                  <Button
                    variant={base.slot === "selected" ? "secondary" : "primary"}
                    label="Edit briefing"
                    isDisabled={fieldsDisabled}
                    onClick={startEditing}
                  />
                </>
              )}
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
          setIsEditing(false);
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
            if (!reloaded) return;
            setIsEditing(false);
            requestFocusAfterClose();
          });
        }}
      />
    </article>
  );
}
