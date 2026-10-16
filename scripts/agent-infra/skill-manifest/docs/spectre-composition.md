# Skill Spectre composition

This linter reports **packaging conformance only — never a security
approval**. Security decisions compose with Skill Spectre findings, whose
three threat classes are reserved and reused verbatim:

- `PROMPT_INJECTION`
- `SUPPLY_CHAIN`
- `MALWARE`

Rules:

1. Pass a Skill Spectre findings JSON file with
   `node src/linter.mjs <skill-root> --spectre-findings findings.json`.
   It is attached verbatim under `report.security_composition.spectre_findings`;
   it is never reinterpreted, re-scored, or rewritten by this linter.
2. This linter adds **no new high/critical security block categories**.
   `INSTRUCTION_OVERRIDE_NOTE` is a packaging observation at `note` severity;
   it must be composed with Skill Spectre `PROMPT_INJECTION` findings before
   anyone treats it as a security decision.
3. A missing or unreadable findings file does not weaken the report: the
   composition slot records `spectre_findings: null` and the report's
   standing note ("packaging conformance only — never a security approval").
4. Skill Spectre's static preflight remains the required gate before any
   later clone/install/execution of a skill. This linter never authorizes
   installation or execution.
