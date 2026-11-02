# Team Brain P7 — Vault / Provisioning Recipe

This recipe provisions credentials for the disabled-worker package.
It contains NO secrets — only entry names and procedures. The actual
passwords are created by the provisioning operator in the vault and
are never written into config files, logs, or this package.

## Entries (names only — values live in the vault)

| Entry | Role | Held by |
|---|---|---|
| `TB_WORKER_DB_PASSWORD` | `tb_consolidator` LOGIN (provisioning gated) | Worker host service account, read-only |
| `TB_OBSERVER_DB_PASSWORD` | `tb_reader` LOGIN (provisioning gated) | Worker host service account, read-only |

`tb_admin` credentials are held ONLY by the provisioning operator.
They are never placed in the worker's vault scope, never in worker
config, and never in worker logs. Creating the LOGIN roles and
setting their passwords is a separately gated provisioning step
(P8 territory) — this package builds the disabled worker, it does
not provision logins.

## How credentials reach the worker (and nothing else)

1. The provisioning operator creates the two vault entries above.
2. The worker host's dedicated OS account is granted read-only
   access to exactly those two entries — no other vault paths.
3. At service start, the launcher (a gated provisioning step, not
   this package) injects them as process environment variables
   named `TB_WORKER_DB_PASSWORD` and `TB_OBSERVER_DB_PASSWORD`.
4. The worker resolves them from the environment at connect time
   (see `postgres/connection.mjs`). They are never logged, never
   written to a receipt, and never appear in health output.

## Rotation

1. Rotate the password in the vault.
2. Restart the worker's next scheduled invocation (the task stays
   DISABLED until activation is separately authorized — rotation
   alone never enables it).
3. Confirm with `--check` (health) that the worker and observer
   connections authenticate under the new values.
4. Old values are revoked in the vault; no config file changes,
   because no config file ever held a value.

## What to do if a credential leaks

1. Create the stop file (see runbook: kill) and disable the task.
2. Rotate the leaked entry in the vault and revoke the old value.
3. Confirm no worker or observer connection succeeds with the old
   value (`--check` fails closed on bad credentials).
4. Report the leak to Jason — a leaked credential is a security
   event, not a routine rotation.
