import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { VStack } from "@astryxdesign/core/Layout";
import { Selector } from "@astryxdesign/core/Selector";
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableHeaderCell,
  TableRow,
} from "@astryxdesign/core/Table";
import { Heading } from "@astryxdesign/core/Text";
import {
  ATTENDANCE_LABELS,
  ATTENDANCE_STATUSES,
  AttendanceStatusSchema,
  assertNever,
  deriveAttendanceCounts,
  type EventId,
  type EventView,
} from "@event-desk/contracts";
import * as stylex from "@stylexjs/stylex";
import { useRef } from "react";
import { AttendanceCounts } from "./attendance-counts";
import {
  type AttendanceNotice,
  type RefetchEvent,
  useAttendanceAutosave,
} from "./use-attendance-autosave";

const styles = stylex.create({
  // The Actions cell is only as wide as its Selector, so the status label is never cut off; the
  // Name column takes the rest and wraps (member names can be up to 120 characters).
  // Astryx cells default to maxWidth 0, so the narrow cell needs maxWidth none.
  nameColumn: { overflowWrap: "anywhere" },
  actionsColumn: { width: "1%", maxWidth: "none", whiteSpace: "nowrap" },
});

const ATTENDANCE_OPTIONS = ATTENDANCE_STATUSES.map((status) => ({
  value: status,
  label: ATTENDANCE_LABELS[status],
}));

function NoticeBanner({
  notice,
  isChecking,
  onCheckAgain,
}: {
  notice: AttendanceNotice;
  isChecking: boolean;
  onCheckAgain: () => void;
}) {
  const notApplied = `Your change to ${notice.name} was not applied.`;
  switch (notice.kind) {
    case "failed":
      return (
        <Banner
          status="error"
          title={`${notice.name} was not saved`}
          description={notice.message}
        />
      );
    case "conflict":
      return (
        <Banner
          status="warning"
          title="Attendance changed elsewhere"
          description={
            notice.reloadError === null
              ? `${notApplied} The latest saved attendance is shown.`
              : `${notApplied} The latest saved attendance could not be loaded: ${notice.reloadError}`
          }
        />
      );
    case "confirmed":
      return <Banner status="success" title={`${notice.name} was saved.`} />;
    case "unconfirmed":
      return (
        <Banner
          status="warning"
          title="Could not confirm the save"
          description={`${notApplied} The latest saved attendance is shown.`}
        />
      );
    case "check-failed":
      return (
        <Banner
          status="warning"
          title="Could not check the saved attendance"
          description={`It is not known whether your change to ${notice.name} was saved. ${notice.message}`}
          endContent={
            // While checking it stays focusable (aria-disabled through the tooltip), so a check that
            // fails again leaves keyboard focus where it was.
            <Button
              label="Check again"
              variant="secondary"
              isLoading={isChecking}
              {...(isChecking ? { tooltip: "Checking the saved attendance…" } : {})}
              onClick={onCheckAgain}
            />
          }
        />
      );
    default:
      return assertNever(notice, "attendance notice");
  }
}

export function AttendancePanel({
  eventId,
  view,
  refetch,
}: {
  eventId: EventId;
  view: EventView;
  refetch: RefetchEvent;
}) {
  const attendance = useAttendanceAutosave(eventId, view, refetch);
  // A successful Check again unmounts its button; focus moves here instead of <body>.
  const headingRef = useRef<HTMLHeadingElement>(null);
  const names = new Map(view.members.map((m) => [m.id as string, m.name]));
  // The trigger stays focusable while locked (aria-disabled with this reason), so the Selector that
  // started a save keeps keyboard focus through it (F2-10).
  const lockedReason = attendance.isSaving
    ? "Wait for attendance to save."
    : "Check the saved attendance first.";

  return (
    <section aria-label="Attendance">
      <VStack gap={3}>
        <Heading level={2} ref={headingRef} tabIndex={-1}>
          Attendance
        </Heading>
        <AttendanceCounts
          counts={deriveAttendanceCounts(attendance.members)}
          isSaving={attendance.isSaving}
        />
        <Table aria-label="Member attendance" density="compact">
          <TableHeader>
            <TableRow isHeaderRow>
              <TableHeaderCell scope="col" xstyle={styles.nameColumn}>
                Name
              </TableHeaderCell>
              <TableHeaderCell scope="col" xstyle={styles.actionsColumn}>
                Actions
              </TableHeaderCell>
            </TableRow>
          </TableHeader>
          <TableBody>
            {attendance.members.map((member) => {
              const name = names.get(member.id) ?? member.id;
              return (
                <TableRow key={member.id}>
                  <TableCell xstyle={styles.nameColumn}>{name}</TableCell>
                  <TableCell xstyle={styles.actionsColumn}>
                    {/* The Name column shows the member visually; the label names the control. */}
                    <Selector
                      label={name}
                      isLabelHidden
                      options={ATTENDANCE_OPTIONS}
                      value={member.attendance}
                      isDisabled={attendance.isLocked}
                      disabledMessage={lockedReason}
                      onChange={(value) => {
                        const status = AttendanceStatusSchema.safeParse(value);
                        if (status.success) void attendance.change(member.id, name, status.data);
                      }}
                    />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        {attendance.notice ? (
          <NoticeBanner
            notice={attendance.notice}
            isChecking={attendance.isChecking}
            onCheckAgain={() => {
              void attendance.checkAgain().then((settled) => {
                if (settled) headingRef.current?.focus();
              });
            }}
          />
        ) : null}
      </VStack>
    </section>
  );
}
