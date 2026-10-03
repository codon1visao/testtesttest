import { Banner } from "@astryxdesign/core/Banner";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { VStack } from "@astryxdesign/core/Layout";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { Heading, Text } from "@astryxdesign/core/Text";
import type { BriefingView, EventId, EventView, GenerationId } from "@event-desk/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { useIsSavingBriefing } from "../../data/mutations/use-save-briefing";
import { useSelectPreview } from "../../data/mutations/use-select-preview";
import { ConfirmDialog } from "../../shared/ui/confirm-dialog";
import { type ActiveView, useUiStore } from "../../state/ui-store";
import type { RefetchEvent } from "../attendance/use-attendance-form";
import type { EditableSlot } from "./active-briefing";
import { BriefingEditor } from "./briefing-editor";
import { type EditorBase, editorKey, toEditorBase } from "./briefing-form-model";
import { BriefingPreview } from "./briefing-preview";
import { GenerateBriefingControl } from "./generate-briefing-control";
import { IncomingPreviewNotice } from "./incoming-preview-notice";

/** An explicit choice of editor base, adopted once the view shows it in that slot. */
interface OpenedBase {
  slot: EditableSlot;
  generationId: GenerationId;
}

const VIEW_OF_SLOT: Record<EditableSlot, ActiveView> = { selected: "preview", saved: "saved" };

function isActiveView(value: string): value is ActiveView {
  return value === "preview" || value === "saved";
}

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
  const activeView = useUiStore((state) => state.activeView);
  const setActiveView = useUiStore((state) => state.setActiveView);
  const latest = toEditorBase(view, activeView);
  const [base, setBase] = useState<EditorBase | null>(latest);
  // This tab's explicit choice (a successful review, or a switch between preview and saved
  // briefing), until the view shows it in the editor's slot.
  const [opened, setOpened] = useState<OpenedBase | null>(null);
  // A clean editor follows the saved records; a dirty draft keeps its base until save, discard or
  // explicit choice (T3 §11). Adjusted during render, React's pattern for state derived from props.
  // An explicit select is adopted from the view, not from the response: the response arrives before
  // the refreshed view, and a base ahead of the view would be pulled back to the old one as soon as
  // the remounted editor reports itself clean.
  if (
    opened !== null &&
    latest?.slot === opened.slot &&
    latest.briefing.provenance.generationId === opened.generationId
  ) {
    setOpened(null);
    if (editorKey(base) !== editorKey(latest)) setBase(latest);
  } else if (!briefingDirty && editorKey(base) !== editorKey(latest)) setBase(latest);
  // A choice whose result the view moved past without showing it (another tab acted meanwhile)
  // is dropped, so it can never switch the editor later.
  const incoming = view.incomingPreview;
  if (
    opened !== null &&
    incoming?.provenance.generationId !== opened.generationId &&
    latest?.briefing.provenance.generationId !== opened.generationId
  ) {
    setOpened(null);
  }
  // The incoming generation this tab is opening automatically: no notice for it, and the editor's
  // fields are locked meanwhile (no draft is typed on a base the select is about to replace).
  const [autoSelecting, setAutoSelecting] = useState<GenerationId | null>(null);
  const select = useSelectPreview(eventId);
  // Done once the view shows it selected. Not on settle: the response arrives before the view, and
  // the notice would flash for the stale incoming slot. A settled select the view moved past (it is
  // neither waiting nor shown any more: another tab acted) is dropped, so the lock never lingers.
  if (
    autoSelecting !== null &&
    (latest?.briefing.provenance.generationId === autoSelecting ||
      (!select.isPending && incoming?.provenance.generationId !== autoSelecting))
  ) {
    setAutoSelecting(null);
  }
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
  // The editor stays on the briefing the coordinator just worked on, even when another tab selected
  // a preview meanwhile; saving a selected preview empties its slot, so the saved briefing shows.
  const onSaved = useCallback(
    ({ reconciled: wasReconciled }: { reconciled: boolean }) => {
      pendingFocus.current = "remount";
      setReconciled(wasReconciled);
      if (base !== null) setActiveView(VIEW_OF_SLOT[base.slot]);
    },
    [base, setActiveView],
  );
  const onReset = useCallback(() => {
    pendingFocus.current = "reset";
    if (base !== null) setActiveView(VIEW_OF_SLOT[base.slot]);
  }, [base, setActiveView]);
  // A reset that did not remount the editor leaves its request behind: clear it once the dirty flag
  // settles. A remount on the same commit consumes it first (child effects run before this one).
  useEffect(() => {
    if (pendingFocus.current === "reset") pendingFocus.current = null;
  }, [briefingDirty]);
  // A review that ended without a remount (dropped, or the editor already showed it) leaves its
  // focus request behind: clear it, so a later unrelated remount does not take focus. An adopting
  // remount on the same commit consumes it first (child effects run before this one).
  const previousOpened = useRef<OpenedBase | null>(null);
  useEffect(() => {
    if (previousOpened.current !== null && opened === null && pendingFocus.current === "remount") {
      pendingFocus.current = null;
    }
    previousOpened.current = opened;
  }, [opened]);

  // F6 race 3: a select expects the selection this tab works on — the editor's base when that is the
  // selected preview, else the selected preview on screen — never a newer one another tab made.
  const expectedSelection =
    base?.slot === "selected"
      ? base.briefing.provenance.generationId
      : (view.selectedPreview?.provenance.generationId ?? null);
  // Read when a select starts: Generate's result arrives in a callback from an earlier render.
  const expectedSelectionRef = useRef(expectedSelection);
  useEffect(() => {
    expectedSelectionRef.current = expectedSelection;
  });
  // The chosen base replaces the draft the coordinator chose to discard, as soon as the view
  // (already updated in the cache) shows it. An explicit choice always changes the editor key, so the
  // focus request waits for that remount.
  const adopt = (target: OpenedBase) => {
    pendingFocus.current = "remount";
    setOpened(target);
  };
  /** The coordinator chose to review this selected preview: the editor works on the preview. */
  const adoptSelected = (generationId: GenerationId) => {
    setActiveView("preview");
    adopt({ slot: "selected", generationId });
  };
  // `explicit`: the coordinator pressed Review new preview (and confirmed any discard). Only then
  // does the new preview replace a dirty draft, and the editor heading take focus.
  const openPreview = (generationId: GenerationId, explicit: boolean) => {
    const body = { generationId, expectedSelectedGenerationId: expectedSelectionRef.current };
    select.mutate(body, {
      onSuccess: (response) => {
        if (explicit) adoptSelected(response.selectedPreview.provenance.generationId);
        // A clean editor follows the view to the preview it chose to review.
        else setActiveView("preview");
      },
      onError: () => {
        // The preview is still waiting for review: announce it again.
        if (!explicit) setAutoSelecting(null);
      },
    });
  };
  // F4 step 7: only a clean editor follows this tab's own result; the flag is read on arrival.
  // The clean editor then follows the view like any other clean editor; its fields stay locked
  // while the select is in flight. Auto-select never moves focus: it stays on the Generate button.
  const autoSelect = (preview: BriefingView) => {
    if (useUiStore.getState().briefingDirty) return;
    setAutoSelecting(preview.provenance.generationId);
    openPreview(preview.provenance.generationId, false);
  };

  // Spec 05 "saved briefing stays available": with both a selected preview and a saved briefing,
  // the coordinator chooses which one the editor works on. Switching is an explicit choice: a
  // dirty draft asks first (F5-10, F6), and the editor heading takes focus after the remount.
  const isSavingBriefing = useIsSavingBriefing(eventId);
  const [confirmingSwitch, setConfirmingSwitch] = useState<ActiveView | null>(null);
  const switchTo = (target: ActiveView) => {
    const next = toEditorBase(view, target);
    setActiveView(target);
    if (next !== null)
      adopt({ slot: next.slot, generationId: next.briefing.provenance.generationId });
  };
  const canSwitch = base !== null && view.selectedPreview !== null && view.savedBriefing !== null;

  // F6-09: what waits for review. Normally the incoming preview. If a preview became selected while
  // this editor is dirty (another tab selected it), it is announced instead: it is already
  // selected, so reviewing it only switches the editor (no second select).
  const selectedAhead =
    briefingDirty &&
    latest?.slot === "selected" &&
    editorKey(base) !== editorKey(latest) &&
    base?.briefing.provenance.generationId !== latest.briefing.provenance.generationId
      ? latest.briefing
      : null;
  const announced =
    incoming !== null && incoming.provenance.generationId !== autoSelecting
      ? incoming
      : selectedAhead;
  const announcedIsIncoming = announced !== null && announced === incoming;

  return (
    <section aria-label="Briefing">
      <VStack gap={3}>
        <Heading level={2}>Briefing</Heading>
        <GenerateBriefingControl eventId={eventId} view={view} onGenerated={autoSelect} />
        {announced === null ? null : (
          <IncomingPreviewNotice
            key={announced.provenance.generationId}
            preview={announced}
            isDirty={briefingDirty}
            isOpening={announcedIsIncoming && select.isPending}
            onReview={() => {
              const generationId = announced.provenance.generationId;
              if (announcedIsIncoming) openPreview(generationId, true);
              else adoptSelected(generationId);
            }}
          />
        )}
        {reconciled ? <Banner status="success" title="Your briefing changes were saved." /> : null}
        {canSwitch ? (
          <div>
            <Text type="supporting">Briefing to show</Text>
            <SegmentedControl
              label="Briefing to show"
              value={VIEW_OF_SLOT[base.slot]}
              isDisabled={autoSelecting !== null || select.isPending || isSavingBriefing}
              onChange={(value) => {
                if (!isActiveView(value)) return;
                if (briefingDirty) setConfirmingSwitch(value);
                else switchTo(value);
              }}
            >
              <SegmentedControlItem value="preview" label="Generated preview" />
              <SegmentedControlItem value="saved" label="Saved briefing" />
            </SegmentedControl>
          </div>
        ) : null}
        {/* Before the editor: the dialog returns focus to its trigger as it closes, and the
            remounted editor's heading must take focus after that. */}
        <ConfirmDialog
          isOpen={confirmingSwitch !== null}
          title="Discard your edits and switch?"
          description="Your unsaved wording will be lost. Cancel to keep editing; you can save it first."
          actionLabel="Discard and switch"
          onCancel={() => {
            setConfirmingSwitch(null);
          }}
          onConfirm={() => {
            const target = confirmingSwitch;
            setConfirmingSwitch(null);
            if (target !== null) switchTo(target);
          }}
        />
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
            isLocked={autoSelecting !== null}
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
