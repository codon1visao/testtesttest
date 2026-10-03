import type {
  BriefingTextEdits,
  EventId,
  GenerationId,
  SaveBriefingResponse,
} from "@event-desk/contracts";
import type { Clock } from "../../ports/clock.js";
import type { UnitOfWork } from "../../ports/unit-of-work.js";
import { AppError } from "../../shared/app-error.js";
import type { EventChangePublisher } from "../changes/event-change-publisher.js";
import { loadBriefingViews } from "./briefing-views.js";
import { applyTextEdits, sameAsSaved } from "./domain/apply-text-edits.js";

export interface SaveBriefingCommand {
  eventId: EventId;
  baseBriefingRevision: number;
  generationId: GenerationId;
  textEdits: BriefingTextEdits;
}

export interface BriefingSaveDeps {
  uow: UnitOfWork;
  clock: Clock;
  changes: Pick<EventChangePublisher, "publish">;
}

const notAvailable = () =>
  new AppError(
    "GENERATION_NOT_AVAILABLE",
    "This briefing is no longer available to save. Reload to see the latest briefing.",
  );

/**
 * TX8 (F5 "API contract", T4): the only path that writes the saved briefing. Structure,
 * references and provenance come from the stored generation; the client supplies wording only.
 */
export class BriefingSaveService {
  constructor(private readonly deps: BriefingSaveDeps) {}

  save(command: SaveBriefingCommand): Promise<SaveBriefingResponse> {
    const { eventId, generationId } = command;
    return this.deps.uow.run(async (tx) => {
      const aggregate = await tx.events.lockForUpdate(eventId);
      if (aggregate.briefingRevision !== command.baseBriefingRevision) {
        throw new AppError(
          "BRIEFING_CONFLICT",
          "The briefing was saved elsewhere since you loaded it. Your text is kept; reload to see the saved briefing.",
        );
      }
      const saved = await tx.savedBriefings.get(eventId);
      const selected = await tx.slots.selected(eventId);
      const fromSelected = selected?.generationId === generationId;
      // Never the incoming slot: a preview is saved only after the coordinator selected it (F7).
      if (!fromSelected && saved?.generationId !== generationId) throw notAvailable();
      const structure = await tx.generations.structure(eventId, generationId);
      if (structure === null) throw notAvailable();

      const applied = applyTextEdits(structure, command.textEdits);
      if (!applied.ok) throw new AppError(applied.code, applied.message, { field: applied.field });

      let briefingRevision = aggregate.briefingRevision;
      if (fromSelected || !sameAsSaved(saved, generationId, applied.wording)) {
        // T4 TX8 steps 1–5, in an order that keeps every foreign key valid.
        await tx.savedBriefings.replace({
          eventId,
          generationId,
          ...applied.wording,
          savedAt: this.deps.clock.now(),
        });
        if (fromSelected) await tx.slots.clear(eventId, "selected");
        if (saved !== null && saved.generationId !== generationId) {
          await tx.generations.deleteIfUnreferenced(eventId, saved.generationId);
        }
        await tx.events.bumpBriefingRevision(eventId);
        briefingRevision += 1;
        tx.afterCommit(() => this.deps.changes.publish(eventId));
      }

      const views = await loadBriefingViews(tx, eventId, aggregate.members, aggregate.feedback);
      if (views.savedBriefing === null) {
        throw new AppError(
          "STORE_CORRUPT",
          "The saved briefing could not be read back. The store needs manual recovery.",
        );
      }
      return {
        savedBriefing: views.savedBriefing,
        briefingRevision,
        selectedPreview: views.selectedPreview,
      };
    });
  }
}
