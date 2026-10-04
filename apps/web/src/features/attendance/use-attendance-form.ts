import { zodResolver } from "@hookform/resolvers/zod";
import type { EventId, EventView, Member } from "@event-desk/contracts";
import { type BaseSyntheticEvent, useCallback, useEffect, useRef, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { ApiError, describeApiError } from "../../data/http/api-error";
import { useSaveAttendance } from "../../data/mutations/use-save-attendance";
import { useBeforeUnloadWarning } from "../../shared/hooks/use-before-unload-warning";
import { useUiStore } from "../../state/ui-store";
import {
  AttendanceFormSchema,
  type AttendanceFormOutput,
  type AttendanceFormValues,
  draftMatchesSaved,
  toFormValues,
  toSaveRequest,
} from "./attendance-form-model";

export type AttendanceNotice =
  /** `staleRevision`: the draft's base revision that conflicted. `reloadError`: a failed reload. */
  | { kind: "conflict"; message: string; staleRevision: number; reloadError: string | null }
  | { kind: "failed"; message: string }
  | { kind: "unconfirmed" }
  | { kind: "check-failed"; message: string }
  | { kind: "confirmed" };

/** TanStack's `refetch`: it never rejects; `isError` and `error` say whether the re-read failed. */
export type RefetchEvent = () => Promise<{
  data?: EventView | undefined;
  isError: boolean;
  error: ApiError | null;
}>;

/** A re-read of the saved records in progress: after a lost response, or a confirmed reload. */
type SavedCheck = "reconcile" | "reload";

/**
 * The attendance draft (React Hook Form) and its explicit save flow (F2, explicit save restored
 * 2026-10-04). The draft remembers the revision it was based on, so a save after someone else's
 * change conflicts instead of overwriting it.
 */
export function useAttendanceForm(eventId: EventId, view: EventView, refetch: RefetchEvent) {
  const form = useForm<AttendanceFormValues, unknown, AttendanceFormOutput>({
    resolver: zodResolver(AttendanceFormSchema),
    defaultValues: toFormValues(view.members),
  });
  // The roster is fixed (F2: no add/remove), so the draft is watched directly; no useFieldArray.
  const draft = useWatch({ control: form.control, name: "members" });
  const { isDirty } = form.formState;
  const baseRevision = useRef(view.attendanceRevision);
  // Synchronous double-submit guard: React state (isPending) lags a fast second click.
  const inFlight = useRef(false);
  const [notice, setNotice] = useState<AttendanceNotice | null>(null);
  const [check, setCheck] = useState<SavedCheck | null>(null);
  // Counts saves that left the form clean: Save changes is then disabled, so the panel moves focus
  // off it (a natively disabled button drops focus to <body>). A request counter.
  const [savedFocusRequest, setSavedFocusRequest] = useState(0);
  const requestSavedFocus = () => {
    setSavedFocusRequest((count) => count + 1);
  };
  const save = useSaveAttendance(eventId);
  const setAttendanceDirty = useUiStore((state) => state.setAttendanceDirty);

  const resetTo = useCallback(
    (members: readonly Pick<Member, "id" | "attendance">[], revision: number) => {
      form.reset(toFormValues(members));
      baseRevision.current = revision;
    },
    [form],
  );

  // Newer saved data replaces a CLEAN form only; a dirty draft is never overwritten by a refetch.
  // Re-checked when the draft turns clean, so a draft reverted by hand follows data that arrived meanwhile.
  useEffect(() => {
    if (!isDirty) resetTo(view.members, view.attendanceRevision);
  }, [isDirty, resetTo, view.members, view.attendanceRevision]);
  // A clean form has adopted saved records newer than the conflicting draft: the conflict is gone.
  // Adjusted during render (React's pattern for state derived from props), not in the effect above.
  if (notice?.kind === "conflict" && !isDirty && view.attendanceRevision > notice.staleRevision) {
    setNotice(null);
  }

  useEffect(() => {
    setAttendanceDirty(isDirty);
  }, [isDirty, setAttendanceDirty]);
  useEffect(
    () => () => {
      setAttendanceDirty(false);
    },
    [setAttendanceDirty],
  );
  useBeforeUnloadWarning(isDirty);

  // Lost response: one re-read decides whether the submitted values were saved. The form stays
  // locked meanwhile, so the verdict is about exactly what was sent.
  const reconcile = async (submitted: AttendanceFormOutput) => {
    setCheck("reconcile");
    try {
      const result = await refetch();
      if (result.isError || result.data === undefined) {
        setNotice({ kind: "check-failed", message: describeApiError(result.error) });
      } else if (draftMatchesSaved(submitted, result.data.members)) {
        resetTo(result.data.members, result.data.attendanceRevision);
        setNotice({ kind: "confirmed" });
        requestSavedFocus();
      } else {
        setNotice({ kind: "unconfirmed" });
      }
    } finally {
      setCheck(null);
    }
  };

  const saveDraft = async (values: AttendanceFormOutput) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setNotice(null);
    // Rule: a save (and a retry) carries the draft's base revision, never a refreshed one, so a
    // change saved elsewhere meanwhile surfaces as a conflict instead of being overwritten (F2).
    const draftRevision = baseRevision.current;
    try {
      const saved = await save.mutateAsync(toSaveRequest(values, draftRevision));
      resetTo(saved.members, saved.attendanceRevision);
      requestSavedFocus();
    } catch (error) {
      if (error instanceof ApiError && error.outcomeUnknown) {
        await reconcile(values);
        return;
      }
      const message = describeApiError(error);
      setNotice(
        error instanceof ApiError && error.code === "ATTENDANCE_CONFLICT"
          ? { kind: "conflict", message, staleRevision: draftRevision, reloadError: null }
          : { kind: "failed", message },
      );
    } finally {
      inFlight.current = false;
    }
  };

  // handleSubmit is bound at submit time, not during render, so the refs are touched only in the handler.
  const submit = (event?: BaseSyntheticEvent) => form.handleSubmit(saveDraft)(event);

  const discard = () => {
    resetTo(view.members, view.attendanceRevision);
    setNotice(null);
  };

  /** After a conflict: replace the draft with the latest saved records. Resolves true if it did. */
  const reloadSaved = async (): Promise<boolean> => {
    setCheck("reload");
    try {
      const result = await refetch();
      if (result.isError || result.data === undefined) {
        // Keep the draft and the conflict; say why the reload did not happen.
        const reloadError = describeApiError(result.error);
        setNotice((current) =>
          current?.kind === "conflict" ? { ...current, reloadError } : current,
        );
        return false;
      }
      resetTo(result.data.members, result.data.attendanceRevision);
      setNotice(null);
      return true;
    } finally {
      setCheck(null);
    }
  };

  const isSaving = save.isPending || check === "reconcile";
  return {
    form,
    draft,
    isDirty,
    savedFocusRequest,
    /** Save is in flight or its outcome is being checked: Save shows loading. */
    isSaving,
    /** Any save or re-read in flight: inputs and actions are locked. */
    isBusy: isSaving || check !== null,
    notice,
    submit,
    discard,
    reloadSaved,
  };
}
