import { validateEvidenceSections } from "@event-desk/contracts";
import type {
  BriefingGenerateV1Request,
  BriefingGenerateV1Result,
} from "@event-desk/contracts/gateway-rpc";
import type { LaneGate } from "../limits/lane-gate.js";
import type { UsageBackstop } from "../limits/usage-backstop.js";
import { GatewayError } from "../shared/gateway-error.js";
import type { BriefingModel } from "./briefing-model.js";

export interface BriefingGenerateV1Deps {
  /** null when no provider is configured. */
  model: BriefingModel | null;
  lanes: LaneGate;
  backstop: UsageBackstop;
  now: () => Date;
  maxCallMs: number;
  responseMarginMs: number;
}

export type BriefingGenerateV1 = (
  request: BriefingGenerateV1Request,
) => Promise<BriefingGenerateV1Result>;

export function createBriefingGenerateV1(deps: BriefingGenerateV1Deps): BriefingGenerateV1 {
  return async (request) => {
    const { model } = deps;
    if (model === null) {
      throw new GatewayError(
        "PROVIDER_NOT_CONFIGURED",
        "The Gateway has no AI provider configured.",
        { notSent: true },
      );
    }

    // The caller's deadline, never extended, and capped by our own ceiling (F8, S1).
    const now = deps.now().getTime();
    const deadline = Math.min(Date.parse(request.deadlineAt), now + deps.maxCallMs);
    const modelBudgetMs = deadline - now - deps.responseMarginMs;
    if (modelBudgetMs <= 0) {
      throw new GatewayError(
        "DEADLINE_EXCEEDED",
        "The request arrived too close to its deadline.",
        { notSent: true },
      );
    }

    const release = deps.lanes.tryEnter(request.lane);
    if (release === null) {
      throw new GatewayError(
        "GATEWAY_UNAVAILABLE",
        "The Gateway is already running a call on this lane.",
        {
          notSent: true,
        },
      );
    }
    try {
      if (!deps.backstop.tryConsume()) {
        throw new GatewayError(
          "DAILY_LIMIT_REACHED",
          "The Gateway's daily provider-call limit is reached.",
          {
            notSent: true,
          },
        );
      }
      const output = await model.generate(request.input, AbortSignal.timeout(modelBudgetMs));
      const evidence = validateEvidenceSections(
        output.sections,
        request.input.feedback.map((note) => note.id),
      );
      if (!evidence.ok) {
        throw new GatewayError(
          "OUTPUT_INVALID",
          "The model's briefing does not meet the evidence rules.",
          {
            notSent: false,
          },
        );
      }
      return {
        sections: evidence.sections,
        model: model.model,
        promptVersion: model.promptVersion,
        providerRequestId: output.providerRequestId,
        usage: output.usage,
      };
    } finally {
      release();
    }
  };
}
