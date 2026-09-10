# User Feedback Severity and Triage

**Prepared:** 2026-09-10
**Source:** `FORGE_PRODUCTION_USER_FEEDBACK_AND_ACTIVATION_PLAN.md`, Phase 1 evidence schema and
"Triage order" sections, verbatim.

Every feedback entry captured via `scripts/production-feedback/feedbackContracts.mjs` carries a
`severity` and a set of `riskFlags`. Severity says how bad the individual entry is; triage order says
which entries get attention first when several are open at once. They are deliberately separate:
a low-severity issue with a financial risk flag can still outrank a "blocker" that's purely cosmetic
in the loosest sense of blocking one rarely-used feature.

## Severity levels

| Severity | Meaning |
|---|---|
| `blocker` | The tester could not complete the mission at all. |
| `serious` | The tester completed the mission, but only through an unintended workaround, or the result is wrong in a way that matters (money, data, access). |
| `confusing` | The tester completed the mission but hesitated, backtracked, or needed to guess. |
| `cosmetic` | Visual or wording issue with no functional effect. |
| `enhancement` | Not a defect — a reasonable capability the tester expected but that was never promised. |

## Triage order

When ranking which open feedback item to act on first, apply this order (most urgent first):

1. Security boundary or cross-user data exposure
2. Incorrect money, ledger, balance, or payment state
3. Data loss, duplication, or partial writes
4. User blocked from completing a primary mission
5. Misleading success/failure state
6. Invitation, claim, authentication, or workspace-access failure
7. Mobile/desktop usability causing abandonment
8. Onboarding and discoverability friction
9. Reporting/help/terminology confusion
10. Cosmetic polish and unvalidated feature requests

## How the two interact

- `riskFlags` on a feedback entry (`financial`, `security`, `data_integrity`) are what push an entry up
  the triage order regardless of its stated `severity` — a `confusing` entry with `riskFlags:
  ["financial"]` should be triaged ahead of a `blocker` entry with no risk flags if the underlying cause
  looks like it touches money.
- `severity` is set by the tester/observer at capture time and should not be inflated or deflated to
  force a triage position — use `riskFlags` and the triage order above for that instead.
- An entry's `reproducible` + `reproSteps` fields (see the feedback contract) determine whether it's
  ready for the Engineering Brain feedback-to-work pipeline (Phase 6) to act on, independent of
  severity or triage position.

## Duplicate handling

Do not create a new feedback entry for something already recorded — link the new observation to the
existing entry via `relatedFeedbackId` instead. This keeps the evidence trail intact (repeated
observations of the same defect are themselves useful evidence of frequency/impact) without inflating
the apparent number of distinct problems.
