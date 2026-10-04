import { Badge } from "@astryxdesign/core/Badge";
import { VStack } from "@astryxdesign/core/Layout";
import { Text } from "@astryxdesign/core/Text";
import { colorVars, radiusVars, spacingVars } from "@astryxdesign/core/theme/tokens.stylex";
import type { AttendanceCounts as Counts } from "@event-desk/contracts";
import * as stylex from "@stylexjs/stylex";

export function formatAttendanceCounts(c: Counts): string {
  return `${c.registered} registered · ${c.attended} attended · ${c.absent} absent · ${c.notRecorded} not recorded`;
}

const TILES = [
  { key: "registered", label: "Registered" },
  { key: "attended", label: "Attended" },
  { key: "absent", label: "Absent" },
  { key: "notRecorded", label: "Not recorded" },
] as const satisfies readonly { key: keyof Counts; label: string }[];

const styles = stylex.create({
  // The tile row's own width decides the layout: the attendance card may sit in a narrow column.
  container: { containerType: "inline-size" },
  tiles: {
    display: "grid",
    gridTemplateColumns: {
      default: "repeat(4, minmax(0, 1fr))",
      "@container (max-width: 360px)": "repeat(2, minmax(0, 1fr))",
    },
    gap: "0.5rem",
    margin: 0,
  },
  // The value reads first, the label below it; in the markup the <dt> still names its <dd>. A
  // border gives the tile its own edge in both themes (the muted fill alone can match the card).
  tile: {
    display: "flex",
    flexDirection: "column-reverse",
    gap: "0.25rem",
    minWidth: 0,
    padding: spacingVars["--spacing-2"],
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: colorVars["--color-border-emphasized"],
    borderRadius: radiusVars["--radius-element"],
    backgroundColor: colorVars["--color-background-muted"],
  },
  term: { margin: 0 },
  value: { margin: 0, overflowWrap: "anywhere" },
});

/**
 * F2 (amended 2026-10-04): the counts as four stat tiles. Saved counts are the factual baseline;
 * with unsaved changes a changed tile shows "saved → draft" and the tiles are marked Unsaved.
 */
export function AttendanceCounts({
  saved,
  draft,
  isDirty,
}: {
  saved: Counts;
  draft: Counts;
  isDirty: boolean;
}) {
  return (
    <div aria-live="polite" aria-atomic="true" {...stylex.props(styles.container)}>
      <VStack gap={2}>
        {isDirty ? (
          <div>
            <Badge variant="warning" label="Unsaved" />
          </div>
        ) : null}
        <dl aria-label="Attendance counts" {...stylex.props(styles.tiles)}>
          {TILES.map(({ key, label }) => {
            const changed = isDirty && draft[key] !== saved[key];
            return (
              <div key={key} {...stylex.props(styles.tile)}>
                <dt {...stylex.props(styles.term)}>
                  <Text type="supporting">{label}</Text>
                </dt>
                <dd {...stylex.props(styles.value)}>
                  <Text type="large" weight="bold" hasTabularNumbers>
                    {changed ? `${String(saved[key])} → ${String(draft[key])}` : String(saved[key])}
                  </Text>
                </dd>
              </div>
            );
          })}
        </dl>
      </VStack>
    </div>
  );
}
