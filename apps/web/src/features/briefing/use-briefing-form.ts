import { zodResolver } from "@hookform/resolvers/zod";
import type { EventId } from "@event-desk/contracts";
import { type BaseSyntheticEvent, useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { ApiError, describeApiError } from "../../data/http/api-error";
import { useSaveBriefing } from "../../data/mutations/use-save-briefing";
import { useBeforeUnloadWarning } from "../../shared/hooks/use-before-unload-warning";
import { useUiStore } from "../../state/ui-store";
import type { RefetchEvent } from "../attendance/use-attendance-form";
import {
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
 */
export function useBriefingForm(
  eventId: EventId,
  base: EditorBase,
  refetch: RefetchEvent,
  onSaved: (outcome: { reconciled: boolean }) => void,
) {
  const form = useForm<BriefingFormValues, unknown, BriefingFormOutput>({
    resolver: zodResolver(BriefingFormSchema),
    defaultValues: toFormValues(base.briefing.content),
  });
  const { isDirty } = form.formState;
  // Synchronous double-submit guard: React state (isPending) lags a fast second click.
  const inFlight = useRef(false);
  const [notice, setNotice] = useState<BriefingNotice | null>(null);
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
      setNotice({ kind: "conflict", message });
    } else if (code === "GENERATION_NOT_AVAILABLE") {
      setNotice({ kind: "unavailable", message });
    } else if (
      code === "CONTENT_INVALID" ||
      code === "VALIDATION_FAILED" ||
      code === "REFERENCE_INVALID"
    ) {
      const path =
        code === "REFERENCE_INVALID"
          ? null
          : formFieldForApiField(error instanceof ApiError ? error.field : undefined);
      if (path === null) setNotice({ kind: "invalid", message });
      else form.setError(path, { type: "server", message }, { shouldFocus: true });
    } else {
      setNotice({ kind: "failed", message });
    }
  };

  // Lost response: one re-read decides whether exactly the submitted text was saved (F5).
  const reconcile = async (submitted: BriefingFormOutput) => {
    setChecking(true);
    try {
      const result = await refetch();
      if (result.isError || result.data === undefined) {
        setNotice({ kind: "check-failed", message: describeApiError(result.error) });
      } else if (draftMatchesSaved(submitted, generationId, result.data.savedBriefing)) {
        form.reset(submitted);
        onSaved({ reconciled: true });
      } else {
        setNotice({ kind: "unconfirmed" });
      }
    } finally {
      setChecking(false);
    }
  };

  const saveDraft = async (values: BriefingFormOutput) => {
    if (inFlight.current) return;
    inFlight.current = true;
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

  const submit = (event?: BaseSyntheticEvent) => form.handleSubmit(saveDraft)(event);

  const discard = () => {
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
      form.reset();
      setNotice(null);
      return true;
    } finally {
      setChecking(false);
    }
  };

  const isSaving = save.isPending || checking;
  return { form, isDirty, isSaving, isBusy: isSaving, notice, submit, discard, reloadLatest };
}
