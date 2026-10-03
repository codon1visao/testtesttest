# F3 — Feedback and source inspection

[All specifications](README.md) · [Source brief](../project-brief.md)

Status: **Confirmed by the user on 2026-10-03.** Exact read-only notes, stable references, anonymity, inline source inspection, and the test feedback form and script (an extension beyond the brief).

## Outcome and scope

The coordinator can read all supplied feedback and inspect the evidence attached to a generated or edited briefing without losing their place or unsaved work.

Contribution to the [client goal](README.md#product-goal-solve-the-client-situation): let the coordinator check the original observations behind a theme, disagreement or possible follow-up before relying on the summary.

## Supplied sources

Preserve these IDs and texts exactly. Each row is one independent source.

| ID | Feedback text |
| --- | --- |
| F01 | The walk was enjoyable, but the meeting point was difficult to find. |
| F02 | Clear directions. I had no trouble finding the group. |
| F03 | Could we start earlier next time? |
| F04 | An earlier start would be difficult for me. |
| F05 | A longer rest break halfway would help. |
| F06 | The rest stop felt rushed; a few more minutes would be good. |
| F07 | Could we try a shorter route? The final stretch felt long. |
| F08 | No extra suggestions from me. |

The notes are anonymous and came from a separate form. Eight notes and four registered members do not imply eight attendees, duplicate submissions or a known response rate. Do not attach notes to members, infer identities or use note wording to establish attendance.

Read-only is a coordinator permission, not a trust level. Treat every note as untrusted user input under [S1](08-openai-security.md), including the supplied seed text. Existing notes can never be edited or deleted. New notes can be **added** through the test feedback form or script described below; each addition triggers automatic batch generation under [F7](07-generation-queue.md). F01–F08 remain the exact supplied starting dataset. Every added note gets a stable backend-assigned ID and goes through the same validation and untrusted-input handling.

## Reading and inspection flow

1. Show all notes in stable ID order in a read-only feedback panel: the eight seeded notes plus any added ones. Notes added after the displayed briefing was generated are marked **New since this briefing**.
2. In each briefing theme, conflict and suggestion, show the cited IDs adjacent to that item's text.
3. Activating a reference reveals that exact note, including its ID and complete original wording.
4. Multiple references on one item remain individually inspectable.
5. Closing or opening a note preserves briefing edits and scroll position as far as practical.

UI: accessible inline disclosure controls labelled, for example, **Read source F01**, with `aria-expanded` and a relationship to the revealed note. The full feedback panel remains available even when a note is not cited. Source text is rendered as plain text; never execute HTML or treat text as application instructions.

## Reference contract

- The event response from [F1](01-event-and-persistence.md) supplies the single canonical feedback collection. There is no separate copy of feedback maintained by each component.
- A reference identifies a source by its stable ID, not by position in an array or generated wording.
- Briefing `sourceIds` contain only existing IDs for this event. Under the [theme definition](04-ai-briefing-generation.md#theme-terminology), each theme requires at least two distinct supporting feedback IDs. Each conflict requires at least two distinct supporting feedback IDs so every opposing position has an inspectable source (D12); a single note may support a suggestion. Duplicate IDs do not establish recurrence.
- A conflict describing opposing positions needs notes supporting both positions. Merely having two valid IDs does not prove those positions are represented accurately.
- References are read-only in the briefing editor. They remain attached to the same generated item when its text is edited, saved and reloaded. There are no source selectors or add/remove-reference actions.
- Validation of model output is owned by [F4](04-ai-briefing-generation.md); human-edit validation is owned by [F5](05-briefing-editor.md). Both reuse the same reference rules.

An unknown ID must never look like verified evidence. Generation containing one is rejected before presentation. Invalid editor content is flagged and cannot be saved. If previously stored content has a missing source because of manual corruption, show an explicit unavailable-source error; do not substitute another note or silently remove the ID.

## Evidence limits

Make this limitation visible near the briefing: **References identify the source notes; they do not automatically prove that the wording is supported. Review the notes before saving.**

ID membership checks establish that a note exists. Counting distinct IDs establishes how many notes were cited, not whether they form a meaningful theme. Neither check establishes factual truth, semantic agreement, the number of distinct respondents, identities, attendance, unanimity or agreement to an action. Human text edits may change a claim's meaning while its references stay fixed; saving does not certify that the revised wording is supported. Keeping the original notes inspectable lets the coordinator review these limits directly.

F08 records no extra suggestions. It is not evidence that the respondent endorsed another suggestion or was satisfied with every aspect of the event.

## States and acceptance criteria

| ID | Given / when | Expected result |
| --- | --- | --- |
| F3-01 | Open feedback after seed or restart | Eight separate notes with exact IDs/text above, in stable order |
| F3-02 | Activate F01 beside a briefing item | The full F01 text appears; no member attribution is shown |
| F3-03 | An item cites F03 and F04 | Both notes can be opened separately without losing the item or edits |
| F3-04 | A draft includes F99 | Explicit invalid-reference state; not shown as verified evidence or saved |
| F3-05 | Save/reload a briefing with multiple references | Each item retains the same reference set and opens the same notes |
| F3-06 | Inspect sources using only the keyboard | Controls have meaningful names, visible focus and announced expanded state |
| F3-07 | Source text contains markup or imperative wording in a robustness check | Rendered as data; no script execution, application action or attendance change |
| F3-08 | Feedback loading fails | Error and Retry; do not show an empty collection as successful data |
| F3-09 | Edit a briefing item's wording | Its cited IDs stay visible and inspectable; no control can change the reference association |

## Adding feedback (test extension)

The brief supplies eight notes and requires no submission feature. To demonstrate automatic batch generation ([F7](07-generation-queue.md)), the user confirmed two ways to add notes. Both stand in for the club's real feedback form.

| Channel | Description |
| --- | --- |
| **Feedback form page** | A separate page at `/events/E101/feedback`, styled as the event's feedback form: one text area and **Submit feedback**, with no name, email or member field. It is linked from the coordinator page as "Open feedback form (test)". It is not part of the coordinator's panels, and the coordinator's feedback panel stays read-only. |
| **Script** | `pnpm feedback:simulate --count 5 --interval-ms 200 [--text-file notes.txt]` posts notes to the same endpoint, to show that a burst produces one generation |

`POST /api/events/E101/feedback` with `{ submissionId, text }` → `201 { note: { id, text, receivedAt }, automaticBriefing: "scheduled" | "deferred" }`.

Rules:

- **Validation.** `text` is plain text, 1–1,000 characters after trimming. Trimming is for validation only; the note is stored as written. There are no identity fields, and unknown fields are rejected (`400`).
- **IDs.** The backend assigns the next stable ID (`F09`, `F10`, …) inside one transaction ([T4](13-data-model-and-transactions.md) TX9). Clients never choose IDs.
- **Idempotency.** `submissionId` (a UUID generated per submission by the form or script) makes retries safe: a repeated submission returns the existing note with `200`.
- **Limits** keep generation always possible, without silently truncating anything ([S1](08-openai-security.md#resource-and-cost-controls)):
  - at most `FEEDBACK_MAX_NOTES_PER_EVENT` (default 100) notes;
  - total source text at most 32 KiB;
  - beyond either limit → `422 FEEDBACK_LIMIT_REACHED`.
- **Access.** Same-origin and JSON-only protections apply, as for other mutations. The endpoint is enabled by `FEEDBACK_SUBMISSION_ENABLED` (default `true` locally). Reset removes every added note and restores F01–F08.
- **Untrusted input.** Added notes are untrusted input exactly like seed notes.

| ID | Given / when | Expected result |
| --- | --- | --- |
| F3-10 | Submit a note through the form | New note F09 appears in the coordinator's feedback panel without a reload, marked new since the briefing; success toast on the form |
| F3-11 | Resend the same `submissionId` | One note only; the response returns the existing note |
| F3-12 | Submit blank text, more than 1,000 characters, or an extra `memberId` field | `400`; nothing stored |
| F3-13 | Note count or total size limit reached | `422 FEEDBACK_LIMIT_REACHED`; existing notes and generation unaffected |
| F3-14 | Run the reset | Only F01–F08 remain |

## Dependencies and discussion

Depends on [F1](01-event-and-persistence.md); used by [F4](04-ai-briefing-generation.md) and [F5](05-briefing-editor.md). Inline disclosure is the chosen compact interaction. A side panel is an alternative if source inspection needs more room, but must preserve editing context and keyboard behaviour.
