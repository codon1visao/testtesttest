import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { VStack } from "@astryxdesign/core/Layout";
import { Heading, Text } from "@astryxdesign/core/Text";
import { TextArea } from "@astryxdesign/core/TextArea";
import { VisuallyHidden } from "@astryxdesign/core/VisuallyHidden";
import { assertNever, type EventId, type EventView } from "@event-desk/contracts";
import * as stylex from "@stylexjs/stylex";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { type Control, Controller } from "react-hook-form";
import { ConfirmDialog } from "../../shared/ui/confirm-dialog";
import { useUiStore } from "../../state/ui-store";
import type { RefetchEvent } from "../attendance/use-attendance-form";
import { SourceDisclosure } from "../feedback/source-disclosure";
import { SECTION_COPY } from "./briefing-copy";
import { BriefingContentView } from "./briefing-content-view";
import type {
  BriefingFieldPath,
  BriefingFormOutput,
  BriefingFormValues,
  EditorBase,
} from "./briefing-form-model";
import { BriefingSectionsLayout, SummaryCard } from "./briefing-sections";
import { BriefingPreview } from "./briefing-preview";
import { FreshnessNotice } from "./freshness-notice";
import { type BriefingNotice, useBriefingForm } from "./use-briefing-form";

const styles = stylex.create({
  // The visually hidden title is absolutely positioned: anchored here, focusing it keeps the
  // briefing in view instead of scrolling the page to its top.
  article: { position: "relative" },
});

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
  actionsSlot = null,
  sectionsSlot,
}: {
  eventId: EventId;
  view: EventView;
  base: EditorBase;
  refetch: RefetchEvent;
  /** The panel is replacing this base (an automatic select in flight): no new text meanwhile. */
  isLocked?: boolean;
  /** The panel header's actions group: Edit, or Cancel and Save, render there (spec 2026-10-04). */
  actionsSlot?: HTMLElement | null;
  /**
   * The panel's slot below the Briefing card: the Themes, Disagreements and Suggestions cards render
   * there in both views (spec 05, amended 2026-10-04). Omitted: inline. Their text areas stay
   * outside the <form> element; Save is the header button, which submits through the hook.
   */
  sectionsSlot?: HTMLElement | null | undefined;
  onSaved: (outcome: { reconciled: boolean }) => void;
  /** Just before an explicit discard or reload drops the draft: a remounted editor takes focus. */
  onReset: () => void;
  consumePendingFocus: () => boolean;
}) {
  // The briefing opens read-only (spec 2026-10-04); Edit opens the text areas. Local state: a
  // remount (after a save, or a clean editor following the view) returns to the read view, and a
  // dirty draft never remounts, so typed text is never hidden or replaced without a choice.
  const [isEditing, setIsEditing] = useState(false);
  const editor = useBriefingForm(eventId, base, refetch, onSaved, onReset, isEditing);
  const [confirming, setConfirming] = useState<"discard" | "reload" | null>(null);
  // Mirrored for the panel, which offers Generate only while the text areas are closed.
  const setBriefingEditing = useUiStore((state) => state.setBriefingEditing);
  useEffect(() => {
    setBriefingEditing(isEditing);
  }, [isEditing, setBriefingEditing]);
  useEffect(
    () => () => {
      setBriefingEditing(false);
    },
    [setBriefingEditing],
  );
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
  // A field to focus once the text areas are on screen: the first, after Edit. A request counter,
  // like the others.
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
  const fieldsDisabled = editor.areFieldsLocked || isLocked;
  // F5-04: a server field error focuses its field, once the save that raised it has unlocked it.
  const handledErrorFocus = useRef(0);
  useEffect(() => {
    const request = editor.fieldErrorFocus;
    if (request === null || request.request === handledErrorFocus.current || fieldsDisabled) return;
    handledErrorFocus.current = request.request;
    editor.form.setFocus(request.path);
  }, [editor.fieldErrorFocus, editor.form, fieldsDisabled]);
  const startEditing = () => {
    setIsEditing(true);
    requestFieldFocus("feedbackSummary");
  };
  // Without changes Cancel just closes the text areas; with changes it asks first (F5-10).
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
    base.slot === "selected" ? "Generated preview — not saved as briefing" : "Saved briefing";
  // A selected preview can be saved as it is; Save replaces any saved briefing (F5-09).
  const canSave = base.slot === "selected" || editor.isDirty;
  const control = editor.form.control;
  // In the panel header, outside the <form>: Save submits through the form's own handler.
  const actions = isEditing ? (
    <>
      <Button
        variant="secondary"
        label="Cancel"
        isDisabled={editor.isBusy}
        onClick={cancelEditing}
      />
      <Button
        variant="primary"
        label="Save"
        isDisabled={!canSave || editor.isBusy}
        isLoading={editor.isSaving}
        onClick={() => void editor.submit()}
      />
    </>
  ) : (
    <>
      <Button variant="secondary" label="Edit" isDisabled={fieldsDisabled} onClick={startEditing} />
      {/* The read view's way to save a generated preview: unchanged, through the same save as the
          edit view's Save, replacing any saved briefing (spec 05, amended 2026-10-04). */}
      {base.slot === "selected" ? (
        <Button
          variant="primary"
          label="Accept preview"
          // An unavailable generation would fail the same way again: Reload first.
          isDisabled={editor.isBusy || isLocked || editor.notice?.kind === "unavailable"}
          isLoading={editor.isSaving}
          onClick={() => void editor.submit()}
        />
      ) : null}
    </>
  );

  return (
    <article aria-labelledby={headingId} {...stylex.props(styles.article)}>
      {actionsSlot === null ? null : createPortal(actions, actionsSlot)}
      <VStack gap={3}>
        {/* Spec 05 (amended 2026-10-04): visually hidden. It still names the article and takes
            focus after cancel, discard, reload, save and switch; the panel header's Unsaved preview
            badge marks a generated preview for sighted users. */}
        <VisuallyHidden as="div" data-editor-title="">
          <Heading level={3} id={headingId} ref={headingRef} tabIndex={-1}>
            {title}
          </Heading>
        </VisuallyHidden>
        <FreshnessNotice briefing={live} members={view.members} counts={view.counts} />
        <form
          noValidate
          onSubmit={(event) => {
            void editor.submit(event);
          }}
        >
          <VStack gap={4}>
            {isEditing ? (
              <BriefingSectionsLayout
                sectionsSlot={sectionsSlot}
                summary={
                  <SummaryCard>
                    <TextField
                      control={control}
                      name="feedbackSummary"
                      label="Feedback summary"
                      isDisabled={fieldsDisabled}
                    />
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
                sectionsSlot={sectionsSlot}
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
