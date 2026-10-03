import { Badge } from "@astryxdesign/core/Badge";
import { HStack, VStack } from "@astryxdesign/core/Layout";
import { Heading, Text } from "@astryxdesign/core/Text";
import type { FeedbackNote } from "@event-desk/contracts";

/**
 * Read-only notes in stable ID order (F3). Text is rendered as React text: markup and Markdown stay
 * inert (S1). Notes are anonymous and not linked to members.
 */
export function FeedbackPanel({ notes }: { notes: readonly FeedbackNote[] }) {
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
                  <Badge variant="neutral" label={note.id} />
                  <Text>{note.text}</Text>
                </HStack>
              </li>
            ))}
          </ol>
        )}
      </VStack>
    </section>
  );
}
