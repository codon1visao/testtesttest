import { Badge } from "@astryxdesign/core/Badge";
import { HStack, VStack } from "@astryxdesign/core/Layout";
import { Heading, Text } from "@astryxdesign/core/Text";
import type { EventSummary } from "@event-desk/contracts";

export function EventHeader({ event }: { event: EventSummary }) {
  return (
    <header>
      <VStack gap={1}>
        <HStack gap={2}>
          <Heading level={1}>{event.name}</Heading>
          <Badge variant="neutral" label="Ended" />
        </HStack>
        <Text type="supporting">{event.clubName}</Text>
      </VStack>
    </header>
  );
}
