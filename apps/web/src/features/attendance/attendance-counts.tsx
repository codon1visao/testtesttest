import { VStack } from "@astryxdesign/core/Layout";
import { Text } from "@astryxdesign/core/Text";
import type { AttendanceCounts as Counts } from "@event-desk/contracts";

const describe = (c: Counts) =>
  `${c.registered} registered · ${c.attended} attended · ${c.absent} absent · ${c.notRecorded} not recorded`;

/** Saved counts are the factual baseline; unsaved counts preview the draft and are labelled as such (F2). */
export function AttendanceCounts({
  saved,
  draft,
  isDirty,
}: {
  saved: Counts;
  draft: Counts;
  isDirty: boolean;
}) {
  return (
    <div aria-live="polite">
      <VStack gap={1}>
        {isDirty ? <Text weight="bold">Unsaved counts: {describe(draft)}</Text> : null}
        <Text type={isDirty ? "supporting" : "body"}>Saved counts: {describe(saved)}</Text>
      </VStack>
    </div>
  );
}
