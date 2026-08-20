create table if not exists rental_cron_runs (
    id text primary key,
    job_name text not null check (btrim(job_name) <> ''),
    route_path text not null check (btrim(route_path) <> ''),
    trigger_source text not null check (trigger_source in ('vercel_cron', 'authorized_manual', 'unknown_authorized')),
    status text not null check (status in ('running', 'succeeded', 'partially_succeeded', 'failed')),
    started_at timestamptz not null default now(),
    completed_at timestamptz,
    duration_ms integer check (duration_ms is null or duration_ms >= 0),
    processed_count integer check (processed_count is null or processed_count >= 0),
    succeeded_count integer check (succeeded_count is null or succeeded_count >= 0),
    pending_count integer check (pending_count is null or pending_count >= 0),
    failed_count integer check (failed_count is null or failed_count >= 0),
    result_summary jsonb,
    error_code text,
    error_message text,
    deployment_id text,
    commit_sha text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    check (status = 'running' or completed_at is not null),
    check (status <> 'failed' or error_message is not null)
);

create index if not exists idx_rental_cron_runs_job_started on rental_cron_runs(job_name, started_at desc);
create index if not exists idx_rental_cron_runs_status on rental_cron_runs(status);

alter table rental_cron_runs enable row level security;
alter table rental_cron_runs force row level security;

-- Cron run audit records are operational/system data authored only by service-role
-- server code (see createRentalWebhookClient); no authenticated or anon policy is
-- granted, matching the payment_webhook_events convention. Add an owner-scoped
-- select policy only if/when an owner-facing read surface is built.
