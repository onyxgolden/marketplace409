# FORGE Engineering Brain -- Index Report

> Sanitized: paths, counts, and content hashes only. No file contents or matched secret/PII values appear below.

**Commit:** `fe285b201d91f4f22d9c5424c119d51819e8df6e`
**Generated at:** 2026-09-19T18:15:08.158Z
**Index content hash:** `cb3f84257a148861ef9684b48393b1d334596ee35ab0056e70185330f73fe9b3` (excludes `generated_at` -- identical repo content at this commit always produces this same hash)

## Authority order

| Rank | Level | Meaning |
| --- | --- | --- |
| 0 | `current` | Current code, migrations, and tests |
| 1 | `validation_evidence` | Validation evidence |
| 2 | `governance_state` | Current governance state |
| 3 | `synchronized_document` | Synchronized documents |
| 4 | `reviewed_decision` | Reviewed decisions and handoffs |
| 5 | `historical_snapshot` | Historical snapshots |

## Indexed records

**Total:** 6109

By source type:

| Key | Count |
| --- | ----- |
| application_source_symbol | 2581 |
| application_source_file | 1213 |
| test_file | 1094 |
| sql_rls_policy | 259 |
| api_route_symbol | 222 |
| sql_migration_file | 169 |
| sql_rpc_function | 165 |
| api_route_file | 135 |
| sql_table | 132 |
| synchronized_document_section | 50 |
| sql_trigger | 33 |
| dependency_version | 28 |
| historical_snapshot | 23 |
| reviewed_decision | 3 |
| governance_state | 1 |
| package_manifest_file | 1 |

By authority level:

| Key | Count |
| --- | ----- |
| current | 6032 |
| synchronized_document | 50 |
| historical_snapshot | 23 |
| reviewed_decision | 3 |
| governance_state | 1 |

## Excluded records

**Total:** 25

By reason:

| Key | Count |
| --- | ----- |
| likely_secret:high_entropy_secret_assignment | 11 |
| likely_secret:supabase_service_role_jwt | 5 |
| likely_pii:ssn_like_value | 2 |
| likely_secret:stripe_live_secret_key | 2 |
| likely_pii:payment_card_like_value | 2 |
| lockfile | 1 |
| likely_pii:ein_like_value | 1 |
| likely_secret:generic_private_key_block | 1 |

## Out of scope

345 tracked files fell outside every category this Phase 1 indexer covers (not excluded -- simply not yet in scope; see requirement 3's category list).

## Deleted since previous index

5 previously-indexed path(s) no longer exist at this commit and were dropped, not carried forward: src/app/auth/page.js, src/app/page.js, src/components/forge/ForgeDashboardCard.js, src/components/forge/ForgeNavigationBar.js, src/contexts/ThemeContext.jsx
