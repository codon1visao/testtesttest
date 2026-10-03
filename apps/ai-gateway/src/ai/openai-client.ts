import OpenAI from "openai";

/** Fixed endpoint (S1): set explicitly so an OPENAI_BASE_URL in the environment cannot redirect calls. */
export const OPENAI_BASE_URL = "https://api.openai.com/v1";

export interface OpenAIClientOptions {
  apiKey: string;
  timeoutMs: number;
  /** Tests only: the real SDK over a fake transport. */
  fetch?: (url: string | URL | Request, init?: RequestInit) => Promise<Response>;
}

/**
 * The single retry owner is the event backend (F8): the SDK never retries. SDK logging is pinned
 * off: OPENAI_LOG=debug would print request and response bodies outside pino's redaction (S1).
 */
export function createOpenAIClient(options: OpenAIClientOptions): OpenAI {
  return new OpenAI({
    apiKey: options.apiKey,
    baseURL: OPENAI_BASE_URL,
    maxRetries: 0,
    timeout: options.timeoutMs,
    logLevel: "off",
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  });
}
