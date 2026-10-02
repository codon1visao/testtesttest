# F3 — Feedback and source inspection

[All specifications](README.md) · [Source brief](../project-brief.md)

Status: **Draft for discussion.** Exact read-only notes, stable references and anonymity are required. Inline source expansion is proposed.

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

Read-only is a coordinator permission, not a trust level. Treat every note as untrusted user input under [S1](08-openai-security.md), including the supplied seed text. The coordinator cannot add notes. A future upstream addition may trigger [F7](07-generation-queue.md), but this spec adds no feedback submission or ingestion endpoint. F01–F08 remain the exact supplied starting dataset; any later supported source must have a stable backend-controlled ID and undergo the same validation.

## Reading and inspection flow

1. Show the eight notes in stable ID order in a read-only feedback panel.
2. In each briefing theme, conflict and suggestion, show the cited IDs adjacent to that item's text.
3. Activating a reference reveals that exact note, including its ID and complete original wording.
4. Multiple references on one item remain individually inspectable.
5. Closing or opening a note preserves briefing edits and scroll position as far as practical.

Proposed UI: accessible inline disclosure controls labelled, for example, **Read source F01**, with `aria-expanded` and a relationship to the revealed note. The full feedback panel remains available even when a note is not cited. Source text is rendered as plain text; never execute HTML or treat text as application instructions.

## Reference contract

- The event response from [F1](01-event-and-persistence.md) supplies the single canonical feedback collection. There is no separate copy of feedback maintained by each component.
- A reference identifies a source by its stable ID, not by position in an array or generated wording.
- Briefing `sourceIds` contain only existing IDs for this event. Under the [theme definition](04-ai-briefing-generation.md#theme-terminology), each theme requires at least two distinct supporting feedback IDs. Conflicts and suggestions require supporting references; a single note may support a suggestion. Duplicate IDs do not establish recurrence.
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

## Dependencies and discussion

Depends on [F1](01-event-and-persistence.md); used by [F4](04-ai-briefing-generation.md) and [F5](05-briefing-editor.md). Inline disclosure is the proposed compact choice. A side panel is an alternative if source inspection needs more room, but must preserve editing context and keyboard behaviour.
