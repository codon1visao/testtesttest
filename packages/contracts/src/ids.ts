import { z } from "zod";

// Business IDs are exact ASCII (T4: ascii_bin, VARCHAR(16)); generated rows use UUIDv7.
export const EventIdSchema = z
  .string()
  .regex(/^E\d{3,15}$/, "Expected an event ID such as E101")
  .brand<"EventId">();
export type EventId = z.infer<typeof EventIdSchema>;

export const MemberIdSchema = z
  .string()
  .regex(/^M\d{2,15}$/, "Expected a member ID such as M01")
  .brand<"MemberId">();
export type MemberId = z.infer<typeof MemberIdSchema>;

export const FeedbackIdSchema = z
  .string()
  .regex(/^F\d{2,15}$/, "Expected a feedback ID such as F01")
  .brand<"FeedbackId">();
export type FeedbackId = z.infer<typeof FeedbackIdSchema>;

// Lowercase only: the column is ascii_bin, so an uppercase UUID could never match its row.
export const GenerationIdSchema = z
  .uuid({ version: "v7" })
  .regex(/^[0-9a-f-]{36}$/, "Expected a lowercase UUID")
  .brand<"GenerationId">();
export type GenerationId = z.infer<typeof GenerationIdSchema>;

/** A manual run ID (`manual:<uuid>`) or a BullMQ batch job ID. */
export const RunIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9:_-]{1,64}$/, "Expected a run ID of 1-64 safe characters")
  .brand<"RunId">();
export type RunId = z.infer<typeof RunIdSchema>;
