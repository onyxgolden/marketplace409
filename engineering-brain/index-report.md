# FORGE Engineering Brain -- Index Report

> Sanitized: paths, counts, and content hashes only. No file contents or matched secret/PII values appear below.

**Commit:** `c7b2c4eb2106ae5a6e0c65f01b20adec6ad167f9`
**Generated at:** 2026-08-27T05:38:26.553Z
**Index content hash:** `02d11d6f01ceb9354535fbe993faa74c1e1e3604e2e0274cba03783ceafbceb5` (excludes `generated_at` -- identical repo content at this commit always produces this same hash)

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

**Total:** 4354

By source type:

| Key | Count |
| --- | ----- |
| application_source_symbol | 1945 |
| application_source_file | 977 |
| test_file | 745 |
| sql_rls_policy | 166 |
| api_route_symbol | 111 |
| sql_migration_file | 103 |
| sql_table | 73 |
| api_route_file | 65 |
| sql_rpc_function | 57 |
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
| current | 4277 |
| synchronized_document | 50 |
| historical_snapshot | 23 |
| reviewed_decision | 3 |
| governance_state | 1 |

## Excluded records

**Total:** 4

By reason:

| Key | Count |
| --- | ----- |
| likely_secret:high_entropy_secret_assignment | 2 |
| lockfile | 1 |
| likely_secret:generic_private_key_block | 1 |

## Out of scope

232 tracked files fell outside every category this Phase 1 indexer covers (not excluded -- simply not yet in scope; see requirement 3's category list).

## Deleted since previous index

None.
