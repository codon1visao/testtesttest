import { Badge } from "@astryxdesign/core/Badge";
import { HStack, VStack } from "@astryxdesign/core/Layout";
import { Heading, Text } from "@astryxdesign/core/Text";
import type { EventSummary } from "@event-desk/contracts";
import * as stylex from "@stylexjs/stylex";

const styles = stylex.create({
  // A long event name wraps instead of widening the bar.
  name: { overflowWrap: "anywhere" },
});

/** The event, as the top bar's two-line title: the name with its Ended badge, the club below. */
export function EventHeader({ event }: { event: EventSummary }) {
  return (
    <VStack gap={0}>
      <HStack gap={2} align="center" wrap="wrap">
        <Heading level={1} xstyle={styles.name}>
          {event.name}
        </Heading>
        <Badge variant="neutral" label="Ended" />
      </HStack>
      <Text type="supporting">{event.clubName}</Text>
    </VStack>
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
