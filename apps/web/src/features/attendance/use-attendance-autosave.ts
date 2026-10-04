import type { AttendanceStatus, EventId, EventView, MemberId } from "@event-desk/contracts";
import { useEffect, useRef, useState } from "react";
import { ApiError, describeApiError } from "../../data/http/api-error";
import { useSaveAttendance } from "../../data/mutations/use-save-attendance";
import { useBeforeUnloadWarning } from "../../shared/hooks/use-before-unload-warning";
import { useUiStore } from "../../state/ui-store";
import {
  type MemberAttendance,
  submittedMatchesSaved,
  toSaveRequest,
  withMemberStatus,
} from "./attendance-form-model";

/** Each notice names the member whose change it is about. */
export type AttendanceNotice =
  | { kind: "failed"; name: string; message: string }
  /** `reloadError`: the re-read after the conflict failed as well. */
  | { kind: "conflict"; name: string; reloadError: string | null }
  | { kind: "confirmed"; name: string }
  | { kind: "unconfirmed"; name: string }
  | { kind: "check-failed"; name: string; message: string };

/** TanStack's `refetch`: it never rejects; `isError` and `error` say whether the re-read failed. */
export type RefetchEvent = () => Promise<{
  data?: EventView | undefined;
  isError: boolean;
  error: ApiError | null;
}>;

/** Saved records with the revision they belong to. */
interface SavedAttendance {
  members: readonly MemberAttendance[];
  revision: number;
}

/** A change being saved, or whose outcome is not known yet: shown in place of the saved records. */
interface PendingChange {
  name: string;
  members: MemberAttendance[];
}

/**
 * Attendance saves on each change (F2, amended 2026-10-04): a choice sends every member with the
 * saved revision at once. While a save or its re-read is in flight nothing else can change and
 * Generate waits; a failure reverts, a conflict reloads, a lost response is re-read.
 */
export function useAttendanceAutosave(eventId: EventId, view: EventView, refetch: RefetchEvent) {
  // A save's response (or a re-read) can arrive before the view shows it: the newer revision wins,
  // so the Selectors never flash back to the previous records.
  const [adopted, setAdopted] = useState<SavedAttendance | null>(null);
  const saved: SavedAttendance =
    adopted !== null && adopted.revision > view.attendanceRevision
      ? adopted
      : { members: view.members, revision: view.attendanceRevision };
  const [pending, setPending] = useState<PendingChange | null>(null);
  const [checking, setChecking] = useState(false);
  const [notice, setNotice] = useState<AttendanceNotice | null>(null);
  // Synchronous double-submit guard: React state (isPending) lags a fast second change.
  const inFlight = useRef(false);
  const save = useSaveAttendance(eventId);
  const setAttendanceDirty = useUiStore((state) => state.setAttendanceDirty);

  // Not settled until the save's outcome is known: Generate waits and leaving asks first.
  const isUnsettled = pending !== null;
  useEffect(() => {
    setAttendanceDirty(isUnsettled);
  }, [isUnsettled, setAttendanceDirty]);
  useEffect(
    () => () => {
      setAttendanceDirty(false);
    },
    [setAttendanceDirty],
  );
  useBeforeUnloadWarning(isUnsettled);

  const adopt = (data: Pick<EventView, "members" | "attendanceRevision">) => {
    setAdopted({ members: data.members, revision: data.attendanceRevision });
  };

  // Lost response: one re-read decides whether exactly the submitted statuses were saved. If the
  // re-read fails, the outcome stays unknown: the change stays shown and locked until a check works.
  const reconcile = async (change: PendingChange): Promise<boolean> => {
    setChecking(true);
    try {
      const result = await refetch();
      if (result.isError || result.data === undefined) {
        setNotice({
          kind: "check-failed",
          name: change.name,
          message: describeApiError(result.error),
        });
        return false;
      }
      adopt(result.data);
      setPending(null);
      setNotice(
        submittedMatchesSaved(change.members, result.data.members)
          ? { kind: "confirmed", name: change.name }
          : { kind: "unconfirmed", name: change.name },
      );
      return true;
    } finally {
      setChecking(false);
    }
  };

  // Conflict: show the latest saved records; if they cannot be read, the last known ones.
  const reloadAfterConflict = async (name: string) => {
    setChecking(true);
    try {
      const result = await refetch();
      if (result.isError || result.data === undefined) {
        setNotice({ kind: "conflict", name, reloadError: describeApiError(result.error) });
      } else {
        adopt(result.data);
        setNotice({ kind: "conflict", name, reloadError: null });
      }
      setPending(null);
    } finally {
      setChecking(false);
    }
  };

  const change = async (memberId: MemberId, name: string, attendance: AttendanceStatus) => {
    if (inFlight.current || pending !== null) return;
    const current = saved.members.find((m) => m.id === memberId);
    if (current === undefined || current.attendance === attendance) return;
    inFlight.current = true;
    const submitted: PendingChange = {
      name,
      members: withMemberStatus(saved.members, memberId, attendance),
    };
    setPending(submitted);
    try {
      // Rule: the base is the saved revision on screen, never a refreshed one, so a change saved
      // elsewhere meanwhile surfaces as a conflict instead of being overwritten (F2).
      const response = await save.mutateAsync(toSaveRequest(submitted.members, saved.revision));
      adopt(response);
      setPending(null);
      setNotice(null);
    } catch (error) {
      if (error instanceof ApiError && error.outcomeUnknown) {
        await reconcile(submitted);
      } else if (error instanceof ApiError && error.code === "ATTENDANCE_CONFLICT") {
        await reloadAfterConflict(name);
      } else {
        setPending(null);
        setNotice({ kind: "failed", name, message: describeApiError(error) });
      }
    } finally {
      inFlight.current = false;
    }
  };

  /** After a failed re-read: check again. Resolves true once the outcome is known. */
  const checkAgain = async (): Promise<boolean> => {
    if (pending === null || inFlight.current) return false;
    inFlight.current = true;
    try {
      return await reconcile(pending);
    } finally {
      inFlight.current = false;
    }
  };

  return {
    /** What the Selectors and tiles show: the change in flight, else the saved records. */
    members: pending?.members ?? saved.members,
    /** A save or a re-read is in flight. */
    isSaving: save.isPending || checking,
    /** A re-read is in flight (Check again shows loading). */
    isChecking: checking,
    /** The Selectors are locked: a save is in flight or its outcome is not known yet. */
    isLocked: isUnsettled,
    notice,
    change,
    checkAgain,
  };
}
