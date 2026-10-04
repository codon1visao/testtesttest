import { VStack } from "@astryxdesign/core/Layout";
import { Heading, Text } from "@astryxdesign/core/Text";
import type { BriefingView, EventView } from "@event-desk/contracts";
import { formatTimestamp } from "./briefing-copy";
import { BriefingContentView } from "./briefing-content-view";
import { FreshnessNotice } from "./freshness-notice";

/**
 * A read-only briefing (F4): code-built overview, cited model text, rendered as plain text (S1).
 * Headings are the brief's four questions; they are headings, not landmarks.
 */
export function BriefingPreview({
  title,
  briefing,
  view,
}: {
  title: string;
  briefing: BriefingView;
  view: EventView;
}) {
  const { content, provenance } = briefing;
  return (
    <article aria-label={title}>
      <VStack gap={3}>
        <Heading level={3}>{title}</Heading>
        <Text type="supporting">
          Generated {formatTimestamp(provenance.generatedAt)} · {provenance.model} ·{" "}
          {briefing.trigger === "manual" ? "requested by you" : "automatic"}
        </Text>
        <FreshnessNotice briefing={briefing} members={view.members} counts={view.counts} />
        {/* Its own disclosure state: a read-only copy never opens or closes the editor's sources. */}
        <BriefingContentView
          content={content}
          notes={view.feedback}
          disclosureScope={`${provenance.generationId}:readonly`}
        />
      </VStack>
    </article>
  );
}
