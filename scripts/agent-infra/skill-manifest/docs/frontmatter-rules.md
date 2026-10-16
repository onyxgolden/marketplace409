# Frontmatter rules

Upstream structural rules follow the open Agent Skills specification,
https://agentskills.io/specification (retrieved 2026-10-16; digest frozen in
the implementation report and in `src/linter.mjs` as `SPEC_SHA256`).
This page paraphrases the rules the linter enforces; the spec page itself is
authoritative for anything not listed here.

## Upstream fields

- `name` (required): 1–64 characters; lowercase letters, numbers and hyphens
  only; must not start/end with a hyphen or contain consecutive hyphens; must
  match the parent directory name.
- `description` (required): 1–1024 characters, non-empty.
- `license` (optional): license name or reference to a bundled license file.
- `compatibility` (optional): 1–500 characters when present.
- `metadata` (optional): map of string keys to string values.
- `allowed-tools` (optional, experimental): space-separated string.

## FORGE policy extensions (not upstream)

The top-level `forge:` mapping carries FORGE-required packaging metadata and
is validated separately. It is labeled a FORGE extension everywhere it
appears; it is not part of the upstream spec and is never presented as
mandatory upstream.

Required sub-fields: `owner`, `provenance`, `license_status`
(`verified` | `review_required` | `unknown`), `input_contract`,
`output_contract`, `permitted_data_classes` (list of strings),
`requested_capabilities` (list of strings), `completion_evidence`,
`retirement_policy`.

Key policies:

- **Unknown license becomes REVIEW_REQUIRED**, never an inferred permissive
  license. Applies to a missing/unrecognized `license` field and to
  `forge.license_status: unknown`.
- **Requested/allowed-tools metadata never grants actual tool permission.**
  It is packaging metadata only.
- **Capability conflicts are errors.** Requesting a denied capability
  (`production.write`, `credential.read`, `secret.disclose`,
  `tenant.pii.read`) under synthetic-only data classes, or declaring
  non-empty `allowed-tools` alongside an explicitly empty
  `requested_capabilities`, fails conformance.
- **Retirement never happens by ordinary memory cleanup.** A replacement
  manifest must reference the retired version's history.

## Bounded YAML subset

The parser supports: indentation-nested mappings, `- ` sequences, plain /
single-quoted / double-quoted scalars, `|` and `>` block scalars, `#`
comments, `true/false/null/~`, numbers, and flat flow sequences (`[a, b]`).
It rejects explicit tags (`!foo`), anchors/aliases, nesting deeper than 8,
duplicate keys, and frontmatter larger than 64 KiB. No YAML tag is ever
evaluated and no code is ever executed.
