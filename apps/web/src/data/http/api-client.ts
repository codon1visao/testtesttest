import { ApiErrorBodySchema } from "@event-desk/contracts";
import axios, { type AxiosInstance } from "axios";
import { ApiError } from "./api-error";

export const API_TIMEOUT_MS = 15_000;

/** Gateway statuses a proxy sends on its own; only a contract error body proves the API answered. */
const GATEWAY_STATUSES: ReadonlySet<number> = new Set([502, 503, 504]);

/** Normalises any request failure into ApiError (T1: errors normalised, no toasts, no retries here). */
export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (!axios.isAxiosError(error))
    return new ApiError("network", "The request failed.", { cause: error });
  if (error.code === "ECONNABORTED" || error.code === "ETIMEDOUT") {
    return new ApiError("timeout", "The request timed out.", { cause: error });
  }
  const { response } = error;
  if (response === undefined)
    return new ApiError("network", "No response from the event API.", { cause: error });
  const body = ApiErrorBodySchema.safeParse(response.data);
  if (!body.success && GATEWAY_STATUSES.has(response.status)) {
    // A bare gateway answer (e.g. the dev proxy when the API is down) is a transport failure; a 504
    // may still have reached the API, so the outcome is unknown.
    return new ApiError("network", "The event API could not be reached through the gateway.", {
      status: response.status,
      cause: error,
    });
  }
  if (!body.success) {
    return new ApiError("http", `The event API answered with status ${response.status}.`, {
      status: response.status,
      cause: error,
    });
  }
  const { code, message, field, retryAfterMs } = body.data.error;
  return new ApiError("http", message, {
    status: response.status,
    code,
    ...(field === undefined ? {} : { field }),
    ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
    cause: error,
  });
}

function createApiClient(): AxiosInstance {
  const client = axios.create({
    baseURL: "/api",
    timeout: API_TIMEOUT_MS,
    headers: { Accept: "application/json" },
  });
  client.interceptors.response.use(undefined, (error: unknown) =>
    Promise.reject(toApiError(error)),
  );
  return client;
}

export const apiClient = createApiClient();
