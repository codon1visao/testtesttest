import { VStack } from "@astryxdesign/core/Layout";
import { Heading, Text } from "@astryxdesign/core/Text";
import type { BriefingView, EvidenceItem } from "@event-desk/contracts";

const timeFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

function EvidenceText({ item }: { item: EvidenceItem }) {
  return (
    <Text>
      {item.text} <Text type="supporting">(Sources: {item.sourceIds.join(", ")})</Text>
    </Text>
  );
}

function EvidenceSection({
  title,
  items,
  empty,
}: {
  title: string;
  items: readonly EvidenceItem[];
  empty: string;
}) {
  return (
    <section aria-label={title}>
      <VStack gap={1}>
        <Heading level={4}>{title}</Heading>
        {items.length === 0 ? (
          <Text type="supporting">{empty}</Text>
        ) : (
          <ul>
            {items.map((item, index) => (
              <li key={`${title}-${String(index)}`}>
                <EvidenceText item={item} />
              </li>
            ))}
          </ul>
        )}
      </VStack>
    </section>
  );
}

/** A read-only briefing (F4): code-built overview, cited model text, rendered as plain text (S1). */
export function BriefingPreview({ title, briefing }: { title: string; briefing: BriefingView }) {
  const { content, provenance } = briefing;
  return (
    <article aria-label={title}>
      <VStack gap={3}>
        <Heading level={3}>{title}</Heading>
        <Text type="supporting">
          Generated {timeFormat.format(new Date(provenance.generatedAt))} · {provenance.model} ·{" "}
          {briefing.trigger === "manual" ? "requested by you" : "automatic"}
        </Text>
        <section aria-label="What happened">
          <VStack gap={1}>
            <Heading level={4}>What happened</Heading>
            <Text>{content.attendanceOverview}</Text>
            <EvidenceText item={content.feedbackSummary} />
          </VStack>
        </section>
        <EvidenceSection
          title="Themes"
          items={content.themes}
          empty="No recurring themes identified."
        />
        <EvidenceSection
          title="Conflicts"
          items={content.conflicts}
          empty="No conflicting views identified."
        />
        <EvidenceSection
          title="Suggested follow-ups"
          items={content.suggestions}
          empty="No follow-ups suggested."
        />
      </VStack>
    </article>
  );
}
