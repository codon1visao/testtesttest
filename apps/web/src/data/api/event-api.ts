import {
  type EventId,
  type EventView,
  EventViewSchema,
  type GenerateBriefingRequest,
  type GenerateBriefingResponse,
  GenerateBriefingResponseSchema,
  type SaveAttendanceRequest,
  type SaveAttendanceResponse,
  SaveAttendanceResponseSchema,
  type SaveBriefingRequest,
  type SaveBriefingResponse,
  SaveBriefingResponseSchema,
  type SelectPreviewRequest,
  type SelectPreviewResponse,
  SelectPreviewResponseSchema,
  type SubmitFeedbackRequest,
  type SubmitFeedbackResponse,
  SubmitFeedbackResponseSchema,
} from "@event-desk/contracts";
import type { z } from "zod";
import { apiClient } from "../http/api-client";
import { ApiError } from "../http/api-error";

/** Contract-first at the browser edge too: a response that breaks the contract is an error, not data. */
function parseResponse<Schema extends z.ZodType>(schema: Schema, data: unknown): z.output<Schema> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new ApiError("invalid-response", "The event API sent an unexpected response.", {
      cause: result.error,
    });
  }
  return result.data;
}

const eventPath = (eventId: EventId) => `/events/${encodeURIComponent(eventId)}`;

export async function fetchEvent(eventId: EventId, signal: AbortSignal): Promise<EventView> {
  const response = await apiClient.get<unknown>(eventPath(eventId), { signal });
  return parseResponse(EventViewSchema, response.data);
}

export async function saveAttendance(
  eventId: EventId,
  body: SaveAttendanceRequest,
): Promise<SaveAttendanceResponse> {
  const response = await apiClient.put<unknown>(`${eventPath(eventId)}/attendance`, body);
  return parseResponse(SaveAttendanceResponseSchema, response.data);
}

/**
 * T5 §2: 90 s. The event API caps MANUAL_GENERATION_TIMEOUT_MS (default 60 s) at 85 s, so the
 * server always answers first; change both together.
 */
export const GENERATION_REQUEST_TIMEOUT_MS = 90_000;

export async function generateBriefing(
  eventId: EventId,
  body: GenerateBriefingRequest,
): Promise<GenerateBriefingResponse> {
  const response = await apiClient.post<unknown>(
    `${eventPath(eventId)}/briefing-generations`,
    body,
    { timeout: GENERATION_REQUEST_TIMEOUT_MS },
  );
  return parseResponse(GenerateBriefingResponseSchema, response.data);
}

export async function selectPreview(
  eventId: EventId,
  body: SelectPreviewRequest,
): Promise<SelectPreviewResponse> {
  const response = await apiClient.post<unknown>(
    `${eventPath(eventId)}/briefing-preview/select`,
    body,
  );
  return parseResponse(SelectPreviewResponseSchema, response.data);
}

export async function saveBriefing(
  eventId: EventId,
  body: SaveBriefingRequest,
): Promise<SaveBriefingResponse> {
  const response = await apiClient.put<unknown>(`${eventPath(eventId)}/briefing`, body);
  return parseResponse(SaveBriefingResponseSchema, response.data);
}

export async function submitFeedback(
  eventId: EventId,
  body: SubmitFeedbackRequest,
): Promise<SubmitFeedbackResponse> {
  const response = await apiClient.post<unknown>(`${eventPath(eventId)}/feedback`, body);
  return parseResponse(SubmitFeedbackResponseSchema, response.data);
}
