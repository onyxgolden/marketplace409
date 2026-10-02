# Message template fields

The merge-field catalog for the Rentec-parity R6 message templates library.
Code of record: `src/domains/rental-messaging/messageTemplates.js`
(`TEMPLATE_FIELDS`). Keys are a **stable contract** — templates stored in
`rental_message_templates` reference these keys, so keys are never renamed,
only added.

## Syntax

`{{field_key}}` — whitespace inside the braces is ignored, so
`{{ tenant_name }}` works the same as `{{tenant_name}}`.

One renderer serves every sender (work-order composer, library preview,
future mailing/welcome senders): `renderMessageTemplate(body, fields)`.

## Missing / unknown fields

| Situation | Behavior |
|---|---|
| Known field, value present | Substituted |
| Known field, value missing (`null`/`undefined`/`""`) | Replaced with `""`; key listed in `missing` |
| Unknown `{{token}}` (not in the catalog) | Left **verbatim** in the text; key listed in `unknown` |

Unknown tokens stay visible on purpose: blanking a typo would send a broken
message silently. The work-order composer shows the unfilled fields so Brandy
can fix the data or the template before sending.

## Field catalog

| Key | Label | Resolved from |
|---|---|---|
| `tenant_name` | Tenant name | `rental_tenants.display_name` |
| `property_label` | Property / unit | Unit label; else the property slug humanized (`308-paula` → `308 Paula`) — the shared `resolvePropertyLabel()` |
| `balance_due` | Balance due | Sum of unpaid `rent_charges` (`amount_cents − paid_amount_cents`), formatted USD (`$1,600.00`) |
| `rent_due_date` | Rent due date | Earliest unpaid charge's `due_date` (e.g. `Oct 1, 2026`) |
| `owner_name` | Owner name | `rental_email_settings.sender_name` |
| `work_order_scope` | Work order scope | `rental_maintenance_work_orders.scope_of_work` |
| `contractor_name` | Contractor | `rental_contractors.business_name` |
| `scheduled_date` | Scheduled date | Work order `scheduled_start` (e.g. `Oct 2, 2026`) |
| `tenant_address` | Tenant mailing address | The tenant's unit address (structured `rental_units` columns, multi-line); blank when the unit has no address on file — added for R20 |
| `owner_return_address` | Owner return address | The sender return address entered when the letter is composed (R20) |
| `letter_date` | Letter date | The date the letter is composed (e.g. `Oct 1, 2026`) — added for R20 |
| `monthly_rent` | Monthly rent | `rental_leases.monthly_rent_cents`, formatted USD — added for R20 |
| `lease_end_date` | Lease end date | `rental_leases.end_date` (e.g. `Aug 31, 2027`) — added for R20 |

## Template kinds and audiences

- Kinds: `email`, `text` (the R6 UI builds these two). `mailing` is the R20
  Mailing Manager kind — the four system mailing templates (late notice,
  lease violation, rent increase, move-out) are the mailed versions of the
  core notices.
- Audiences: `tenant`, `owner` — every template concept ships separate
  tenant and owner versions, matching Rentec.

## System vs custom

System templates are seeded per workspace by
`ensureSystemMessageTemplates()` (idempotent upsert on
`(owner_id, system_key)`). They are read-only: the API returns 403 on
edit/delete with a "duplicate to customize" message. The library UI offers
**Duplicate** on system templates, which copies the content into a new
custom template Brandy owns (trash-can delete on her own rows only).
