import { EmptyState } from "@astryxdesign/core/EmptyState";
import { VStack } from "@astryxdesign/core/Layout";
import { Heading } from "@astryxdesign/core/Text";
import type { EventId, EventView } from "@event-desk/contracts";
import { BriefingPreview } from "./briefing-preview";
import { GenerateBriefingControl } from "./generate-briefing-control";

/** Generate/Retry and the incoming preview (Plan 3B). Plan 4 adds select, edit, save and freshness. */
export function BriefingPanel({ eventId, view }: { eventId: EventId; view: EventView }) {
  return (
    <section aria-label="Briefing">
      <VStack gap={3}>
        <Heading level={2}>Briefing</Heading>
        <GenerateBriefingControl eventId={eventId} view={view} />
        {view.incomingPreview === null ? (
          <EmptyState
            isCompact
            headingLevel={3}
            title="No briefing yet"
            description="Press Generate briefing to create one from the saved records."
          />
        ) : (
          <BriefingPreview title="New preview (not yet reviewed)" briefing={view.incomingPreview} />
        )}
      </VStack>
    </section>
  );
}
