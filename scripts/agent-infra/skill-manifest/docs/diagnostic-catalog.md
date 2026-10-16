# Diagnostic catalog

Diagnostics are sorted by `(code, location)` for deterministic output, capped
at 200 entries, with evidence truncated to 200 characters.

Severity determines conformance: any `error` → `nonconformant`; otherwise any
`review` → `review_required`; otherwise `conformant`.

## Errors (nonconformant)

| Code | Meaning |
| --- | --- |
| MISSING_SKILL_MD | No SKILL.md at the skill root |
| MISSING_FRONTMATTER | SKILL.md has no `---` frontmatter block |
| MALFORMED_FRONTMATTER | Unparseable line in the bounded subset |
| UNSUPPORTED_YAML_TAG | Explicit `!tag` or anchor/alias present (never evaluated) |
| DUPLICATE_KEY | Duplicate mapping key |
| DEEP_STRUCTURE | Nesting deeper than 8 |
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
| ESCAPING_SYMLINK | Symlink resolving outside the skill root |
| FILE_BUDGET_EXCEEDED | Admission stopped before the first excess file (64 files / 256 KiB) |
| SPECTRE_INPUT_UNREADABLE | `--spectre-findings` file unreadable |
| OPERATIONAL_ERROR | Unreadable root or enumeration failure |

## Review (review_required)

| Code | Meaning |
| --- | --- |
| LICENSE_REVIEW_REQUIRED | Missing/unrecognized license, or `license_status: unknown`. Never an inferred permissive license. |
| FORGE_EXTENSIONS_MISSING | No `forge:` block (FORGE extension, not upstream) |

## Notes (informational)

| Code | Meaning |
| --- | --- |
| EXTERNAL_LINK | http/https/mailto link noted; never fetched (no network) |
| ALLOWED_TOOLS_METADATA_ONLY | `allowed-tools` is metadata; grants nothing |
| INSTRUCTION_OVERRIDE_NOTE | Packaging observation of instruction-override phrasing; compose with Skill Spectre for any security decision |
| DEEP_REFERENCE_CHAIN | Markdown reference chain deeper than one level from SKILL.md |
| UNKNOWN_TOP_LEVEL_FIELD | Field outside the spec + documented FORGE extensions |
| FORGE_FIELD_MISSING | A recommended `forge:` sub-field is absent |
| LICENSE_FILE_REFERENCE | `license` references a bundled file (verify its text independently) |
| SYMLINK_NOTED | (in file inventory) contained symlinks are metadata, never followed |
