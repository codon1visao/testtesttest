import type { GeneratedSections } from "@event-desk/contracts";
import type { BriefingGenerateV1Input } from "@event-desk/contracts/gateway-rpc";

export interface BriefingModelOutput {
  sections: GeneratedSections;
  /** The provider's response ID, for support correlation in logs and provenance. */
  providerRequestId: string | null;
  usage: { inputTokens: number; outputTokens: number };
}

/** The Gateway's only model port. One call = exactly one provider request; failures are GatewayErrors. */
export interface BriefingModel {
  readonly model: string;
  readonly promptVersion: string;
  generate(input: BriefingGenerateV1Input, signal: AbortSignal): Promise<BriefingModelOutput>;
}
