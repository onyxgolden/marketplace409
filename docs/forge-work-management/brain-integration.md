# Brain Integration — FORGE Work Management Rung 0

The Engineering Brain is the intelligence layer over the books and the work.
Its contract with Work Management mirrors its standing contract everywhere
else in FORGE: **it retrieves and explains; it never asserts.**

## What Brain may do (read-only)

Over the mature link and readiness contracts, Brain answers questions such
as:

- What is stopping this package? / Why isn't WP-0047 ready?
- What can be worked on today? / Which packages are ready?
- Which work is driving the completion date?
- What changed this week? (scope delta, status moves, new late work)
- How much have we actually spent on this package? (from linked financial
  events only)
- Show me the evidence that the inspection is complete.
- Which materials haven't arrived? / Which inspections are pending?

Every answer cites its sources: the gate evaluations, links, and domain
records it traversed, with provenance (who confirmed what, when). An answer
without citable sources is not given — "I don't have evidence for that" is
a valid and required response.

## What Brain may propose (never impose)

- Candidate work-package decomposition ("this scope looks like three
  packages")
- Candidate links between packages and domain objects
- Candidate readiness requirements per package type
- Candidate follow-up actions

A proposal is visible as a proposal (`ai_proposed` provenance on the link or
record). It becomes authoritative data only through user acceptance in a
deterministic application workflow. There is no bulk-accept.

## Hard fences

- Brain never marks work complete, ready, or verified.
- Brain never invents readiness, progress quantities, costs, or dates.
- Brain never creates financial records, schedule facts, or contractual
  commitments (no AI change orders, no permit/inspection decisions).
- Brain never silently creates links; every proposed link is shown with both
  endpoints and the proposed relationship type before acceptance.
- Unknown stays unknown: Brain does not fill gaps with plausible text. If
  the equipment tag is empty, the answer says it is empty.

## Evidence shape

Brain traverses `forge_work_links` and the source domains, and reports the
provenance chain: package → link (relationship in canonical orientation,
provenance, full confirmation history — who confirmed, when, from what prior
state) → domain record (canonical id, source locator/version,
observed-at). This reuses the engineering-brain manifest pattern (what, from
where, at which version).

## Sequencing

Brain orchestration over Work Management ("Ask the Work") is Rung 12 in the
product ladder — it comes after the contracts it reads are real and reviewed.
Nothing in Rung 0 authorizes Brain write paths into the WP domain.
