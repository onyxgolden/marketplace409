# Diagnostic catalog

Diagnostics are sorted by `(code, location)` for deterministic output, capped
at 200 presented entries, with evidence truncated to 200 characters.

Conformance is derived from the FULL diagnostic set BEFORE the presentation
cap is applied: an omitted error/review can never produce a conformant
result. The report carries `diagnostics_omitted` (`total`, `by_severity`,
`by_code`) so nothing is silently lost.

Severity determines conformance: any `error` → `nonconformant`; otherwise any
`review` → `review_required`; otherwise `conformant`.

## Errors (nonconformant)

| Code | Meaning |
| --- | --- |
| MISSING_SKILL_MD | No SKILL.md at the skill root |
| MISSING_FRONTMATTER | SKILL.md has no `---` frontmatter block |
| MALFORMED_FRONTMATTER | Unparseable line in the bounded subset |
| UNSUPPORTED_YAML_TAG | Explicit `!tag` or anchor/alias present (never evaluated) |
| DANGEROUS_MAPPING_KEY | `__proto__` / `constructor` / `prototype` key refused (parsed into a discarded container) |
| MALFORMED_SCALAR | Unterminated quoted scalar or unbalanced flow brackets (never reinterpreted as a valid value) |
| DUPLICATE_KEY | Duplicate mapping key |
| DEEP_STRUCTURE | Nesting deeper than 8 on any accepted syntax path (indentation or flow) |
| FRONTMATTER_TOO_LARGE | Frontmatter over 64 KiB |
| MISSING_NAME / INVALID_NAME | `name` missing or violating the upstream pattern |
| NAME_DIR_MISMATCH | `name` differs from the parent directory name |
| MISSING_DESCRIPTION / DESCRIPTION_TOO_LONG | `description` missing or over 1024 chars |
| COMPATIBILITY_TOO_LONG | `compatibility` over 500 chars |
| INVALID_METADATA_VALUE | `metadata` not a string→string map |
| INVALID_ALLOWED_TOOLS | `allowed-tools` not a string |
| INVALID_FORGE_BLOCK / INVALID_FORGE_FIELD | `forge:` block or field mistyped |
| CAPABILITY_CONFLICT | Denied capability requested, or contradictory capability metadata |
| ABSOLUTE_PATH_LINK | Absolute filesystem path in a link |
| PATH_TRAVERSAL_LINK | Link escaping the skill root |
| BROKEN_REFERENCE | Local link target missing inside the root |
| ESCAPING_SYMLINK | Symlink resolving outside the skill root, through an excluded path, or through a symlink component (hidden chain) — refused without following |
| EXCLUDED_PATH_LINK | Link target crosses an excluded path (dot path / node_modules); refused without stat/read |
| ENUM_DIR_TOO_DEEP | Directory nesting beyond 16 during enumeration; enumeration stopped (bounded) |
| ENUM_BUDGET_EXCEEDED | Enumeration beyond 100,000 entries; stopped (bounded) |
| FILE_BUDGET_EXCEEDED | Admission stopped before the first excess file (64 files / 256 KiB) |
| SPECTRE_INPUT_UNREADABLE | `--spectre-findings` file unreadable (explicit request → honest nonconformant, never conformant) |
| SPECTRE_INPUT_MALFORMED | `--spectre-findings` file not valid JSON object data |
| SPECTRE_INPUT_TOO_LARGE | `--spectre-findings` file over the 256 KiB attachment bound; not attached |
| OPERATIONAL_ERROR | Unreadable root, symlinked root, or enumeration failure |

## Review (review_required)

| Code | Meaning |
| --- | --- |
| LICENSE_REVIEW_REQUIRED | Missing/unrecognized license, `license_status: unknown` or `review_required`, or a bundled license file (file existence never establishes rights). Never an inferred permissive license. |
| FORGE_EXTENSIONS_MISSING | No `forge:` block (FORGE extension, not upstream) |

## Notes (informational)

| Code | Meaning |
| --- | --- |
| EXTERNAL_LINK | http/https/mailto link noted; never fetched (no network) |
| ALLOWED_TOOLS_METADATA_ONLY | `allowed-tools` is metadata; grants nothing |
| INSTRUCTION_OVERRIDE_NOTE | Packaging observation of instruction-override phrasing; compose with Skill Spectre for any security decision |
| DEEP_REFERENCE_CHAIN | Markdown reference chain deeper than one level from SKILL.md |
| UNKNOWN_TOP_LEVEL_FIELD | Field outside the spec + documented FORGE extensions |
| FORGE_FIELD_MISSING | A required `forge:` sub-field is absent (REVIEW_REQUIRED). An explicitly empty `permitted_data_classes` / `requested_capabilities` list is a deliberate "none" declaration, not missing. |
| LICENSE_FILE_REFERENCE | `license` references a bundled real file (verify its text independently; still REVIEW_REQUIRED until reviewed) |
| SYMLINK_NOTED | (in file inventory) contained symlinks are metadata, never followed |
