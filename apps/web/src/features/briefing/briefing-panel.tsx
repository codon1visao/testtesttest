import { Banner } from "@astryxdesign/core/Banner";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { VStack } from "@astryxdesign/core/Layout";
import { Heading } from "@astryxdesign/core/Text";
import type { BriefingView, EventId, EventView, GenerationId } from "@event-desk/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSelectPreview } from "../../data/mutations/use-select-preview";
import { useUiStore } from "../../state/ui-store";
import type { RefetchEvent } from "../attendance/use-attendance-form";
import { BriefingEditor } from "./briefing-editor";
import { type EditorBase, editorKey, toEditorBase } from "./briefing-form-model";
import { BriefingPreview } from "./briefing-preview";
import { GenerateBriefingControl } from "./generate-briefing-control";
import { IncomingPreviewNotice } from "./incoming-preview-notice";

/**
 * The briefing workspace (F4–F7): Generate, the incoming candidate, and one editor for the
 * selected preview or the saved briefing. Nothing replaces unsaved text without an explicit choice.
 */
export function BriefingPanel({
  eventId,
  view,
  refetch,
}: {
  eventId: EventId;
  view: EventView;
  refetch: RefetchEvent;
}) {
  const briefingDirty = useUiStore((state) => state.briefingDirty);
  const latest = toEditorBase(view);
  const [base, setBase] = useState<EditorBase | null>(latest);
  // This tab's successful explicit review, until the view shows it as the selected preview.
  const [opened, setOpened] = useState<GenerationId | null>(null);
  // A clean editor follows the saved records; a dirty draft keeps its base until save, discard or
  // explicit select (T3 §11). Adjusted during render, React's pattern for state derived from props.
  // An explicit select is adopted from the view, not from the response: the response arrives before
  // the refreshed view, and a base ahead of the view would be pulled back to the old one as soon as
  // the remounted editor reports itself clean.
  if (
    opened !== null &&
    latest?.slot === "selected" &&
    latest.briefing.provenance.generationId === opened
  ) {
    setOpened(null);
    if (editorKey(base) !== editorKey(latest)) setBase(latest);
  } else if (!briefingDirty && editorKey(base) !== editorKey(latest)) setBase(latest);
  // "Your briefing changes were saved." stays until the next edit starts. The dirty flag lags the
  // form by one effect, so clear on the clean→dirty transition, not on "dirty" itself.
  const [reconciled, setReconciled] = useState(false);
  const [wasDirty, setWasDirty] = useState(briefingDirty);
  if (briefingDirty !== wasDirty) {
    setWasDirty(briefingDirty);
    if (briefingDirty) setReconciled(false);
  }
  // The next editor focuses its heading after this tab's own action, so focus never falls to <body>.
  // "remount": a save (or select) always changes the editor key; the saved view can reach this panel
  // after the dirty flag settles, so the request waits for the remount that consumes it.
  // "reset": a discard or reload remounts only if the server moved on meanwhile.
  const pendingFocus = useRef<"remount" | "reset" | null>(null);
  const consumePendingFocus = useCallback(() => {
    const pending = pendingFocus.current !== null;
    pendingFocus.current = null;
    return pending;
  }, []);
  const onSaved = useCallback(({ reconciled: wasReconciled }: { reconciled: boolean }) => {
    pendingFocus.current = "remount";
    setReconciled(wasReconciled);
  }, []);
  const onReset = useCallback(() => {
    pendingFocus.current = "reset";
  }, []);
  // A reset that did not remount the editor leaves its request behind: clear it once the dirty flag
  // settles. A remount on the same commit consumes it first (child effects run before this one).
  useEffect(() => {
    if (pendingFocus.current === "reset") pendingFocus.current = null;
  }, [briefingDirty]);

  const select = useSelectPreview(eventId);
  // `explicit`: the coordinator pressed Review new preview (and confirmed any discard). Only then
  // does the new preview replace a dirty draft, and the editor heading take focus.
  const openPreview = (generationId: GenerationId, explicit: boolean) => {
    select.mutate(generationId, {
      onSuccess: (response) => {
        if (!explicit) return;
        // The new preview replaces the draft the coordinator chose to discard, as soon as the view
        // (already updated in the cache) reaches this panel. A select always changes the editor
        // key, so the focus request waits for that remount.
        pendingFocus.current = "remount";
        setOpened(response.selectedPreview.provenance.generationId);
      },
    });
  };
  // F4 step 7: only a clean editor follows this tab's own result; the flag is read on arrival.
  // The clean editor then follows the view like any other clean editor, so text typed while the
  // select is in flight is kept. Auto-select never moves focus: it stays on the Generate button.
  const autoSelect = (preview: BriefingView) => {
    if (!useUiStore.getState().briefingDirty) openPreview(preview.provenance.generationId, false);
  };

  const incoming = view.incomingPreview;

  return (
    <section aria-label="Briefing">
      <VStack gap={3}>
        <Heading level={2}>Briefing</Heading>
        <GenerateBriefingControl eventId={eventId} view={view} onGenerated={autoSelect} />
        {incoming === null ? null : (
          <IncomingPreviewNotice
            preview={incoming}
            isDirty={briefingDirty}
            isOpening={select.isPending}
            onReview={() => {
              openPreview(incoming.provenance.generationId, true);
            }}
          />
        )}
        {reconciled ? <Banner status="success" title="Your briefing changes were saved." /> : null}
        {base !== null ? (
          <BriefingEditor
            key={editorKey(base)}
            eventId={eventId}
            view={view}
            base={base}
            refetch={refetch}
            onSaved={onSaved}
            onReset={onReset}
            consumePendingFocus={consumePendingFocus}
          />
        ) : incoming !== null ? (
          <BriefingPreview title="New preview (not yet reviewed)" briefing={incoming} view={view} />
        ) : (
          <EmptyState
            isCompact
            headingLevel={3}
            title="No briefing yet"
            description="Press Generate briefing to create one from the saved records."
          />
        )}
      </VStack>
    </section>
  );
}
