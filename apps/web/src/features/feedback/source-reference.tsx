import { Badge } from "@astryxdesign/core/Badge";
import { Button } from "@astryxdesign/core/Button";
import { HStack, VStack } from "@astryxdesign/core/Layout";
import { Text } from "@astryxdesign/core/Text";
import type { FeedbackId, FeedbackNote } from "@event-desk/contracts";
import * as stylex from "@stylexjs/stylex";
import { useId } from "react";
import { useUiStore } from "../../state/ui-store";

const styles = stylex.create({
  list: { listStyle: "none", margin: 0, padding: 0 },
  note: { minWidth: 0, overflowWrap: "anywhere" },
});

function SourceToggle({
  note,
  panelId,
  disclosureKey,
}: {
  note: FeedbackNote;
  panelId: string;
  disclosureKey: string;
}) {
  const isOpen = useUiStore((state) => state.openSources[disclosureKey] === true);
  const toggleSource = useUiStore((state) => state.toggleSource);
  return (
    <VStack gap={1}>
      <div>
        <Button
          variant="ghost"
          size="sm"
          label={`Read source ${note.id}`}
          aria-expanded={isOpen}
          aria-controls={panelId}
          onClick={() => {
            toggleSource(disclosureKey);
          }}
        />
      </div>
      <div id={panelId} hidden={!isOpen}>
        <HStack gap={2}>
          <Badge variant="neutral" label={note.id} />
          <div {...stylex.props(styles.note)}>
            <Text>{note.text}</Text>
          </div>
        </HStack>
      </div>
    </VStack>
  );
}

/**
 * F3 "Reading and inspection flow": each cited ID opens its note inline, as plain text, without
 * moving focus or touching the editor. An ID that is not among the event's notes is an error.
 * Open disclosures live in the UI store under `${disclosureScope}:${feedbackId}` (T3 §11), so one
 * opened before a save stays open when the editor remounts on the same generation and item.
 */
export function SourceReferences({
  sourceIds,
  notes,
  disclosureScope,
}: {
  sourceIds: readonly FeedbackId[];
  notes: readonly FeedbackNote[];
  /** Which item these sources belong to, e.g. `${generationId}:themes.0`. */
  disclosureScope: string;
}) {
  const baseId = useId();
  const byId = new Map(notes.map((note) => [note.id as string, note]));
  return (
    <ul aria-label="Sources" {...stylex.props(styles.list)}>
      {sourceIds.map((id) => {
        const note = byId.get(id);
        return (
          <li key={id}>
            {note === undefined ? (
              <Badge variant="error" label={`Source ${id} is unavailable`} />
            ) : (
              <SourceToggle
                note={note}
                panelId={`${baseId}-${id}`}
                disclosureKey={`${disclosureScope}:${id}`}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}
