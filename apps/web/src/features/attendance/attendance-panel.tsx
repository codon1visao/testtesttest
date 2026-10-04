import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { HStack, VStack } from "@astryxdesign/core/Layout";
import { Selector } from "@astryxdesign/core/Selector";
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableHeaderCell,
  TableRow,
} from "@astryxdesign/core/Table";
import { Heading, Text } from "@astryxdesign/core/Text";
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
import { useRef, useState } from "react";
import { Controller } from "react-hook-form";
import { ConfirmDialog } from "../../shared/ui/confirm-dialog";
import { AttendanceCounts } from "./attendance-counts";
import { type AttendanceNotice, type RefetchEvent, useAttendanceForm } from "./use-attendance-form";

const styles = stylex.create({
  // The Name column takes only what it needs; the Actions column gets the rest so the status
  // label in the Selector is never cut off.
  nameColumn: { width: "1%", maxWidth: "none", whiteSpace: "nowrap" },
});

const ATTENDANCE_OPTIONS = ATTENDANCE_STATUSES.map((status) => ({
  value: status,
  label: ATTENDANCE_LABELS[status],
}));

function NoticeBanner({
  notice,
  isBusy,
  onReload,
}: {
  notice: AttendanceNotice;
  isBusy: boolean;
  onReload: () => void;
}) {
  switch (notice.kind) {
    case "conflict":
      return (
        <Banner
          status="warning"
          title="Attendance changed elsewhere"
          description={
            notice.reloadError === null
              ? `${notice.message} Your selections are kept until you choose to reload.`
              : `${notice.message} The latest saved attendance could not be loaded, so your selections are kept: ${notice.reloadError}`
          }
          endContent={
            <Button
              label="Reload saved attendance"
              variant="secondary"
              isDisabled={isBusy}
              onClick={onReload}
            />
          }
        />
      );
    case "failed":
      return (
        <Banner status="error" title="Attendance was not saved" description={notice.message} />
      );
    case "unconfirmed":
      return (
        <Banner
          status="warning"
          title="Could not confirm the save"
          description="The saved records do not match your selections. They are kept; check them and save again."
        />
      );
    case "check-failed":
      return (
        <Banner
          status="warning"
          title="Could not check the saved records"
          description={`It is not known whether your changes were saved. Your selections are kept; try again. ${notice.message}`}
        />
      );
    case "confirmed":
      return <Banner status="success" title="Your attendance changes were saved." />;
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
  const attendance = useAttendanceForm(eventId, view, refetch);
  const [confirmingReload, setConfirmingReload] = useState(false);
  // Discard and a confirmed reload unmount the control that had focus; focus moves here instead of <body>.
  const headingRef = useRef<HTMLHeadingElement>(null);
  const focusHeading = () => {
    headingRef.current?.focus();
  };
  const names = new Map(view.members.map((m) => [m.id as string, m.name]));

  return (
    <section aria-label="Attendance">
      <VStack gap={3}>
        <Heading level={2} ref={headingRef} tabIndex={-1}>
          Attendance
        </Heading>
        <form
          noValidate
          onSubmit={(event) => {
            void attendance.submit(event);
          }}
        >
          <VStack gap={3}>
            <AttendanceCounts
              saved={view.counts}
              draft={deriveAttendanceCounts(attendance.draft)}
              isDirty={attendance.isDirty}
            />
            <Table aria-label="Member attendance" density="compact">
              <TableHeader>
                <TableRow isHeaderRow>
                  <TableHeaderCell scope="col" xstyle={styles.nameColumn}>
                    Name
                  </TableHeaderCell>
                  <TableHeaderCell scope="col">Actions</TableHeaderCell>
                </TableRow>
              </TableHeader>
              <TableBody>
                {attendance.draft.map((member, index) => {
                  const name = names.get(member.id) ?? member.id;
                  return (
                    <TableRow key={member.id}>
                      <TableCell xstyle={styles.nameColumn}>{name}</TableCell>
                      <TableCell>
                        <Controller
                          control={attendance.form.control}
                          name={`members.${index}.attendance`}
                          render={({ field }) => (
                            // The Name column shows the member visually; the label names the control.
                            <Selector
                              label={name}
                              isLabelHidden
                              options={ATTENDANCE_OPTIONS}
                              value={field.value}
                              isDisabled={attendance.isBusy}
                              onChange={(value) => {
                                const status = AttendanceStatusSchema.safeParse(value);
                                if (status.success) field.onChange(status.data);
                              }}
                            />
                          )}
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            {attendance.isDirty ? (
              <Text>
                Unsaved attendance changes. Save or discard them before generating a briefing.
              </Text>
            ) : null}
            {attendance.notice ? (
              <NoticeBanner
                notice={attendance.notice}
                isBusy={attendance.isBusy}
                onReload={() => {
                  setConfirmingReload(true);
                }}
              />
            ) : null}
            <HStack gap={2}>
              <Button
                type="submit"
                variant="primary"
                label="Save attendance"
                isDisabled={!attendance.isDirty || attendance.isBusy}
                isLoading={attendance.isSaving}
              />
              {attendance.isDirty ? (
                <Button
                  variant="secondary"
                  label="Discard attendance changes"
                  isDisabled={attendance.isBusy}
                  onClick={() => {
                    attendance.discard();
                    focusHeading();
                  }}
                />
              ) : null}
            </HStack>
          </VStack>
        </form>
      </VStack>
      <ConfirmDialog
        isOpen={confirmingReload}
        title="Reload saved attendance?"
        description="Your unsaved selections will be discarded and replaced by the latest saved attendance."
        actionLabel="Discard and reload"
        onCancel={() => {
          setConfirmingReload(false);
        }}
        onConfirm={() => {
          setConfirmingReload(false);
          void attendance.reloadSaved().then((reloaded) => {
            if (reloaded) focusHeading();
          });
        }}
      />
    </section>
  );
}
