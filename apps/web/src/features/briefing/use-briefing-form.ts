import { zodResolver } from "@hookform/resolvers/zod";
import type { EventId } from "@event-desk/contracts";
import { type BaseSyntheticEvent, useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { ApiError, describeApiError } from "../../data/http/api-error";
import { useSaveBriefing } from "../../data/mutations/use-save-briefing";
import { useBeforeUnloadWarning } from "../../shared/hooks/use-before-unload-warning";
import { useUiStore } from "../../state/ui-store";
import type { RefetchEvent } from "../attendance/use-attendance-autosave";
import {
  type BriefingFieldPath,
  BriefingFormSchema,
  type BriefingFormOutput,
  type BriefingFormValues,
  draftMatchesSaved,
  type EditorBase,
  formFieldForApiField,
  toFormValues,
  toSaveRequest,
} from "./briefing-form-model";

export type BriefingNotice =
  | { kind: "conflict"; message: string }
  | { kind: "unavailable"; message: string }
  | { kind: "invalid"; message: string }
  | { kind: "failed"; message: string }
  | { kind: "unconfirmed" }
  | { kind: "check-failed"; message: string };

/**
 * The briefing text draft (F5). It is created from its base once; the panel remounts it (by
 * editorKey) only after an explicit select, save or discard, or while it is clean (T3 §11).
 * `onReset` runs just before an explicit discard or reload drops the draft, so a remounted editor
 * can take focus on its heading. `areFieldsShown`: the text areas are on screen; without them
 * (Accept preview in the read view) a field error has nowhere to land and goes to the banner.
 */
export function useBriefingForm(
  eventId: EventId,
  base: EditorBase,
  refetch: RefetchEvent,
  onSaved: (outcome: { reconciled: boolean }) => void,
  onReset: () => void,
  areFieldsShown: boolean,
) {
  const form = useForm<BriefingFormValues, unknown, BriefingFormOutput>({
    resolver: zodResolver(BriefingFormSchema),
    defaultValues: toFormValues(base.briefing.content),
  });
  const { isDirty } = form.formState;
  // Synchronous double-submit guard: React state (isPending) lags a fast second click.
  const inFlight = useRef(false);
  // The values of the last save attempt, for "Check again" after a failed re-read (F5).
  const lastSubmitted = useRef<BriefingFormOutput | null>(null);
  const [notice, setNotice] = useState<BriefingNotice | null>(null);
  // Counts save attempts that ended with a notice: the editor moves focus to it each time, since
  // the control that started the attempt was disabled or unmounted meanwhile.
  const [noticeFocusRequest, setNoticeFocusRequest] = useState(0);
  const showSaveNotice = (next: BriefingNotice) => {
    setNotice(next);
    setNoticeFocusRequest((count) => count + 1);
  };
  // A server error on one field: the editor focuses it once the text areas unlock. They are locked
  // while the save is in flight, and a disabled field cannot take focus. A request counter.
  const [fieldErrorFocus, setFieldErrorFocus] = useState<{
    path: BriefingFieldPath;
    request: number;
  } | null>(null);
  const [checking, setChecking] = useState(false);
  const save = useSaveBriefing(eventId);
  const setBriefingDirty = useUiStore((state) => state.setBriefingDirty);
  const generationId = base.briefing.provenance.generationId;

  useEffect(() => {
    setBriefingDirty(isDirty);
  }, [isDirty, setBriefingDirty]);
  useEffect(
    () => () => {
      setBriefingDirty(false);
    },
    [setBriefingDirty],
  );
  useBeforeUnloadWarning(isDirty);

  const showFailure = (error: unknown) => {
    const message = describeApiError(error);
    const code = error instanceof ApiError ? error.code : undefined;
    if (code === "BRIEFING_CONFLICT" || code === "PREVIEW_CONFLICT") {
      showSaveNotice({ kind: "conflict", message });
    } else if (code === "GENERATION_NOT_AVAILABLE") {
      showSaveNotice({ kind: "unavailable", message });
    } else if (
      code === "CONTENT_INVALID" ||
      code === "VALIDATION_FAILED" ||
      code === "REFERENCE_INVALID"
    ) {
      const path =
        code === "REFERENCE_INVALID"
          ? null
          : formFieldForApiField(error instanceof ApiError ? error.field : undefined);
      // A path with no rendered input (an item index the draft does not have, or the attendance
      // overview, which is saved unchanged and has no field) gets the banner.
      const current: unknown =
        path === null || path === "attendanceOverview" ? undefined : form.getValues(path);
      if (!areFieldsShown || path === null || current === undefined) {
        showSaveNotice({ kind: "invalid", message });
      } else {
        form.setError(path, { type: "server", message });
        setFieldErrorFocus((previous) => ({ path, request: (previous?.request ?? 0) + 1 }));
      }
    } else {
      showSaveNotice({ kind: "failed", message });
    }
  };

  // Lost response: one re-read decides whether exactly the submitted text was saved (F5).
  const reconcile = async (submitted: BriefingFormOutput) => {
    setChecking(true);
    try {
      const result = await refetch();
      if (result.isError || result.data === undefined) {
        showSaveNotice({ kind: "check-failed", message: describeApiError(result.error) });
      } else if (draftMatchesSaved(submitted, generationId, result.data.savedBriefing)) {
        form.reset(submitted);
        onSaved({ reconciled: true });
      } else {
        showSaveNotice({ kind: "unconfirmed" });
      }
    } finally {
      setChecking(false);
    }
  };

  const saveDraft = async (values: BriefingFormOutput) => {
    if (inFlight.current) return;
    inFlight.current = true;
    lastSubmitted.current = values;
    setNotice(null);
    try {
      // The draft's own base revision, never a refreshed one: a save elsewhere is a conflict (F5-06).
      await save.mutateAsync(toSaveRequest(values, generationId, base.briefingRevision));
      form.reset(values);
      onSaved({ reconciled: false });
    } catch (error) {
      if (error instanceof ApiError && error.outcomeUnknown) {
        await reconcile(values);
        return;
      }
      showFailure(error);
    } finally {
      inFlight.current = false;
    }
  };

  // Client-side errors land on their fields; without text areas on screen (Accept preview) they
  // would be invisible, so the banner says where to look.
  const showHiddenInvalid = () => {
    if (!areFieldsShown) {
      showSaveNotice({
        kind: "invalid",
        message: "Some text cannot be saved as it is. Select Edit to see which.",
      });
    }
  };
  const submit = (event?: BaseSyntheticEvent) =>
    form.handleSubmit(saveDraft, showHiddenInvalid)(event);

  /** After a failed re-read: check again whether exactly the last submitted text was saved. */
  const checkAgain = async () => {
    const submitted = lastSubmitted.current;
    if (submitted === null || inFlight.current) return;
    inFlight.current = true;
    setNotice(null);
    try {
      await reconcile(submitted);
    } finally {
      inFlight.current = false;
    }
  };

  const discard = () => {
    onReset();
    form.reset();
    setNotice(null);
  };

  /** After a conflict: load the latest briefing, then drop the draft. Resolves true if it did. */
  const reloadLatest = async (): Promise<boolean> => {
    setChecking(true);
    try {
      const result = await refetch();
      if (result.isError || result.data === undefined) {
        const reason = describeApiError(result.error);
        setNotice((current) =>
          current?.kind === "conflict" || current?.kind === "unavailable"
            ? {
                ...current,
                message: `${current.message} The latest briefing could not be loaded, so your text is kept: ${reason}`,
              }
            : current,
        );
        return false;
      }
      onReset();
      form.reset();
      setNotice(null);
      return true;
    } finally {
      setChecking(false);
    }
  };

  const isSaving = save.isPending || checking;
  // A clean editor keeps its base while saving and while a conflict or unavailable notice waits for
  // Reload, or a failed check for Check again; the panel would otherwise follow the refreshed view
  // and remount it without the notice. ("unconfirmed" has no action, so it does not hold.)
  const holdsBase =
    isSaving ||
    notice?.kind === "conflict" ||
    notice?.kind === "unavailable" ||
    notice?.kind === "check-failed";
  const setBriefingHeld = useUiStore((state) => state.setBriefingHeld);
  useEffect(() => {
    setBriefingHeld(holdsBase);
  }, [holdsBase, setBriefingHeld]);
  useEffect(
    () => () => {
      setBriefingHeld(false);
    },
    [setBriefingHeld],
  );
  return {
    form,
    isDirty,
    isSaving,
    isBusy: isSaving,
    // While the last save's outcome is unknown, typing on top of it is not meaningful: "Check again"
    // may find it landed and reset to the submitted text. Check again and Discard stay available.
    areFieldsLocked: isSaving || notice?.kind === "check-failed",
    notice,
    noticeFocusRequest,
    fieldErrorFocus,
    submit,
    checkAgain,
    discard,
    reloadLatest,
  };
}
