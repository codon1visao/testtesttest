import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Field } from "@astryxdesign/core/Field";
import { HStack, VStack } from "@astryxdesign/core/Layout";
import { Heading, Text } from "@astryxdesign/core/Text";
import {
  ATTENDANCE_LABELS,
  ATTENDANCE_STATUSES,
  assertNever,
  deriveAttendanceCounts,
  type EventId,
  type EventView,
} from "@event-desk/contracts";
import { useState } from "react";
import { ConfirmDialog } from "../../shared/ui/confirm-dialog";
import { AttendanceCounts } from "./attendance-counts";
import { type AttendanceNotice, type RefetchEvent, useAttendanceForm } from "./use-attendance-form";

function NoticeBanner({ notice, onReload }: { notice: AttendanceNotice; onReload: () => void }) {
  switch (notice.kind) {
    case "conflict":
      return (
        <Banner
          status="warning"
          title="Attendance changed elsewhere"
          description={`${notice.message} Your selections are kept until you choose to reload.`}
          endContent={
            <Button label="Reload saved attendance" variant="secondary" onClick={onReload} />
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
  const names = new Map(view.members.map((m) => [m.id as string, m.name]));

  return (
    <section aria-label="Attendance">
      <VStack gap={3}>
        <Heading level={2}>Attendance</Heading>
        <form
          noValidate
          onSubmit={(event) => {
            void attendance.submit(event);
          }}
        >
          <VStack gap={3}>
            {attendance.draft.map((member, index) => {
              const inputId = `attendance-${member.id}`;
              return (
                <Field key={member.id} label={names.get(member.id) ?? member.id} inputID={inputId}>
                  <select
                    id={inputId}
                    disabled={attendance.isSaving}
                    {...attendance.form.register(`members.${index}.attendance`)}
                  >
                    {ATTENDANCE_STATUSES.map((status) => (
                      <option key={status} value={status}>
                        {ATTENDANCE_LABELS[status]}
                      </option>
                    ))}
                  </select>
                </Field>
              );
            })}
            <AttendanceCounts
              saved={view.counts}
              draft={deriveAttendanceCounts(attendance.draft)}
              isDirty={attendance.isDirty}
            />
            {attendance.isDirty ? (
              <Text>
                Unsaved attendance changes. Save or discard them before generating a briefing.
              </Text>
            ) : null}
            {attendance.notice ? (
              <NoticeBanner
                notice={attendance.notice}
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
                isDisabled={!attendance.isDirty || attendance.isSaving}
                isLoading={attendance.isSaving}
              />
              {attendance.isDirty ? (
                <Button
                  variant="secondary"
                  label="Discard attendance changes"
                  isDisabled={attendance.isSaving}
                  onClick={attendance.discard}
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
          void attendance.reloadSaved();
        }}
      />
    </section>
  );
}
