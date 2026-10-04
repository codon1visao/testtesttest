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
import { useEffect, useRef, useState } from "react";
import { Controller } from "react-hook-form";
import { ConfirmDialog } from "../../shared/ui/confirm-dialog";
import { AttendanceCounts } from "./attendance-counts";
import { type AttendanceNotice, type RefetchEvent, useAttendanceForm } from "./use-attendance-form";

const styles = stylex.create({
  // The Actions cell is only as wide as its Selector, so the status label is never cut off; the
  // Name column takes the rest and wraps (member names can be up to 120 characters).
  // Astryx cells default to maxWidth 0, so the narrow cell needs maxWidth none.
  nameColumn: { overflowWrap: "anywhere" },
  actionsColumn: { width: "1%", maxWidth: "none", whiteSpace: "nowrap" },
  // Discard and Save changes at the bottom right of the card, in visual (and tab) order.
  actions: { alignSelf: "flex-end" },
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
  // Discard and a save leave the buttons disabled, and a confirmed reload unmounts the control that
  // had focus; focus moves here instead of <body>.
  const headingRef = useRef<HTMLHeadingElement>(null);
  const focusHeading = () => {
    headingRef.current?.focus();
  };
  const handledSavedFocus = useRef(0);
  useEffect(() => {
    if (attendance.savedFocusRequest === handledSavedFocus.current) return;
    handledSavedFocus.current = attendance.savedFocusRequest;
    headingRef.current?.focus();
  }, [attendance.savedFocusRequest]);
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
                {attendance.draft.map((member, index) => {
                  const name = names.get(member.id) ?? member.id;
                  return (
                    <TableRow key={member.id}>
                      <TableCell xstyle={styles.nameColumn}>{name}</TableCell>
                      <TableCell xstyle={styles.actionsColumn}>
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
                              // Locked through aria-disabled with this reason, so a focused
                              // trigger keeps focus instead of dropping to <body>.
                              disabledMessage="Wait for the attendance save to finish."
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
            {attendance.notice ? (
              <NoticeBanner
                notice={attendance.notice}
                isBusy={attendance.isBusy}
                onReload={() => {
                  setConfirmingReload(true);
                }}
              />
            ) : null}
            {/* Always shown; usable only while there are unsaved changes. While saving, Save changes
                stays focusable (aria-disabled through the tooltip), so a failed save leaves keyboard
                focus on it. */}
            <HStack gap={2} justify="end" xstyle={styles.actions}>
              <Button
                variant="secondary"
                label="Discard"
                isDisabled={!attendance.isDirty || attendance.isBusy}
                onClick={() => {
                  attendance.discard();
                  focusHeading();
                }}
              />
              <Button
                type="submit"
                variant="primary"
                label="Save changes"
                isDisabled={!attendance.isDirty || attendance.isBusy}
                isLoading={attendance.isSaving}
                {...(attendance.isSaving ? { tooltip: "Saving attendance…" } : {})}
              />
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
