# ADR-002 — Typed object links, not a universal object table

Date: 2026-10-02
Status: Accepted (Rung 0)

## Context

Work Packages need to say things like "schedule task T-31 constrains WP-0047"
or "capture artifact C-19 is completion evidence for WP-0047". Two designs
were considered: (a) a universal object table that ingests copies of every
domain's records, or (b) a small typed-link contract between canonical IDs.

## Decision

Option (b). A `forge_work_links` record (specified in
`object-relationship-contract.md`) stores: the two endpoint identities
(domain + type + canonical id), the relationship type from an enumerated
vocabulary, who/what created it and when, provenance
(`user_confirmed | deterministic_import | ai_proposed`), and resolver state
(`active | stale | broken` with `resolved_at`).

## Rationale

- A universal object table becomes a second source of truth the moment any
  domain updates — exactly what ADR-001 forbids.
- Links are cheap to extend: a new domain or relationship type is a
  vocabulary addition plus a resolver, not a schema migration of a god-table.
- The Brain's existing provenance shape (git SHA + path + content hash from
  the engineering-brain manifest) maps onto link provenance directly: *what,
  from where, at which version, confirmed by whom*.

## Consequences

- Every new linkable domain needs a documented canonical ID shape before its
  first relationship type ships (see `existing-domain-inventory.md`).
- Relationship vocabulary grows only by review — no free-text relationship
  types in production.
- AI-proposed links are visible as proposals and unusable as evidence until
  user-confirmed.
