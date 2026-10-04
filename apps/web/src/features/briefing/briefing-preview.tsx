import { VStack } from "@astryxdesign/core/Layout";
import { Heading } from "@astryxdesign/core/Text";
import type { BriefingView, EventView } from "@event-desk/contracts";
import { BriefingContentView } from "./briefing-content-view";
import { FreshnessNotice } from "./freshness-notice";

/**
 * A read-only briefing (F4): cited model text, rendered as plain text (S1).
 * Headings are the brief's four questions; they are headings, not landmarks.
 */
export function BriefingPreview({
  title,
  briefing,
  view,
  sectionsSlot,
}: {
  title: string;
  briefing: BriefingView;
  view: EventView;
  /** The panel's section-card slot when this is the only briefing shown; omitted: inline. */
  sectionsSlot?: HTMLElement | null | undefined;
}) {
  const { content, provenance } = briefing;
  return (
    <article aria-label={title}>
      <VStack gap={3}>
        <Heading level={3}>{title}</Heading>
        <FreshnessNotice briefing={briefing} members={view.members} counts={view.counts} />
        {/* Its own disclosure state: a read-only copy never opens or closes the editor's sources. */}
        <BriefingContentView
          content={content}
          notes={view.feedback}
          disclosureScope={`${provenance.generationId}:readonly`}
          sectionsSlot={sectionsSlot}
        />
      </VStack>
    </article>
  );
}
