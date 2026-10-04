import { Badge } from "@astryxdesign/core/Badge";
import { Collapsible } from "@astryxdesign/core/Collapsible";
import { HStack, VStack } from "@astryxdesign/core/Layout";
import { Text } from "@astryxdesign/core/Text";
import { spacingVars, typeScaleVars } from "@astryxdesign/core/theme/tokens.stylex";
import type { FeedbackId, FeedbackNote } from "@event-desk/contracts";
import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";
import { useUiStore } from "../../state/ui-store";

/** F3 "Evidence limits" (amended 2026-10-04): at the bottom of every opened sources view. */
export const EVIDENCE_NOTE =
  "Sources show where wording came from; they don't prove it. Check before saving.";

const styles = stylex.create({
  // Lines the notes up under the trigger's text, not under its chevron: Astryx's start chevron is
  // a box of the trigger's type size (--text-large-size) followed by a --spacing-2 margin.
  content: {
    display: "flex",
    flexDirection: "column",
    gap: "0.5rem",
    paddingInlineStart: `calc(${typeScaleVars["--text-large-size"]} + ${spacingVars["--spacing-2"]})`,
  },
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
 * every note it cites, inline and as plain text, then the evidence note, without moving focus or
 * touching the editor. The open state lives in the UI store under the item's scope (T3 §11), so a
 * disclosure opened before a save stays open when the editor remounts on the same generation and
 * item. A cited ID that is not among the event's notes is an error, shown without opening anything.
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
  /** What the coordinator activates (the item's row); defaults to a small "Sources (n)". */
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
          trigger={trigger ?? <Text type="supporting">{`Sources (${String(cited.length)})`}</Text>}
        >
          <div {...stylex.props(styles.content)}>
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
            <Text type="supporting">{EVIDENCE_NOTE}</Text>
          </div>
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
