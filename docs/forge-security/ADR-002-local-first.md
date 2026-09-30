# ADR-SEC-002 — Local-first collection, no third-party telemetry

Date: 2026-09-30
Status: Proposed (Rung 0) — accepted only after architecture review of the Rung 0 PR.

## Context

A security monitoring product is an unusually sensitive place to get data
handling wrong: it necessarily touches account names, process/service
metadata, file paths, and network exposure — all things Jason has explicit
boundaries against exfiltrating (see the [privacy/data contract](./privacy-data-contract.md)).
Many commercial security tools justify cloud upload as "needed for threat
intelligence." FORGE Security is not building threat intelligence in these
rungs, so that justification doesn't apply here.

## Decision

- All collection, normalization, rule evaluation, and evidence storage stays
  **on the machine being monitored**, in Rungs 0–7. No telemetry, file
  contents, credentials, browser history, private documents, or secrets are
  uploaded to FORGE's own servers or any third party.
- Rung 8 ("multi-machine console") is the first point any cross-machine data
  movement is even considered, and it requires its own threat-model of the
  control/sync channel before being enabled — this ADR does not pre-approve
  that design, it only names when the question becomes relevant.
- No cloud security vendor dependency (e.g. Defender for Endpoint / Defender
  ATP APIs) is introduced. Those are real, capable products, but they are
  paid, cloud-backed, and outside this product's local-first boundary.

## Consequences

- FORGE Security's evidence store (Rung 2) is a local database/disk
  structure, not a hosted table in FORGE's existing Supabase project, unless
  a future ADR deliberately revisits this (e.g. for Rung 8's multi-machine
  console, and even then scoped to evidence metadata Jason explicitly opts
  into syncing, never raw collection by default).
- No dependency on network availability for FORGE Security to function on a
  single machine — a meaningful reliability property for a security tool.
- This forecloses certain conveniences (viewing a machine's security status
  from a phone browser, for instance) until Rung 8 deliberately addresses
  them with a properly threat-modeled channel.
