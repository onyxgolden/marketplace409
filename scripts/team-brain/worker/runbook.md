# Team Brain P7 — Operator Runbook

For the operator of the disabled-worker package. This runbook assumes
the package is staged as **HOST/SHADOW QUALIFICATION PENDING**: the
code is built and proven in isolation, but the worker is NOT
activated, and the 48h shadow + cutover rehearsal receipts do not
exist yet. Nothing in this runbook enables the worker — enabling
requires separate Jason authorization (P8 territory).

All commands run from the marketplace409 checkout root unless noted.
The CLI is `scripts/team-brain/worker/run.mjs` (Node 24 ESM).
Every command takes `--config <path>` (a validated worker config
JSON — see `config.template.json`). Outputs are JSON on stdout;
errors go to stderr with a nonzero exit. No command prints a
credential, an episode body, or a callback payload.

## 1. Install (disabled)

1. Copy the WHOLE package tree (`scripts/team-brain/`) to the
   qualified Windows host. `worker/` + `postgres/` alone does NOT
   run: `worker/worker.mjs` imports `../consolidation/engine.mjs`
   and `../consolidation/scheduling.mjs`, and `worker/backup.mjs`
   imports `../report/stableStringify.mjs` — staging only those two
   directories fails immediately with `ERR_MODULE_NOT_FOUND`
   (found in P8 Step A qualification, 2026-11-03). Do not
   cherry-pick directories; stage the full tree.
2. Register the task DISABLED (never enabled by this step):
   `register-worker-task.ps1 -TaskName "Team Brain Worker" -WorkerUser "NT SERVICE\TeamBrainWorker" -NodePath "C:\Program Files\nodejs\node.exe" -WorkerScript "C:\team-brain\worker\run.mjs" -ConfigPath "C:\team-brain\worker-config.json" -WorkingDir "C:\team-brain" -XmlTemplate "C:\team-brain\task-definition.xml"`
3. Verify: `schtasks /Query /TN "Team Brain Worker" /FO LIST /V`
   must show **Status: Disabled**. If it shows anything else,
   disable it immediately (`schtasks /Change /TN "Team Brain Worker" /Disable`)
   and report it — an enabled worker without activation authorization
   is a security event.
4. The task triggers daily at 03:00 America/Chicago and runs one
   cycle (`--once`) per trigger. While disabled, nothing runs on
   schedule; qualification runs are manual `--once` invocations
   against an isolated database only.

## 2. Configure

1. Copy `config.template.json` to your config path and fill in:
   host, database, `workerId`, `principal`, `stopFile`,
   `backupDir`. Do NOT add any `password` key — validation refuses
   it. Credentials arrive only via the environment variables named
   in `passwordEnv` (see `vault-recipe.md`).
2. The slot is fixed: 03:00 America/Chicago. A config that names
   any other slot is refused at startup.
3. The worker database user must be `tb_consolidator`; the observer
   user must be `tb_reader`. Any other user is refused.
4. Remote database hosts require verified TLS. Localhost may skip
   TLS only with explicit `allowInsecureLocal: true` (isolated
   qualification use).

## 3. Validate

- Config only (no database needed):
  `node scripts/team-brain/worker/run.mjs --config <path> --validate-config`
  A failure names the bad field. Fix the config; never work around
  validation by editing the validator.
- Full health (needs database + observer connections):
  `node scripts/team-brain/worker/run.mjs --config <path> --check`
  Overall statuses: PASS (all probes pass), PARTIAL (some probes
  could not see their inputs from this handle — re-run with an
  owner handle for full grant verification), FAIL (a probe failed),
  UNQUALIFIED (no provenance/observer adapter — visibly unqualified,
  do not proceed). Health is not a table count: see the probe list
  in `health.mjs` (migration catalog, effective grants, TLS/vault,
  heartbeat freshness, DB/Git availability, backlog watermark,
  pending/unknown deliveries, projection revision, provenance).

## 4. Observe

- Freshness report (observer connection, read-only):
  `node scripts/team-brain/worker/run.mjs --config <path> --observer`
  Fresh means a cycle COMPLETED within 26 hours. A recent STOPPED,
  FAILED, or REFUSED_OVERLAP heartbeat is NOT fresh — it is
  evidence the worker is not completing cycles.
- If freshness is stale: check the last heartbeat state, then the
  troubleshooting section below. Do not restart anything on your
  own authority — report a stale worker to Jason.

## 5. Kill (stop switch)

Two halves, both safe at any time:
1. Portable half: create the stop file named in the config. The
   next cycle sees it and refuses to start (STOPPED heartbeat, no
   consolidation writes). This is what isolated qualification
   proves.
2. Windows half: `stop-worker-task.ps1 -TaskName "Team Brain Worker" -StopFile <path>`
   ends a running instance and disables the task.
3. Remove the stop file ONLY when a restart is authorized. A
   restart without authorization is an activation.

## 6. Backup and isolated restore

- Backup (read-only, observer connection):
  `node scripts/team-brain/worker/run.mjs --config <path> --backup <file.json>`
  The document carries per-table rows plus counts and digests.
  Surrogate sequence values are excluded by design (they regenerate
  on restore); content parity is what the manifest proves.
- Restore (isolated database ONLY):
  `node scripts/team-brain/worker/run.mjs --config <path> --restore <file.json> --restore-user <owner> --restore-password-env <NAME>`
  with `TB_RESTORE_DATABASE` naming the isolated target database.
  Restore connects with owner credentials from the environment,
  never with worker or reader credentials (the CLI refuses those
  users for restore). It refuses to restore into the worker's own
  database. The target database
  must already have the P1, P5, P6, and worker schemas applied
  (schema files in `migrations/`, `retrieval/`, `consolidation/`,
  `worker/`); `--restore` loads data and verifies parity, it does
  not migrate. After loading, it verifies count / history / digest
  / queue parity and reports per-table match; any mismatch fails
  loud.
- Retention: 30 daily backup versions. Rotation deletes backup
  FILES only, never database rows (`pruneBackups` in `backup.mjs`).
  Backup targets: RPO 24h / RTO 4h.

## 7. Reconcile (read-only, never rewrites)

`node scripts/team-brain/worker/run.mjs --config <path> --reconcile`
Reports pending work (INCOMPLETE runs, non-COMPLETE handoffs,
bindings with no finalized run) and unknown records (COMPLETED runs
with no receipt, orphan checkpoints). Reconcile never writes: a
discrepancy is evidence for the operator (and, for obligations,
for Jason), not something the worker fixes itself. Verify any
reconcile run left the database unchanged by re-running parity
against the latest backup.

## 8. Troubleshooting

- `LEASE_HELD` / REFUSED_OVERLAP: another cycle holds the lease.
  Normal if a cycle is genuinely running; if no cycle is running,
  the lease row is stale after a crash — recovery is explicit
  (same holder id resumes), never automatic. Report it; do not
  clear the lease by hand.
- `ROLE_DENIED`: the connection is not `tb_consolidator` (worker)
  or the grants are wrong. Check the connection user and re-run
  `roles.sql` grants from the owner account. Never "fix" it by
  running as a superuser — that defeats the boundary P7 proves.
- `SLOT_NOT_DUE`: the cycle ran before 03:00 Chicago. Expected
  for manual off-slot invocations; the scheduler trigger is 03:00.
- Stale heartbeat: see §4. Do not restart on your own authority.
- `PARTIAL` health: re-run `--check` with an owner handle; the
  worker/reader handles cannot see each other's grants by design.

## 9. What remains gated (do not do these from this runbook)

LOGIN/password provisioning, authority registrations, worker
install/start/activation, cutover execution, production migration
applies, production data writes, any spend. The 48h coordination-
only shadow and cutover rehearsal receipts require separate
permission. Until they exist, the package stages as
HOST/SHADOW QUALIFICATION PENDING — honestly labeled, not
operationally complete.
