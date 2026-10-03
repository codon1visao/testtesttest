import type { EventId, GenerationId, SelectPreviewResponse } from "@event-desk/contracts";
import type { Clock } from "../../ports/clock.js";
import type { UnitOfWork } from "../../ports/unit-of-work.js";
import { AppError } from "../../shared/app-error.js";
import type { EventChangePublisher } from "../changes/event-change-publisher.js";
import { loadBriefingViews } from "./briefing-views.js";

export interface SelectPreviewCommand {
  eventId: EventId;
  generationId: GenerationId;
  expectedSelectedGenerationId: GenerationId | null;
}

export interface PreviewSelectionDeps {
  uow: UnitOfWork;
  clock: Clock;
  changes: Pick<EventChangePublisher, "publish">;
}

/**
 * TX7 (F7 "Preview ownership"): the coordinator moves the incoming preview into the editor slot.
 * Both slots are compared with what this tab last saw, inside the event lock, so another tab's
 * selection is never silently replaced.
 */
export class PreviewSelectionService {
  constructor(private readonly deps: PreviewSelectionDeps) {}

  select(command: SelectPreviewCommand): Promise<SelectPreviewResponse> {
    const { eventId, generationId } = command;
    return this.deps.uow.run(async (tx) => {
      const aggregate = await tx.events.lockForUpdate(eventId);
      const incoming = await tx.slots.incoming(eventId);
      if (incoming?.generationId !== generationId) {
        throw new AppError(
          "PREVIEW_CONFLICT",
          "This preview is no longer waiting for review. Reload to see the latest briefing.",
        );
      }
      const selected = await tx.slots.selected(eventId);
      if ((selected?.generationId ?? null) !== command.expectedSelectedGenerationId) {
        throw new AppError(
          "PREVIEW_CONFLICT",
          "The preview being edited changed in another tab. Reload to see the latest briefing.",
        );
      }

      await tx.slots.clear(eventId, "incoming");
      if (selected !== null) await tx.slots.clear(eventId, "selected");
      await tx.slots.putSelected(eventId, generationId, this.deps.clock.now());
      if (selected !== null)
        await tx.generations.deleteIfUnreferenced(eventId, selected.generationId);
      tx.afterCommit(() => this.deps.changes.publish(eventId));

      const views = await loadBriefingViews(tx, eventId, aggregate.members, aggregate.feedback);
      if (views.selectedPreview === null) {
        throw new AppError(
          "STORE_CORRUPT",
          "The selected preview could not be read back. The store needs manual recovery.",
        );
      }
      return { selectedPreview: views.selectedPreview };
    });
  }
}
