import { Badge } from "@astryxdesign/core/Badge";
import { HStack } from "@astryxdesign/core/Layout";
import { Heading, Text } from "@astryxdesign/core/Text";
import type { EventSummary } from "@event-desk/contracts";
import * as stylex from "@stylexjs/stylex";

const styles = stylex.create({
  // Astryx keeps the top bar's heading slot at its full width (flex-shrink: 0), so on a phone the
  // row would push the live-updates badge off screen. Bound the row to the viewport minus room for
  // that badge: the club name then drops to a second line.
  row: { minWidth: 0, maxWidth: "calc(100vw - 7rem)" },
});

/** The event, in the dashboard's top bar. */
export function EventHeader({ event }: { event: EventSummary }) {
  return (
    <HStack gap={2} align="center" wrap="wrap" xstyle={styles.row}>
      <Heading level={1}>{event.name}</Heading>
      <Badge variant="neutral" label="Ended" />
      <Text type="supporting">{event.clubName}</Text>
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
