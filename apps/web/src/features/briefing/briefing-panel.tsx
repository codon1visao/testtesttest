import { EmptyState } from "@astryxdesign/core/EmptyState";
import { VStack } from "@astryxdesign/core/Layout";
import { Heading } from "@astryxdesign/core/Text";

/** Placeholder until Plan 3 adds generation and Plan 4 the editor. */
export function BriefingPanel() {
  return (
    <section aria-label="Briefing">
      <VStack gap={2}>
        <Heading level={2}>Briefing</Heading>
        <EmptyState
          isCompact
          headingLevel={3}
          title="No briefing yet"
          description="No briefing has been generated for this event yet."
        />
      </VStack>
    </section>
  );
}
