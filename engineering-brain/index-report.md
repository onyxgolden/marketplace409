# FORGE Engineering Brain -- Index Report

> Sanitized: paths, counts, and content hashes only. No file contents or matched secret/PII values appear below.

**Commit:** `382a60bcf07052517beb16406184340fcc168b68`
**Generated at:** 2026-08-27T06:59:07.548Z
**Index content hash:** `6b3cb08a7378993e838a6cca89fdbee069257324c9faa5b809b3e47016cf6460` (excludes `generated_at` -- identical repo content at this commit always produces this same hash)

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

**Total:** 4421

By source type:

| Key | Count |
| --- | ----- |
| application_source_symbol | 1945 |
| application_source_file | 977 |
| test_file | 752 |
| sql_rls_policy | 192 |
| api_route_symbol | 111 |
| sql_migration_file | 103 |
| sql_table | 91 |
| sql_rpc_function | 73 |
| api_route_file | 65 |
| synchronized_document_section | 50 |
| dependency_version | 25 |
| historical_snapshot | 23 |
| sql_trigger | 9 |
| reviewed_decision | 3 |
| governance_state | 1 |
| package_manifest_file | 1 |

By authority level:

| Key | Count |
| --- | ----- |
| current | 4344 |
| synchronized_document | 50 |
| historical_snapshot | 23 |
| reviewed_decision | 3 |
| governance_state | 1 |

## Excluded records

**Total:** 7

By reason:

| Key | Count |
| --- | ----- |
| likely_secret:high_entropy_secret_assignment | 2 |
| lockfile | 1 |
| likely_pii:ssn_like_value | 1 |
| likely_secret:stripe_live_secret_key | 1 |
| likely_pii:payment_card_like_value | 1 |
| likely_secret:generic_private_key_block | 1 |

## Out of scope

252 tracked files fell outside every category this Phase 1 indexer covers (not excluded -- simply not yet in scope; see requirement 3's category list).

## Deleted since previous index

None.
