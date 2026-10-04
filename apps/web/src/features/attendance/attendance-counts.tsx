import { Badge } from "@astryxdesign/core/Badge";
import { Text } from "@astryxdesign/core/Text";
import { colorVars, spacingVars } from "@astryxdesign/core/theme/tokens.stylex";
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
  // A stat strip: always one row of four equal cells, also in the narrow side column. The strip's
  // own width sizes the labels (container units), so no label word ever breaks.
  tiles: {
    display: "grid",
    gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
    margin: 0,
    containerType: "inline-size",
  },
  // The value reads first, the label below it, both centred; in the markup the <dt> still names its
  // <dd>. A thin divider separates each cell from the one before it.
  tile: {
    display: "flex",
    flexDirection: "column-reverse",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: "0.125rem",
    minWidth: 0,
    paddingBlock: spacingVars["--spacing-1"],
    paddingInline: "2px",
    textAlign: "center",
    borderInlineStartWidth: { default: "1px", ":first-child": 0 },
    borderInlineStartStyle: "solid",
    borderInlineStartColor: colorVars["--color-border"],
  },
  term: { margin: 0 },
  // Smaller than the supporting size, and smaller still in a narrow strip: "Registered" fits a
  // quarter of a 240 px strip. Words wrap only at spaces ("Not recorded" may take two lines).
  label: {
    display: "block",
    fontSize: "clamp(10px, 4.2cqi, 11px)",
    lineHeight: 1.25,
    overflowWrap: "normal",
    wordBreak: "normal",
  },
  value: { margin: 0 },
});

/**
 * F2 (amended 2026-10-04): the counts as a one-row stat strip. Saved counts are the factual
 * baseline; with unsaved changes a changed cell shows "saved → draft" (the Unsaved badge is in the
 * card's header, AttendanceStatusBadge). Announced as a whole when the counts change.
 */
/**
 * The card header's draft state: Unsaved while there are changes, Saving… while a save runs. Its own
 * polite live region, so the state is announced apart from the counts.
 */
export function AttendanceStatusBadge({
  isDirty,
  isSaving,
}: {
  isDirty: boolean;
  isSaving: boolean;
}) {
  return (
    <div aria-live="polite" aria-atomic="true">
      {isSaving ? (
        <Badge label="Saving…" />
      ) : isDirty ? (
        <Badge variant="warning" label="Unsaved" />
      ) : null}
    </div>
  );
}

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
    <div aria-live="polite" aria-atomic="true">
      <dl aria-label="Attendance counts" {...stylex.props(styles.tiles)}>
        {TILES.map(({ key, label }) => {
          const changed = isDirty && draft[key] !== saved[key];
          return (
            <div key={key} {...stylex.props(styles.tile)}>
              <dt {...stylex.props(styles.term)}>
                <Text type="supporting" xstyle={styles.label}>
                  {label}
                </Text>
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
    </div>
  );
}
