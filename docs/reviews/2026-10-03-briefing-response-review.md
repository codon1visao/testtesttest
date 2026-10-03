# Briefing generation response — review

Scope: what OpenAI returns for a briefing, and how that response moves through the AI Gateway and event API to the coordinator. It covers the specs in [F4](../specs/04-ai-briefing-generation.md), [S1](../specs/08-openai-security.md), [F8](../specs/09-ai-gateway.md), [T3](../specs/12-architecture-and-repository.md) and [T4](../specs/13-data-model-and-transactions.md).

> **The example output in §3 is hand-written to match the specs. It is not a real model response.** No code or API key exists yet. A real response is captured by `pnpm smoke:live` during implementation (T3 §12) and should be compared against this document.

## 1. The response at each stage

| Stage | Shape | Produced by |
| --- | --- | --- |
| ① OpenAI Responses API | Strict JSON matching the schema in §2: `feedbackSummary`, `themes`, `conflicts`, `suggestions` only | Model, via the Agents SDK (`finalOutput`, parsed by the Zod `outputType`) |
| ② Gateway → event API (TCP) | RPC success or error envelope (§4) | AI Gateway: ① plus model/prompt/usage metadata, or a normalised error |
| ③ Stored + returned | `BriefingView` (§5): the event API adds the deterministic attendance overview, provenance and freshness | Event API (validated, then committed in T4 TX5) |

The model never produces the attendance overview, counts, generation IDs, or anything about members. It writes only the feedback summary and the three evidence sections.

### Mapped to the client goal

> The coordinator needs a reliable attendance record and a useful briefing: what happened, which themes recur, where people disagree, and what might be worth following up.

| Goal question (UI heading) | Content | Written by | Kind |
| --- | --- | --- | --- |
| What happened | `attendanceOverview` | Code, from saved records | Fact |
| What happened | `feedbackSummary` | Model, citing ≥ 1 note | Reported experience |
| Which themes recur | `themes[]` | Model, ≥ 2 notes each | Reported pattern |
| Where people disagree | `conflicts[]` | Model, ≥ 2 notes each (one per side) | Reported difference |
| What might be worth following up | `suggestions[]` | Model, ≥ 1 note each | Tentative proposal |

## 2. Structured Output schema sent to OpenAI

The schema is built **per request** by `buildGeneratedSectionsSchema(feedbackIds)` (packages/contracts). This shows the JSON Schema it maps to for the seed data:

```json
{
  "type": "json_schema",
  "name": "briefing_sections_v1",
  "strict": true,
  "schema": {
    "type": "object",
    "additionalProperties": false,
    "required": ["feedbackSummary", "themes", "conflicts", "suggestions"],
    "properties": {
      "feedbackSummary": { "$ref": "#/$defs/summary" },
      "themes":      { "type": "array", "maxItems": 10, "items": { "$ref": "#/$defs/theme" } },
      "conflicts":   { "type": "array", "maxItems": 10, "items": { "$ref": "#/$defs/conflict" } },
      "suggestions": { "type": "array", "maxItems": 10, "items": { "$ref": "#/$defs/suggestion" } }
    },
    "$defs": {
      "feedbackId": { "type": "string", "enum": ["F01", "F02", "F03", "F04", "F05", "F06", "F07", "F08"] },
      "summary": {
        "type": "object", "additionalProperties": false, "required": ["text", "sourceIds"],
        "properties": {
          "text":      { "type": "string", "description": "1-3 sentences on what the notes report overall; no attendance counts" },
          "sourceIds": { "type": "array", "minItems": 1, "maxItems": 8, "items": { "$ref": "#/$defs/feedbackId" } }
        }
      },
      "theme": {
        "type": "object", "additionalProperties": false, "required": ["text", "sourceIds"],
        "properties": {
          "text":      { "type": "string", "description": "A recurring pattern or shared concern across notes" },
          "sourceIds": { "type": "array", "minItems": 2, "maxItems": 8, "items": { "$ref": "#/$defs/feedbackId" } }
        }
      },
      "conflict": {
        "type": "object", "additionalProperties": false, "required": ["text", "sourceIds"],
        "properties": {
          "text":      { "type": "string", "description": "How notes differ, citing a note for each side" },
          "sourceIds": { "type": "array", "minItems": 2, "maxItems": 8, "items": { "$ref": "#/$defs/feedbackId" } }
        }
      },
      "suggestion": {
        "type": "object", "additionalProperties": false, "required": ["text", "sourceIds"],
        "properties": {
          "text":      { "type": "string", "description": "A tentative follow-up (consider / check / ask)" },
          "sourceIds": { "type": "array", "minItems": 1, "maxItems": 8, "items": { "$ref": "#/$defs/feedbackId" } }
        }
      }
    }
  }
}
```

Design points for review:

- **IDs are an enum built from the request's own notes.** The model cannot even produce `F99`, and it cannot cite a note that was not sent. The backend re-checks this anyway (F4 rule 3), because schema adherence is not a security boundary.
- **Descriptions contain no note text.** They are fixed application strings, so untrusted text never enters the schema (S1).
- **Strict mode** requires every property to be listed in `required` and `additionalProperties: false`, so there are no optional or extra fields. A "write-like" field such as `updateAttendance` is impossible.
- **Some keywords may be ignored.** Whether the provider honours `minItems`/`maxItems` is verified during implementation. If it ignores them, nothing changes in behaviour: the event API's `validateEvidenceSections()` remains the authority for the 1 / 2 / 2 / 1 minimums (summary / theme / conflict / suggestion), the 8-source cap and the text bounds (summary 600, items 1,000).

## 3. Example (illustrative) — seed data

**Input** (user-data message; the developer instructions are in [F4](../specs/04-ai-briefing-generation.md#input-and-prompt-contract)):

```json
{
  "event": { "name": "Saturday Walk", "status": "ended" },
  "attendanceCounts": { "registered": 4, "attended": 1, "absent": 2, "notRecorded": 1 },
  "feedbackNotes": [
    { "id": "F01", "text": "The walk was enjoyable, but the meeting point was difficult to find." },
    { "id": "F02", "text": "Clear directions. I had no trouble finding the group." },
    { "id": "F03", "text": "Could we start earlier next time?" },
    { "id": "F04", "text": "An earlier start would be difficult for me." },
    { "id": "F05", "text": "A longer rest break halfway would help." },
    { "id": "F06", "text": "The rest stop felt rushed; a few more minutes would be good." },
    { "id": "F07", "text": "Could we try a shorter route? The final stretch felt long." },
    { "id": "F08", "text": "No extra suggestions from me." }
  ]
}
```

**① Output that would pass** (hand-written to the spec):

```json
{
  "feedbackSummary": {
    "text": "Feedback describes the walk as enjoyable, with comments mostly about logistics: finding the meeting point, the start time, rest breaks and route length. One note had no further suggestions.",
    "sourceIds": ["F01", "F02", "F03", "F04", "F05", "F06", "F07", "F08"]
  },
  "themes": [
    {
      "text": "Two notes ask for more rest time partway through the walk: one suggests a longer break halfway, and another says the rest stop felt rushed.",
      "sourceIds": ["F05", "F06"]
    }
  ],
  "conflicts": [
    {
      "text": "Notes differ on the meeting point: one note found it difficult to find, while another reports clear directions and no trouble finding the group.",
      "sourceIds": ["F01", "F02"]
    },
    {
      "text": "Notes differ on the start time: one note asks whether the walk could start earlier next time, while another says an earlier start would be difficult.",
      "sourceIds": ["F03", "F04"]
    }
  ],
  "suggestions": [
    {
      "text": "Consider lengthening the halfway rest stop by a few minutes.",
      "sourceIds": ["F05", "F06"]
    },
    {
      "text": "Check whether the meeting-point directions could be made clearer; one note found it hard to find, while another had no trouble.",
      "sourceIds": ["F01", "F02"]
    },
    {
      "text": "Before changing the start time, consider gathering more input on preferred start times, since one note asks for an earlier start and another says it would be difficult.",
      "sourceIds": ["F03", "F04"]
    },
    {
      "text": "Consider whether a shorter route option is worth trialling; one note found the final stretch long.",
      "sourceIds": ["F07"]
    }
  ]
}
```

Why this passes F4's interpretation table:

| Check | Result |
| --- | --- |
| F05 + F06 form **one** theme (not two); F07 is **not** a theme | ✓ one theme; F07 only in a suggestion |
| Both disagreements kept, each citing **both** sides (D12) | ✓ F01/F02 and F03/F04 |
| Conflicts are worded as differences between **notes**, not members/attendees, with no head counts | ✓ "one note… another…" |
| Follow-ups are tentative ("consider", "check") and the start-time one cites the objection too | ✓ no "the next walk will start earlier" |
| No attendance claims, no absence reasons, no identities | ✓ |
| F08 is not presented as agreement with anything | ✓ only mentioned in the summary as "no further suggestions" |
| What happened is answered without the model touching attendance | ✓ summary describes reported experience; counts come from code |

## 4. ② Gateway → event API envelope (TCP)

Success:

```json
{
  "v": 1, "requestId": "0192…a1", "runId": "0192…7f", "attemptId": "0192…b3", "ok": true,
  "result": {
    "sections": { "themes": [ … ], "conflicts": [ … ], "suggestions": [ … ] },
    "meta": { "model": "<pinned model>", "promptVersion": "briefing-v1",
              "providerRequestId": "resp_…", "usage": { "inputTokens": 612, "outputTokens": 418 } }
  }
}
```

Failure (examples):

```json
{ "v": 1, "requestId": "…", "runId": "…", "attemptId": "…", "ok": false,
  "error": { "code": "PROVIDER_REFUSED", "message": "The model declined to produce a briefing.", "notSent": false } }
{ "v": 1, "requestId": "…", "runId": "…", "attemptId": "…", "ok": false,
  "error": { "code": "PROVIDER_RATE_LIMITED", "message": "Provider rate limit reached.", "notSent": false, "retryAfterMs": 20000 } }
```

Never included: raw provider payloads, the API key, stack traces or note text in errors (F8, S1).

## 5. ③ What the coordinator receives (`BriefingView`, abbreviated)

```json
{
  "trigger": "manual",
  "provenance": {
    "generationId": "0192…c4", "jobId": "0192…7f", "generatedAt": "2026-10-03T14:02:05.412Z",
    "model": "<pinned model>", "promptVersion": "briefing-v1",
    "input": {
      "attendance": [ { "memberId": "M01", "attendance": "attended" }, { "memberId": "M02", "attendance": "absent" },
                      { "memberId": "M03", "attendance": "not_recorded" }, { "memberId": "M04", "attendance": "absent" } ],
      "counts": { "registered": 4, "attended": 1, "absent": 2, "notRecorded": 1 },
      "feedbackIds": ["F01","F02","F03","F04","F05","F06","F07","F08"], "feedbackDigest": "9c1e…"
    }
  },
  "content": {
    "attendanceOverview": "4 registered members: 1 attended, 2 absent, 1 not recorded (attendance is incomplete).",
    "feedbackSummary": { "text": "Feedback describes the walk as enjoyable, with comments mostly about logistics…", "sourceIds": ["F01","F02","F03","F04","F05","F06","F07","F08"] },
    "themes":      [ { "text": "Two notes ask for more rest time…", "sourceIds": ["F05","F06"] } ],
    "conflicts":   [ { "text": "Notes differ on the meeting point…", "sourceIds": ["F01","F02"] }, { "…": "…" } ],
    "suggestions": [ { "text": "Consider lengthening the halfway rest stop…", "sourceIds": ["F05","F06"] }, { "…": "…" } ]
  },
  "freshness": { "current": true, "attendanceChanges": [], "newFeedbackIds": [] }
}
```

The `attendanceOverview` is built by code from the captured counts (F4); the model never writes it. Member IDs appear only in provenance, for freshness, and are never sent to the model.

## 6. Responses that are rejected

| ① Model output | Caught by | Outcome |
| --- | --- | --- |
| `"sourceIds": ["F99"]` | Schema enum (provider) **and** `validateEvidenceSections` **and** the T4 FK | `OUTPUT_INVALID`; nothing stored |
| Theme citing only `["F05"]` or `["F05","F05"]` | `minItems` + distinct-ID check after normalisation | `OUTPUT_INVALID` (F4-12) |
| Conflict citing only `["F03"]` | Conflict minimum of 2 distinct notes (D12) | `OUTPUT_INVALID` (F4-15) |
| Missing `feedbackSummary`, or a summary with no cited note | Strict schema `required` + summary minimum of 1 | `OUTPUT_INVALID` |
| Summary that states counts, e.g. "Only one person attended" | **Not detectable structurally**; the prompt forbids it | Caught by the coordinator's review; the code-built overview stays authoritative |
| Extra field such as `"updateAttendance": {…}` | `additionalProperties: false` + Zod strict parse | `OUTPUT_INVALID` (S1-04) |
| Blank text or more than 1,000 characters | Backend text bounds (no silent truncation) | `OUTPUT_INVALID` |
| Refusal | Agents SDK / Responses refusal handling | `PROVIDER_REFUSED` |
| Hits the output-token limit (`incomplete`) | Response status check | `OUTPUT_INCOMPLETE`; a partial briefing is never shown |
| Schema-valid but misleading, e.g. "Everyone wanted an earlier start" citing F03/F04 | **Not detectable structurally** | Stored as a preview; caught only by the coordinator's source review. This is the evidence limit stated in F3/F4. |

## 7. Decisions (2026-10-03)

| Question | Decision |
| --- | --- |
| Does the response answer the client goal? | Yes, after adding `feedbackSummary` (D16). "What happened" combines the code-built attendance fact and a cited summary of the reported experience. |
| Notes not cited | Covered by the feedback summary (F08 appears there); no separate "not cited" list |
| Link suggestions to themes or conflicts | No. Shared source IDs already show the connection. |
| Order of items | Keep the model's order within each section. No sorting by note count, which would imply "more notes = more important". |
| Temperature | Low, if the pinned model supports it; structure is fixed either way |
