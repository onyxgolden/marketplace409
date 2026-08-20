import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20260820100000_create_rental_cron_runs.sql"), "utf8")
  .toLowerCase().replace(/\s+/g, " ");

describe("rental_cron_runs schema", () => {
  it("creates the audit table with the required columns", () => {
    expect(sql).toContain("create table if not exists rental_cron_runs");
    for (const column of [
      "id text primary key", "job_name text not null", "route_path text not null",
      "trigger_source text not null", "status text not null", "started_at timestamptz not null default now()",
      "completed_at timestamptz", "duration_ms integer", "processed_count integer", "succeeded_count integer",
      "pending_count integer", "failed_count integer", "result_summary jsonb", "error_code text", "error_message text",
      "deployment_id text", "commit_sha text", "created_at timestamptz not null default now()",
      "updated_at timestamptz not null default now()",
    ]) expect(sql).toContain(column);
  });

  it("constrains trigger_source and status to the specified closed sets", () => {
    expect(sql).toContain("check (trigger_source in ('vercel_cron', 'authorized_manual', 'unknown_authorized')");
    expect(sql).toContain("check (status in ('running', 'succeeded', 'partially_succeeded', 'failed')");
  });

  it("requires a completion timestamp once a run leaves the running state", () => {
    expect(sql).toContain("check (status = 'running' or completed_at is not null)");
  });

  it("requires an error message whenever status is failed", () => {
    expect(sql).toContain("check (status <> 'failed' or error_message is not null)");
  });

  it("indexes by job/started_at for querying recent runs per job", () => {
    expect(sql).toContain("create index if not exists idx_rental_cron_runs_job_started on rental_cron_runs(job_name, started_at desc)");
  });

  it("enables and forces row level security with no authenticated/anon policy (service-role only)", () => {
    expect(sql).toContain("alter table rental_cron_runs enable row level security");
    expect(sql).toContain("alter table rental_cron_runs force row level security");
    expect(sql).not.toContain("create policy");
    expect(sql).not.toContain("to authenticated");
    expect(sql).not.toContain("to anon");
  });
});
