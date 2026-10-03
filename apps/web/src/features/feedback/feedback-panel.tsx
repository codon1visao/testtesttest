import { Badge } from "@astryxdesign/core/Badge";
import { HStack, VStack } from "@astryxdesign/core/Layout";
import { Heading, Text } from "@astryxdesign/core/Text";
import type { FeedbackId, FeedbackNote } from "@event-desk/contracts";
import * as stylex from "@stylexjs/stylex";

const styles = stylex.create({
  // Astryx Badge may shrink with an ellipsis; the note ID must always be readable in full.
  noteId: { flexShrink: 0 },
  // Let long unbroken note text wrap inside the row instead of forcing horizontal scroll.
  noteText: { minWidth: 0, overflowWrap: "anywhere" },
});

const NO_NEW_NOTES: ReadonlySet<FeedbackId> = new Set();

/**
 * Read-only notes in stable ID order (F3). Text is rendered as React text: markup and Markdown stay
 * inert (S1). Notes are anonymous and not linked to members.
 */
export function FeedbackPanel({
  notes,
  newSinceBriefing = NO_NEW_NOTES,
}: {
  notes: readonly FeedbackNote[];
  /** Notes that are not in the displayed briefing's input. */
  newSinceBriefing?: ReadonlySet<FeedbackId>;
}) {
  return (
    <section aria-label="Feedback">
      <VStack gap={2}>
        <Heading level={2}>Feedback</Heading>
        <Text type="supporting">
          {notes.length} anonymous notes from the event feedback form. Read-only and not linked to
          members.
        </Text>
        {notes.length === 0 ? (
          <Text>No feedback notes yet.</Text>
        ) : (
          <ol>
            {notes.map((note) => (
              <li key={note.id}>
                <HStack gap={2}>
                  <span {...stylex.props(styles.noteId)}>
                    <Badge variant="neutral" label={note.id} />
                    {newSinceBriefing.has(note.id) ? (
                      <Badge variant="info" label="New since this briefing" />
                    ) : null}
                  </span>
                  <div {...stylex.props(styles.noteText)}>
                    <Text>{note.text}</Text>
                  </div>
                </HStack>
              </li>
            ))}
          </ol>
        )}
      </VStack>
    </section>
  );
}
