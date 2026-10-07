# FORGE Engineering Brain -- Index Report

> Sanitized: paths, counts, and content hashes only. No file contents or matched secret/PII values appear below.

**Commit:** `9aff70dd30c50711c1472b358c761c5a97fb1863`
**Generated at:** 2026-10-07T17:39:33.194Z
**Index content hash:** `8256ab9fe513da3088a0da9a626e8aa94081d45aa35cde4504a46de615429b6c` (excludes `generated_at` -- identical repo content at this commit always produces this same hash)

## Authority order

| Rank | Level | Meaning |
| --- | --- | --- |
| 0 | `current` | Current code, migrations, and tests |
| 1 | `validation_evidence` | Validation evidence |
| 2 | `governance_state` | Current governance state |
| 3 | `synchronized_document` | Synchronized documents |
| 4 | `canonical_document` | Canonical product and architecture documents (intent) |
| 5 | `reviewed_decision` | Reviewed decisions and handoffs |
| 6 | `historical_snapshot` | Historical snapshots and bootstrap continuity |

## Indexed records

**Total:** 10507

By source type:

| Key | Count |
| --- | ----- |
| application_source_symbol | 4839 |
| test_file | 1717 |
| application_source_file | 1635 |
| sql_rls_policy | 529 |
| api_route_symbol | 528 |
| api_route_file | 286 |
| sql_migration_file | 259 |
| sql_rpc_function | 245 |
| sql_table | 228 |
| sql_trigger | 71 |
| canonical_document_file | 52 |
| synchronized_document_section | 50 |
| dependency_version | 35 |
| historical_snapshot | 23 |
| historical_document_file | 6 |
| reviewed_decision | 2 |
| governance_state | 1 |
| package_manifest_file | 1 |

By authority level:

| Key | Count |
| --- | ----- |
| current | 10373 |
| canonical_document | 50 |
| synchronized_document | 50 |
| historical_snapshot | 29 |
| reviewed_decision | 4 |
| governance_state | 1 |

## Excluded records

**Total:** 45

By reason:

| Key | Count |
| --- | ----- |
| likely_secret:high_entropy_secret_assignment | 11 |
| registry_excluded:module_plan_outside_scope | 7 |
| likely_secret:supabase_service_role_jwt | 5 |
| likely_pii:ssn_like_value | 4 |
| registry_excluded:authority_unresolved_no_owner | 3 |
| likely_pii:payment_card_like_value | 3 |
| likely_pii:ein_like_value | 3 |
| lockfile | 2 |
| likely_secret:stripe_live_secret_key | 2 |
| registry_excluded:outside_current_sync_pattern | 1 |
| registry_excluded:authority_undecided | 1 |
| registry_excluded:conflicting_duplicate | 1 |
| registry_excluded:module_roadmap_pending_decision | 1 |
| likely_secret:generic_private_key_block | 1 |

## Out of scope

549 tracked files fell outside every category this Phase 1 indexer covers (not excluded -- simply not yet in scope; see requirement 3's category list).

## Deleted since previous index

None.

## Canonical document registry

**Registry fingerprint:** `b25ed739bad6e86cc9164557971b0e861e3d4705adc8d3d605315b9f70a86518`

Coverage: every registered canonical and historical document is indexed or explicitly excluded. No issues.
