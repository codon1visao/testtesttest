import { Banner } from "@astryxdesign/core/Banner";
import { VStack } from "@astryxdesign/core/Layout";
import { Text } from "@astryxdesign/core/Text";
import type { AttendanceCounts, BriefingView, Member } from "@event-desk/contracts";
import { formatAttendanceCounts } from "../attendance/attendance-counts";
import { attendanceChangeLines, freshnessTitle, newNotesLine } from "./freshness-text";

/** Freshness comes only from the server (D5); this states it in words, with both sets of counts. */
export function FreshnessNotice({
  briefing,
  members,
  counts,
}: {
  briefing: BriefingView;
  members: readonly Member[];
  counts: AttendanceCounts;
}) {
  const title = freshnessTitle(briefing.freshness);
  if (title === null) {
    return <Text type="supporting">Up to date with the saved attendance and feedback.</Text>;
  }
  const notes = newNotesLine(briefing.freshness);
  return (
    <Banner
      status="warning"
      title={title}
      description={
        <VStack gap={1}>
          {attendanceChangeLines(briefing.freshness, members).map((line) => (
            <Text key={line}>{line}</Text>
          ))}
          {notes === null ? null : <Text>{notes}</Text>}
          <Text>Generated from: {formatAttendanceCounts(briefing.provenance.input.counts)}</Text>
          <Text>Saved records now: {formatAttendanceCounts(counts)}</Text>
          <Text type="supporting">
            Saving edited text keeps this warning; generate again to update it.
          </Text>
        </VStack>
      }
    />
  );
}
