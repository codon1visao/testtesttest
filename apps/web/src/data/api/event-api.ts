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

/** Longer than the server's 60 s run deadline (MANUAL_GENERATION_TIMEOUT_MS), so the server answers first. */
export const GENERATION_REQUEST_TIMEOUT_MS = 75_000;

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
