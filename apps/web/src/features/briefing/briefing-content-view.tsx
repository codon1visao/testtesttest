import { Badge } from "@astryxdesign/core/Badge";
import { Text } from "@astryxdesign/core/Text";
import type { BriefingContent, EvidenceItem, FeedbackNote } from "@event-desk/contracts";
import * as stylex from "@stylexjs/stylex";
import { SourceDisclosure } from "../feedback/source-disclosure";
import { BriefingSectionsLayout, SummaryCard } from "./briefing-sections";

// Spans only: the row sits inside the disclosure's <button>, which allows phrasing content alone.
const styles = stylex.create({
  row: {
    display: "flex",
    flexDirection: "column",
    gap: "0.25rem",
    textAlign: "start",
    minWidth: 0,
    overflowWrap: "anywhere",
  },
  ids: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.25rem" },
});

/** F3: the item's wording with its cited IDs beside it; activating the row reveals the notes. */
function EvidenceRow({
  item,
  notes,
  disclosureScope,
}: {
  item: EvidenceItem;
  notes: readonly FeedbackNote[];
  disclosureScope: string;
}) {
  return (
    <SourceDisclosure
      sourceIds={item.sourceIds}
      notes={notes}
      disclosureScope={disclosureScope}
      trigger={
        <span {...stylex.props(styles.row)}>
          <Text>{item.text}</Text>
          <span {...stylex.props(styles.ids)}>
            <Text type="supporting">Sources</Text>
            {item.sourceIds.map((id) => (
              <Badge key={id} variant="neutral" label={id} />
            ))}
          </span>
        </span>
      }
    />
  );
}

/**
 * A briefing's content, read-only (spec 2026-10-04): the feedback summary first and highlighted,
 * then the recurring themes and disagreements side by side, then follow-ups. Model and human text
 * is rendered as plain text (S1).
 */
export function BriefingContentView({
  content,
  notes,
  disclosureScope,
}: {
  content: BriefingContent;
  notes: readonly FeedbackNote[];
  /** Prefix of each item's disclosure key, e.g. a generation ID. */
  disclosureScope: string;
}) {
  return (
    <BriefingSectionsLayout
      summary={
        <SummaryCard>
          <Text type="large">{content.feedbackSummary.text}</Text>
          <Text type="supporting">{content.attendanceOverview}</Text>
          <SourceDisclosure
            sourceIds={content.feedbackSummary.sourceIds}
            notes={notes}
            disclosureScope={`${disclosureScope}:feedbackSummary`}
          />
        </SummaryCard>
      }
      renderItems={(section) =>
        content[section].map((item, index) => (
          <EvidenceRow
            item={item}
            notes={notes}
            disclosureScope={`${disclosureScope}:${section}.${String(index)}`}
          />
        ))
      }
    />
  );
}
