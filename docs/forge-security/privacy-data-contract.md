# Privacy / data minimization contract (assignment section C)

This is the schema and the rules a Rung 2 evidence ledger must implement.
Nothing here is built yet — this is the contract Rung 1–2 code is reviewed
against.

## Minimum event schema

Every FORGE Security evidence record carries:

| Field | Meaning |
| --- | --- |
| `event_id` | Deterministic, deduplicated identifier for this event (see [ADR-003](./ADR-003-deterministic-rules.md) for how deduplication is derived — not invented per-insert). |
| `machine_id` | A stable, pseudonymous local identifier for the machine (not the Windows hostname, not a hardware serial exposed as-is — a locally-generated UUID persisted once per machine). |
| `observed_at` | UTC timestamp of collection, distinct from any OS-reported event timestamp (both are kept; see below). |
| `source` | Which [Windows source](./windows-sources.md) produced this (e.g. `defender.status`, `firewall.profile`, `eventlog.security.4720`). |
| `event_type` | The normalized FORGE Security event type (e.g. `defender_disabled`, `new_admin_account`, `new_listening_port`). |
| `severity` | The deterministic classification from [`severity-rules.md`](./severity-rules.md), plus the raw OS-reported severity kept separately (see below). |
| `process_id` / `service_name` / `task_name` / `account_name` | Whichever identifiers are relevant to this event type; omitted fields stay absent, never null-padded speculatively. |
| `local_path` | File/executable path, where relevant to the event. |
| `sha256` | Content hash, where relevant (never the file content itself). |
| `signer` / `signature_state` | Authenticode signer identity and validity state, where relevant. |
| `port` / `protocol` / `address_class` | For network-exposure events — `address_class` is `loopback` / `private` / `public`, not necessarily the full raw address (see the exposure note in the source inventory). |
| `rule_id` | The deterministic rule that produced this classification, so "why am I seeing this" always has a concrete answer (see the [UX spec](./ux-specification.md#evidence-detail-view)). |
| `rule_explanation` | Short, static, rule-authored text — not a generated explanation. Brain-generated explanation (Rung 5) is layered on top and is clearly attributed as such, never merged into this field. |
| `raw_os_severity` / `raw_os_state` | The unmodified value the OS/Defender/Firewall itself reported, kept distinct from `severity` per [ADR-003](./ADR-003-deterministic-rules.md). FORGE Security's classification never overwrites this. |
| `evidence_provenance` | Enough detail to reproduce how this record was derived (which collector, which query, collector version) — not a copy of the full raw OS response, just enough to audit the pipeline later. |
| `collection_health` | Whether this specific collection succeeded, and if not, why (permission denied, source unavailable, timeout) — see the "unknown is not healthy" rule below. |

## Fields that MUST NOT be collected

Restated as a hard contract, not a suggestion:

- Password values, password hashes, PINs, or any credential material.
- OAuth/API tokens, session cookies, session secrets, bearer tokens.
- Private keys or certificate private-key material.
- `.env` file contents or the contents of any file recognized as a secrets
  store.
- Full file contents of any monitored file — file-integrity monitoring
  records identity (path + hash + signer), never content.
- Browser history, bookmarks, saved form data, or saved passwords — even
  though the browser-extension inventory (source §12) technically has
  filesystem access to the same profile directory, reading anything beyond
  extension id/name/version from that directory is out of bounds.
- Full command-line arguments verbatim, when a command line might embed a
  secret (e.g. a token passed as a CLI flag) — a collector must redact or
  truncate values that look like tokens/keys before persisting a command
  line, rather than persist-then-hope. Rung 1/3 implementation must define
  and test this redaction, not defer it silently.
- Contents of personal/private documents encountered incidentally while
  resolving a path (e.g. a persistence entry that happens to point at a
  script in a Documents folder) — path and hash only, never opened.

## Retention and purge

- **Default retention:** local security event history is retained locally by
  default; Rung 2 must define a concrete default window (a config value, not
  "forever") and make it visibly configurable, not just theoretically
  configurable in a schema field nobody surfaces.
- **No cloud retention of any kind** is invented or assumed anywhere in this
  product. Retention is a local disk/database concern only.
- **Purge control:** Jason must be able to purge local security history
  (all of it, or by time range) from the Rung 4 UI once it exists. Rung 2's
  schema should be designed so a purge is a real delete, not a soft-delete
  that quietly keeps data around — if a soft-delete/audit-of-purges pattern
  is wanted for the evidence ledger's own integrity, that trade-off must be
  written down explicitly when Rung 2 is proposed, not decided implicitly
  here.

## "Unknown is not healthy" — a data contract, not just a UX rule

If a source cannot be read (permission denied, service not running, API
unavailable), the resulting record's `collection_health` must say so
explicitly, and no downstream code may infer a "safe"/"disabled"/"clean"
state from an absent record. This is a data-shape requirement: the schema
must make "we don't know" representable and distinct from "we checked and
it's fine," not something a consumer has to infer from a missing row.

## Machine identity

`machine_id` is a locally-generated, stable pseudonymous identifier, created
once and persisted locally. It is not derived from anything that identifies
Jason personally (not tied to a Microsoft account, not the machine's real
hostname exposed in every event) — the hostname/OS metadata is fine to store
once in a machine-inventory record but should not be duplicated into every
event.
