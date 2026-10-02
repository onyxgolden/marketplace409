# Novice UX Contract — FORGE Work Management Rung 0

The product must work for a non-expert. Advanced industrial concepts exist in
the model (ADR-004) but the UI explains them in plain language and keeps them
one level down.

## Plain-language translations (shown in the UI; formal terms in parentheses
for professionals)

- constraint → "What is stopping this work?"
- predecessor → "What must finish first?"
- readiness → "Can this work start?"
- evidence → "What proves this?"
- variance → "What changed from the plan?"
- RFI → explained before the acronym is ever required ("a written question
  to the designer/engineer")
- earned progress → "How much of the work is done, measured"
- scope freeze → "The point after which new work needs approval"
- NDE → "non-destructive examination (inspection without taking things apart)"
- laydown → "where materials are stored on site"

## Progressive disclosure

1. **Top level (every package):** title, status, readiness in plain words
   ("Not ready: inspection pending"), dates, who is responsible, what is
   stopping it.
2. **One level down:** equipment tag, unit/area/system, workscope, components,
   inspection states, logistics locations, cost roll-up, evidence list.
3. **Professional view:** formal terminology, gate detail, EVM figures,
   link provenance.

A kitchen-remodel user never sees level 2 unless they go looking. An
industrial planner lives in level 2.

## Rules

- No screen requires project-controls training to complete the happy path:
  create a package, see if it can start, see what is stopping it.
- Every advanced field carries a one-line plain explanation next to it.
- Jargon is never a gate: the user can always answer in plain words
  ("the inspection isn't done") and the app maps it to the formal state.
- Readiness and progress are always shown as reasons and evidence, never as
  bare numbers.
- Destructive or contractual actions (verify/close, approve late work,
  override a gate) are explicit, attributed, and confirmable — never
  one-click accidents.
