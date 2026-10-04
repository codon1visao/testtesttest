import { Badge } from "@astryxdesign/core/Badge";
import { HStack } from "@astryxdesign/core/Layout";
import { Heading, Text } from "@astryxdesign/core/Text";
import type { EventSummary } from "@event-desk/contracts";
import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";

const styles = stylex.create({
  // Astryx keeps the top bar's heading slot at its full width (flex-shrink: 0), so a row that fits
  // on one line only would push things off a phone screen. Bound the row to the viewport (less the
  // bar's own padding) and let it wrap: whatever does not fit, the club name or the live status,
  // drops to the next line instead of overflowing.
  row: { minWidth: 0, maxWidth: "calc(100vw - 1rem)" },
});

/** The event and its live-update status, in the dashboard's top bar. */
export function EventHeader({ event, status }: { event: EventSummary; status?: ReactNode }) {
  return (
    <HStack gap={2} align="center" wrap="wrap" xstyle={styles.row}>
      <Heading level={1}>{event.name}</Heading>
      <Badge variant="neutral" label="Ended" />
      <Text type="supporting">{event.clubName}</Text>
      {status}
    </HStack>
  );
}

/** F7: the change stream is open, or the page polls until it reconnects. */
export function LiveStatus({ live }: { live: boolean }) {
  return (
    <Badge
      variant={live ? "success" : "neutral"}
      label={live ? "Live updates" : "Polling for updates"}
    />
  );
}
