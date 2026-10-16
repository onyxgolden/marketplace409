# Frontmatter rules

Upstream structural rules follow the open Agent Skills specification,
https://agentskills.io/specification (retrieved 2026-10-16; digest frozen in
the implementation report and in `src/linter.mjs` as `SPEC_SHA256`; a
retrievable exact snapshot of the retrieved page is kept at
`docs/spec-snapshot-2026-10-16.md`).
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
  license. Applies to a missing/unrecognized `license` field, to
  `forge.license_status: unknown`, to an explicit
  `forge.license_status: review_required`, and to a `license` that references
  a bundled file: file existence establishes a reference, never known rights.
  A symlinked license file is refused outright (never followed).
- **Missing FORGE policy metadata is at least REVIEW_REQUIRED.** Absent
  required `forge:` sub-fields (owner, provenance, license_status,
  input/output contract, permitted data classes, requested capabilities,
  completion evidence, retirement policy) raise REVIEW_REQUIRED, never a
  conformant result with a note. Structurally invalid FORGE data (wrong
  types) is nonconformant. An explicitly empty `permitted_data_classes` or
  `requested_capabilities` list is a deliberate "none" declaration, not
  missing.
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
comments, `true/false/null/~`, numbers, and flow sequences (`[a, b]`) bounded
by the same depth limit. All mappings are null-prototype objects. It rejects:
explicit tags (`!foo`), anchors/aliases, dangerous mapping keys
(`__proto__`, `constructor`, `prototype` — parsed into a discarded container
so they can never satisfy required fields through prototype inheritance),
malformed quoted scalars (unterminated quotes) and malformed flow sequences
(unbalanced brackets — never reinterpreted as valid scalars), nesting deeper
than 8 on ANY accepted syntax path (indentation or flow), duplicate keys, and
frontmatter larger than 64 KiB. No YAML tag is ever evaluated and no code is
ever executed.
