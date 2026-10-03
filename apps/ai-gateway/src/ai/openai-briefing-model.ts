import { buildGeneratedSectionsSchema } from "@event-desk/contracts";
import type { BriefingGenerateV1Input } from "@event-desk/contracts/gateway-rpc";
import { Agent, Runner, setTracingDisabled } from "@openai/agents-core";
import { OpenAIProvider } from "@openai/agents-openai";
import type OpenAI from "openai";
import type { ReasoningEffort } from "../config/env.js";
import type { BriefingModel } from "../operations/briefing-model.js";
import { GatewayError } from "../shared/gateway-error.js";
import {
  BRIEFING_INSTRUCTIONS,
  buildSourceDataMessage,
  PROMPT_VERSION,
} from "./briefing-prompt.js";
import { mapRunFailure } from "./provider-error-mapper.js";

export interface OpenAIBriefingModelSettings {
  model: string;
  maxOutputTokens: number;
  reasoningEffort: ReasoningEffort | undefined;
}

/**
 * The one briefing agent (ADR 0005): strict structured output built from this request's note IDs,
 * no tools or handoffs, one turn, `store: false`, SDK retries off, tracing off for every run.
 */
export function createOpenAIBriefingModel(
  client: OpenAI,
  settings: OpenAIBriefingModelSettings,
): BriefingModel {
  // S1: no trace export at all, in addition to tracingDisabled on every run.
  setTracingDisabled(true);
  const runner = new Runner({
    modelProvider: new OpenAIProvider({ openAIClient: client, useResponses: true }),
    tracingDisabled: true,
    traceIncludeSensitiveData: false,
  });

  // Everything that can throw (schema, agent, run) runs inside generate's try, so the port
  // only ever throws GatewayError.
  async function runAgent(input: BriefingGenerateV1Input, signal: AbortSignal) {
    const outputType = buildGeneratedSectionsSchema(input.feedback.map((note) => note.id));
    const agent = new Agent({
      name: "event-briefing",
      instructions: BRIEFING_INSTRUCTIONS,
      model: settings.model,
      outputType,
      tools: [],
      handoffs: [],
      modelSettings: {
        store: false,
        maxTokens: settings.maxOutputTokens,
        retry: { maxRetries: 0 },
        ...(settings.reasoningEffort === undefined
          ? {}
          : { reasoning: { effort: settings.reasoningEffort } }),
      },
    });
    const result = await runner.run(
      agent,
      [{ role: "user", content: buildSourceDataMessage(input) }],
      { maxTurns: 1, signal },
    );
    return { outputType, result };
  }

  return {
    model: settings.model,
    promptVersion: PROMPT_VERSION,
    async generate(input, signal) {
      let run;
      try {
        run = await runAgent(input, signal);
      } catch (error) {
        throw mapRunFailure(error, signal);
      }
      const { outputType, result } = run;

      // The SDK already parsed with outputType; parsing again narrows the type and guards upgrades.
      const parsed = outputType.safeParse(result.finalOutput);
      if (!parsed.success) {
        throw new GatewayError(
          "OUTPUT_INVALID",
          "The model returned output that does not match the briefing format.",
          {
            notSent: false,
          },
        );
      }
      const responses = result.rawResponses;
      return {
        sections: parsed.data,
        providerRequestId: responses.at(-1)?.responseId ?? null,
        usage: {
          inputTokens: responses.reduce((sum, response) => sum + response.usage.inputTokens, 0),
          outputTokens: responses.reduce((sum, response) => sum + response.usage.outputTokens, 0),
        },
      };
    },
  };
}
