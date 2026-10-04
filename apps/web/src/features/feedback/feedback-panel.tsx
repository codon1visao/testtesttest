import { Badge } from "@astryxdesign/core/Badge";
import { HStack, VStack } from "@astryxdesign/core/Layout";
import { Link } from "@astryxdesign/core/Link";
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableHeaderCell,
  TableRow,
} from "@astryxdesign/core/Table";
import { Heading, Text } from "@astryxdesign/core/Text";
import type { FeedbackId, FeedbackNote } from "@event-desk/contracts";
import * as stylex from "@stylexjs/stylex";
import { EVENT_ID } from "../../config";

const styles = stylex.create({
  // Astryx Badge may shrink with an ellipsis; the note ID must always be readable in full.
  noteId: { flexShrink: 0 },
  // The ID column is only as wide as its content; the Note column takes the rest.
  idColumn: { width: "1%", maxWidth: "none", wordBreak: "normal", overflowWrap: "normal" },
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
        <HStack gap={2} justify="between" align="center">
          <Heading level={2}>Feedback</Heading>
          <Link href={`/events/${EVENT_ID}/feedback`} isExternalLink>
            Open feedback form (test)
          </Link>
        </HStack>
        <Text type="supporting">
          {notes.length} anonymous notes from the event feedback form. Read-only and not linked to
          members.
        </Text>
        {notes.length === 0 ? (
          <Text>No feedback notes yet.</Text>
        ) : (
          <Table aria-label="Feedback notes" density="compact" verticalAlign="top">
            <TableHeader>
              <TableRow isHeaderRow>
                <TableHeaderCell scope="col" xstyle={styles.idColumn}>
                  ID
                </TableHeaderCell>
                <TableHeaderCell scope="col">Note</TableHeaderCell>
              </TableRow>
            </TableHeader>
            <TableBody>
              {notes.map((note) => (
                <TableRow key={note.id}>
                  <TableCell xstyle={styles.idColumn}>
                    <VStack gap={1}>
                      <span {...stylex.props(styles.noteId)}>
                        <Badge variant="neutral" label={note.id} />
                      </span>
                      {newSinceBriefing.has(note.id) ? (
                        <Badge variant="info" label="New since this briefing" />
                      ) : null}
                    </VStack>
                  </TableCell>
                  <TableCell>
                    <div {...stylex.props(styles.noteText)}>
                      <Text>{note.text}</Text>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </VStack>
    </section>
  );
}
