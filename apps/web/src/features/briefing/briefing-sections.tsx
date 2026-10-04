import { Card } from "@astryxdesign/core/Card";
import { Grid } from "@astryxdesign/core/Grid";
import { VStack } from "@astryxdesign/core/Layout";
import { Heading, Text } from "@astryxdesign/core/Text";
import type { ListSection } from "@event-desk/contracts";
import { colorVars, spacingVars } from "@astryxdesign/core/theme/tokens.stylex";
import * as stylex from "@stylexjs/stylex";
import { type ReactNode, useId } from "react";
import { createPortal } from "react-dom";
import { SECTION_COPY } from "./briefing-copy";

const styles = stylex.create({
  fillRow: { height: "100%", boxSizing: "border-box" },
  list: {
    listStyle: "none",
    margin: 0,
    padding: 0,
    display: "flex",
    flexDirection: "column",
    gap: spacingVars["--spacing-3"],
  },
  // A hairline between items, so multi-line items never read as one paragraph. Block spacing
  // only: the item's own content keeps its inline position.
  item: {
    borderBlockStartWidth: { default: "1px", ":first-child": 0 },
    borderBlockStartStyle: "solid",
    borderBlockStartColor: colorVars["--color-border"],
    paddingBlockStart: { default: spacingVars["--spacing-3"], ":first-child": 0 },
  },
});

/** Side by side on wide screens (spec 2026-10-04); suggestions take the full width below them. */
const COLUMN_SECTIONS = ["themes", "conflicts"] as const satisfies readonly ListSection[];

/** "Summary", highlighted and first: the feedback summary leads the briefing. */
export function SummaryCard({ children }: { children: ReactNode }) {
  return (
    <Card variant="blue" padding={4}>
      <VStack gap={2}>
        <Heading level={4}>Summary</Heading>
        {children}
      </VStack>
    </Card>
  );
}

/** One of the brief's questions; its heading names the list, so each item is found by section. */
function BriefingSection({
  section,
  items,
}: {
  section: ListSection;
  items: readonly ReactNode[];
}) {
  const headingId = useId();
  return (
    <VStack gap={2}>
      <Heading level={4} id={headingId}>
        {SECTION_COPY[section].title}
      </Heading>
      {items.length === 0 ? (
        <Text type="supporting">{SECTION_COPY[section].empty}</Text>
      ) : (
        <ol aria-labelledby={headingId} {...stylex.props(styles.list)}>
          {items.map((item, index) => (
            <li key={`${section}-${String(index)}`} {...stylex.props(styles.item)}>
              {item}
            </li>
          ))}
        </ol>
      )}
    </VStack>
  );
}

/** One section as its own card below the Briefing card (spec 05, amended 2026-10-04). */
function SectionCard({
  section,
  items,
  fillsRow = false,
}: {
  section: ListSection;
  items: readonly ReactNode[];
  /** Side by side: as tall as its neighbour, so the two cards line up. */
  fillsRow?: boolean;
}) {
  return (
    <Card padding={4} data-briefing-card={section} xstyle={fillsRow ? styles.fillRow : undefined}>
      <BriefingSection section={section} items={items} />
    </Card>
  );
}

/**
 * Themes and Disagreements side by side, Suggestions for you full width below, each its own card;
 * they stack on narrow widths. Spaced like the dashboard's other cards.
 */
export function BriefingSectionCards({
  renderItems,
}: {
  renderItems: (section: ListSection) => readonly ReactNode[];
}) {
  return (
    <VStack gap={6}>
      <Grid columns={{ minWidth: 280, max: 2 }} gap={6}>
        {COLUMN_SECTIONS.map((section) => (
          <SectionCard key={section} section={section} items={renderItems(section)} fillsRow />
        ))}
      </Grid>
      <SectionCard section="suggestions" items={renderItems("suggestions")} />
    </VStack>
  );
}

/**
 * The briefing's arrangement, shared by the read view and the edit view so they cannot drift.
 * With `sectionsSlot` the summary stays here and the sections render as cards in that element (the
 * panel's slot below the Briefing card; nothing until it exists). Without it, everything is inline:
 * the compact arrangement of the latest saved briefing shown beside a conflicting draft.
 */
export function BriefingSectionsLayout({
  summary,
  renderItems,
  sectionsSlot,
}: {
  summary: ReactNode;
  renderItems: (section: ListSection) => readonly ReactNode[];
  sectionsSlot?: HTMLElement | null | undefined;
}) {
  if (sectionsSlot !== undefined) {
    return (
      <>
        {summary}
        {sectionsSlot === null
          ? null
          : createPortal(<BriefingSectionCards renderItems={renderItems} />, sectionsSlot)}
      </>
    );
  }
  return (
    <VStack gap={4}>
      {summary}
      <Grid columns={{ minWidth: 280, max: 2 }} gap={4}>
        {COLUMN_SECTIONS.map((section) => (
          <BriefingSection key={section} section={section} items={renderItems(section)} />
        ))}
      </Grid>
      <BriefingSection section="suggestions" items={renderItems("suggestions")} />
    </VStack>
  );
}
