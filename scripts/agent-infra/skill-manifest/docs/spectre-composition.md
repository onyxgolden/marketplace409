# Skill Spectre composition

This linter reports **packaging conformance only — never a security
approval**. Security decisions compose with Skill Spectre findings, whose
three threat classes are reserved and reused verbatim:

- `PROMPT_INJECTION`
- `SUPPLY_CHAIN`
- `MALWARE`

Rules:

1. Pass a Skill Spectre findings JSON file with
   `node src/linter.mjs <skill-root> --spectre-findings findings.json`
   (the option may appear before or after the skill root; it takes exactly
   one value). It is attached verbatim under
   `report.security_composition.spectre_findings` within a 256 KiB attachment
   bound; it is never reinterpreted, re-scored, or rewritten by this linter.
   Admission is bounded before materialization: the raw read never exceeds
   bound+1 bytes, and parsed structure deeper than 100 levels is refused
   before attachment (`SPECTRE_INPUT_TOO_DEEP`), so a hostile input can
   never exhaust input memory or the serializer's stack. The emitted
   report itself is bounded at 4 MiB of serialized JSON; over-bound output
   falls back to a bounded nonconformant report with
   `attachment_status: "rejected_output_bound"`.
   `report.security_composition.attachment_status` records the outcome
   (`not_requested` / `attached` / `unavailable` / `malformed` /
   `rejected_oversize` / `rejected_overdeep` / `rejected_output_bound`) so
   packaging conformance and Spectre security disposition stay separate
   named results.
2. This linter adds **no new high/critical security block categories**.
   `INSTRUCTION_OVERRIDE_NOTE` is a packaging observation at `note` severity;
   it must be composed with Skill Spectre `PROMPT_INJECTION` findings before
   anyone treats it as a security decision.
3. An explicitly requested but missing, malformed, or oversize findings
   file has an honest outcome: an `error`-severity diagnostic
   (`SPECTRE_INPUT_UNREADABLE` / `SPECTRE_INPUT_MALFORMED` /
   `SPECTRE_INPUT_TOO_LARGE`) is recorded BEFORE conformance is derived, so
   the result is never `conformant` with a hidden attachment error. The
   composition slot records `spectre_findings: null` and the report's
   standing note ("packaging conformance only — never a security approval").
4. Skill Spectre's static preflight remains the required gate before any
   later clone/install/execution of a skill. This linter never authorizes
   installation or execution.
