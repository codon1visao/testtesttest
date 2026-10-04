import { Badge } from "@astryxdesign/core/Badge";
import { Collapsible } from "@astryxdesign/core/Collapsible";
import { HStack, VStack } from "@astryxdesign/core/Layout";
import { Text } from "@astryxdesign/core/Text";
import type { FeedbackId, FeedbackNote } from "@event-desk/contracts";
import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";
import { useUiStore } from "../../state/ui-store";

const styles = stylex.create({
  list: {
    listStyle: "none",
    margin: 0,
    padding: 0,
    display: "flex",
    flexDirection: "column",
    gap: "0.5rem",
  },
  // Astryx Badge may shrink with an ellipsis; the note ID must always be readable in full.
  noteId: { flexShrink: 0 },
  note: { minWidth: 0, overflowWrap: "anywhere" },
});

/**
 * F3 "Reading and inspection flow" (amended 2026-10-04): one disclosure per briefing item reveals
 * every note it cites, inline and as plain text, without moving focus or touching the editor. The
 * open state lives in the UI store under the item's scope (T3 §11), so a disclosure opened before a
 * save stays open when the editor remounts on the same generation and item. A cited ID that is not
 * among the event's notes is an error, shown without opening anything.
 */
export function SourceDisclosure({
  sourceIds,
  notes,
  disclosureScope,
  trigger,
}: {
  sourceIds: readonly FeedbackId[];
  notes: readonly FeedbackNote[];
  /** Which item these sources belong to, e.g. `${generationId}:themes.0`. */
  disclosureScope: string;
  /** What the coordinator activates (the item's row); defaults to "Sources (n)". */
  trigger?: ReactNode;
}) {
  const isOpen = useUiStore((state) => state.openSources[disclosureScope] === true);
  const setSourceOpen = useUiStore((state) => state.setSourceOpen);
  const byId = new Map(notes.map((note) => [note.id as string, note]));
  const cited = sourceIds.flatMap((id) => {
    const note = byId.get(id);
    return note === undefined ? [] : [note];
  });
  const missing = sourceIds.filter((id) => !byId.has(id));
  return (
    <VStack gap={1}>
      {cited.length === 0 ? (
        trigger
      ) : (
        <Collapsible
          isOpen={isOpen}
          onOpenChange={(open) => {
            setSourceOpen(disclosureScope, open);
          }}
          chevronPosition="start"
          trigger={trigger ?? `Sources (${String(cited.length)})`}
        >
          <ul aria-label="Sources" {...stylex.props(styles.list)}>
            {cited.map((note) => (
              <li key={note.id}>
                <HStack gap={2}>
                  <span {...stylex.props(styles.noteId)}>
                    <Badge variant="neutral" label={note.id} />
                  </span>
                  <div {...stylex.props(styles.note)}>
                    <Text>{note.text}</Text>
                  </div>
                </HStack>
              </li>
            ))}
          </ul>
        </Collapsible>
      )}
      {missing.map((id) => (
        <div key={id}>
          <Badge variant="error" label={`Source ${id} is unavailable`} />
        </div>
      ))}
    </VStack>
  );
}
