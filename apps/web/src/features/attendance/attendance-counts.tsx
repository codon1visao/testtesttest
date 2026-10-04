import { Badge } from "@astryxdesign/core/Badge";
import { VStack } from "@astryxdesign/core/Layout";
import { Text } from "@astryxdesign/core/Text";
import { colorVars, radiusVars, spacingVars } from "@astryxdesign/core/theme/tokens.stylex";
import type { AttendanceCounts as Counts } from "@event-desk/contracts";
import * as stylex from "@stylexjs/stylex";

export function formatAttendanceCounts(c: Counts): string {
  return `${c.registered} registered · ${c.attended} attended · ${c.absent} absent · ${c.notRecorded} not recorded`;
}

// Soft hyphens (U+00AD) let a label break between syllables, with a visible hyphen, in a narrow
// tile; the browser's own hyphenation (`hyphens: auto`) is not available everywhere. They are not
// read aloud.
const TILES = [
  { key: "registered", label: "Reg\u00ADis\u00ADtered" },
  { key: "attended", label: "At\u00ADtend\u00ADed" },
  { key: "absent", label: "Ab\u00ADsent" },
  { key: "notRecorded", label: "Not re\u00ADcord\u00ADed" },
] as const satisfies readonly { key: keyof Counts; label: string }[];

const styles = stylex.create({
  // Always one row of four, also in the narrow side column: tight tiles, and a label that wraps
  // (at its soft hyphens, else anywhere as a last resort) rather than be cut off or overflow.
  tiles: {
    display: "grid",
    gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
    gap: spacingVars["--spacing-1"],
    margin: 0,
  },
  // The value reads first, the label below it; in the markup the <dt> still names its <dd>. A
  // border gives the tile its own edge in both themes (the muted fill alone can match the card).
  tile: {
    display: "flex",
    flexDirection: "column-reverse",
    justifyContent: "flex-end",
    gap: "0.125rem",
    minWidth: 0,
    paddingBlock: spacingVars["--spacing-2"],
    paddingInline: spacingVars["--spacing-1"],
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: colorVars["--color-border-emphasized"],
    borderRadius: radiusVars["--radius-element"],
    backgroundColor: colorVars["--color-background-muted"],
  },
  term: { margin: 0, minWidth: 0, overflowWrap: "break-word" },
  value: { margin: 0, overflowWrap: "anywhere" },
});

/**
 * F2 (amended 2026-10-04): the counts as four stat tiles in one row. They count the statuses the
 * Selectors show, which equal the saved records except while a change is being saved.
 */
export function AttendanceCounts({ counts, isSaving }: { counts: Counts; isSaving: boolean }) {
  return (
    <div aria-live="polite" aria-atomic="true">
      <VStack gap={2}>
        {isSaving ? (
          <div>
            <Badge label="Saving…" />
          </div>
        ) : null}
        <dl aria-label="Attendance counts" {...stylex.props(styles.tiles)}>
          {TILES.map(({ key, label }) => (
            <div key={key} {...stylex.props(styles.tile)}>
              <dt {...stylex.props(styles.term)}>
                <Text type="supporting">{label}</Text>
              </dt>
              <dd {...stylex.props(styles.value)}>
                <Text type="large" weight="bold" hasTabularNumbers>
                  {String(counts[key])}
                </Text>
              </dd>
            </div>
          ))}
        </dl>
      </VStack>
    </div>
  );
}
