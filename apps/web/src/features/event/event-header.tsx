import { Badge } from "@astryxdesign/core/Badge";
import { HStack } from "@astryxdesign/core/Layout";
import { Heading, Text } from "@astryxdesign/core/Text";
import type { EventSummary } from "@event-desk/contracts";

/** The event, in the dashboard's top bar. */
export function EventHeader({ event }: { event: EventSummary }) {
  return (
    <HStack gap={2} align="center">
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
