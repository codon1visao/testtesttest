import { VStack } from "@astryxdesign/core/Layout";
import { Heading, Text } from "@astryxdesign/core/Text";
import {
  type BriefingView,
  type EventView,
  type EvidenceItem,
  LIST_SECTIONS,
} from "@event-desk/contracts";
import { SourceDisclosure } from "../feedback/source-disclosure";
import { EVIDENCE_LIMIT_NOTICE, formatTimestamp, SECTION_COPY } from "./briefing-copy";
import { FreshnessNotice } from "./freshness-notice";

function EvidenceText({
  item,
  view,
  disclosureScope,
}: {
  item: EvidenceItem;
  view: EventView;
  disclosureScope: string;
}) {
  return (
    <VStack gap={1}>
      <Text>{item.text}</Text>
      <SourceDisclosure
        sourceIds={item.sourceIds}
        notes={view.feedback}
        disclosureScope={disclosureScope}
      />
    </VStack>
  );
}

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
  // Its own disclosure state: a read-only copy never opens or closes the editor's sources.
  const scope = `${provenance.generationId}:readonly`;
  return (
    <article aria-label={title}>
      <VStack gap={3}>
        <Heading level={3}>{title}</Heading>
        <Text type="supporting">
          Generated {formatTimestamp(provenance.generatedAt)} · {provenance.model} ·{" "}
          {briefing.trigger === "manual" ? "requested by you" : "automatic"}
        </Text>
        <FreshnessNotice briefing={briefing} members={view.members} counts={view.counts} />
        <Text type="supporting">{EVIDENCE_LIMIT_NOTICE}</Text>
        <VStack gap={1}>
          <Heading level={4}>What happened</Heading>
          <Text>{content.attendanceOverview}</Text>
          <EvidenceText
            item={content.feedbackSummary}
            view={view}
            disclosureScope={`${scope}:feedbackSummary`}
          />
        </VStack>
        {LIST_SECTIONS.map((section) => (
          <VStack key={section} gap={1}>
            <Heading level={4}>{SECTION_COPY[section].title}</Heading>
            {content[section].length === 0 ? (
              <Text type="supporting">{SECTION_COPY[section].empty}</Text>
            ) : (
              <ul>
                {content[section].map((item, index) => (
                  <li key={`${section}-${String(index)}`}>
                    <EvidenceText
                      item={item}
                      view={view}
                      disclosureScope={`${scope}:${section}.${String(index)}`}
                    />
                  </li>
                ))}
              </ul>
            )}
          </VStack>
        ))}
      </VStack>
    </article>
  );
}
