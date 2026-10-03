import OpenAI from "openai";

/** Fixed endpoint (S1): set explicitly so an OPENAI_BASE_URL in the environment cannot redirect calls. */
export const OPENAI_BASE_URL = "https://api.openai.com/v1";

export interface OpenAIClientOptions {
  apiKey: string;
  timeoutMs: number;
  /** Tests only: the real SDK over a fake transport. */
  fetch?: (url: string | URL | Request, init?: RequestInit) => Promise<Response>;
}

/** The single retry owner is the event backend (F8): the SDK never retries. */
export function createOpenAIClient(options: OpenAIClientOptions): OpenAI {
  return new OpenAI({
    apiKey: options.apiKey,
    baseURL: OPENAI_BASE_URL,
    maxRetries: 0,
    timeout: options.timeoutMs,
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  });
}
