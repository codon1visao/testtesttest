import { Banner } from "@astryxdesign/core/Banner";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { VStack } from "@astryxdesign/core/Layout";
import { Heading } from "@astryxdesign/core/Text";
import type { EventId, EventView } from "@event-desk/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { useUiStore } from "../../state/ui-store";
import type { RefetchEvent } from "../attendance/use-attendance-form";
import { BriefingEditor } from "./briefing-editor";
import { type EditorBase, editorKey, toEditorBase } from "./briefing-form-model";
import { BriefingPreview } from "./briefing-preview";
import { GenerateBriefingControl } from "./generate-briefing-control";

/** Generate/Retry, the briefing editor (F5) and the incoming preview. Task 8 adds select and layout. */
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
  // A clean editor follows the saved records; a dirty draft keeps its base until save, discard or
  // explicit select (T3 §11). Adjusted during render, React's pattern for state derived from props.
  if (!briefingDirty && editorKey(base) !== editorKey(latest)) setBase(latest);
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

  return (
    <section aria-label="Briefing">
      <VStack gap={3}>
        <Heading level={2}>Briefing</Heading>
        <GenerateBriefingControl eventId={eventId} view={view} />
        {reconciled ? <Banner status="success" title="Your briefing changes were saved." /> : null}
        {base === null ? null : (
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
        )}
        {view.incomingPreview === null ? (
          base === null ? (
            <EmptyState
              isCompact
              headingLevel={3}
              title="No briefing yet"
              description="Press Generate briefing to create one from the saved records."
            />
          ) : null
        ) : (
          <BriefingPreview title="New preview (not yet reviewed)" briefing={view.incomingPreview} />
        )}
      </VStack>
    </section>
  );
}
