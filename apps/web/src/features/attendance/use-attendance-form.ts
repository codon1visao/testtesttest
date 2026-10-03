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
  | { kind: "conflict"; message: string }
  | { kind: "failed"; message: string }
  | { kind: "unconfirmed" }
  | { kind: "confirmed" };

export type RefetchEvent = () => Promise<{ data?: EventView | undefined }>;

/**
 * The attendance draft (React Hook Form) and its save flow (F2). The draft remembers the revision it
 * was based on, so a save after someone else's change conflicts instead of overwriting it.
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

  const saveDraft = async (values: AttendanceFormOutput) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setNotice(null);
    try {
      const saved = await save.mutateAsync(toSaveRequest(values, baseRevision.current));
      resetTo(saved.members, saved.attendanceRevision);
    } catch (error) {
      if (error instanceof ApiError && error.outcomeUnknown) {
        const latest = (await refetch()).data;
        if (latest !== undefined && draftMatchesSaved(form.getValues(), latest.members)) {
          resetTo(latest.members, latest.attendanceRevision);
          setNotice({ kind: "confirmed" });
        } else {
          setNotice({ kind: "unconfirmed" });
        }
        return;
      }
      const message = describeApiError(error);
      setNotice(
        error instanceof ApiError && error.code === "ATTENDANCE_CONFLICT"
          ? { kind: "conflict", message }
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

  const reloadSaved = async () => {
    const latest = (await refetch()).data;
    if (latest !== undefined) resetTo(latest.members, latest.attendanceRevision);
    setNotice(null);
  };

  return { form, draft, isDirty, isSaving: save.isPending, notice, submit, discard, reloadSaved };
}
