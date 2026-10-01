# Notice / Form Placeholder Fields (Rentec parity R15)

The placeholder engine is `renderNoticeTemplate()` in
`src/domains/rental-forms/formPlaceholders.js`. Syntax: `{{dotted.path}}`
(whitespace inside the braces is ignored). The engine is pure — no eval, no
function calls, no property access beyond plain data lookups — and it never
crashes.

## Render contract

| Case | Output |
|---|---|
| Known path with a value | Substituted |
| Known path, null/undefined/"" | Blank + listed in `missing` |
| Unknown path | `________` (fill-in blank) + listed in `unknown` |

Unknown placeholders print as blank lines (paper-form style) rather than raw
`{{tokens}}`. The render API returns `missing`/`unknown` lists so the builder
UI can flag them before printing. Rendered text is HTML-escaped only at the
print boundary (`noticeTextToHtml`), never in the stored log snapshot.

## Built-in field catalog (stable contract — keys are never renamed)

- `tenant.name` — tenant's display name
- `tenant.email` — tenant's email address
- `tenant.phone` — tenant's phone number
- `property.label` — unit label, or the property ID humanized ("308-paula" → "308 Paula")
- `property.address` — the unit's structured street address, if recorded
- `unit.label` — the unit's label
- `lease.start` — lease start date (e.g. Sep 1, 2026)
- `lease.end` — lease end date, blank for an open tenancy
- `lease.rent` — monthly rent as USD ($1,600.00)
- `lease.due_day` — day of the month rent is due (1–28)
- `balance.due` — total unpaid rent charges as USD
- `owner.name` — the workspace's sender name from email settings
- `today` — the generation date (e.g. Oct 1, 2026)

## Custom fields

Every tenant and lease custom field value is available as
`{{custom.<field_key>}}` (e.g. `{{custom.gate_code}}`). Field keys are
slugified at field creation (`slugifyFieldKey`) and stored on the definition.
When the tenant's active lease is known, lease custom fields merge under
tenant custom fields — the tenant's own value wins on key collisions.
