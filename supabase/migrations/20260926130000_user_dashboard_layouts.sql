-- Cross-device dashboard card layouts (UI slice B, follow-up).
--
-- The financial dashboard's card arrangement (order + hidden) follows the
-- signed-in user across devices instead of living only in each browser's
-- localStorage. Keyed by layout_key so the sections zone and the KPI tile
-- zone sync independently; a future dashboard reuses the same table by
-- adding its own key -- no new migration needed, only an allowlist entry in
-- the API route. Personal to the signed-in user, never shared -- this is a
-- display preference, not workspace-level state.
--
-- localStorage remains as the instant-read cache and offline fallback; the
-- server is the source of truth across devices, last-write-wins by
-- updated_at. NOT YET APPLIED -- requires Jason's approval before running
-- in any environment.
create table if not exists public.user_dashboard_layouts (
  user_id uuid not null references auth.users(id) on delete cascade,
  layout_key text not null check (layout_key ~ '^[a-z][a-z0-9-]*$'),
  layout jsonb not null default '{"order":[],"hidden":[]}'::jsonb
    check (
      jsonb_typeof(layout) = 'object'
      and jsonb_typeof(layout->'order') = 'array'
      and jsonb_typeof(layout->'hidden') = 'array'
    ),
  updated_at timestamptz not null default now(),
  primary key (user_id, layout_key)
);

alter table public.user_dashboard_layouts enable row level security;
alter table public.user_dashboard_layouts force row level security;

drop policy if exists user_dashboard_layouts_self_all on public.user_dashboard_layouts;
create policy user_dashboard_layouts_self_all on public.user_dashboard_layouts
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- No DELETE: "reset to default" is expressed as an upsert of the default
-- layout, matching user_sidebar_preferences' convention -- there is no
-- legitimate row-deletion workflow, so DELETE is deliberately not granted.
revoke all on public.user_dashboard_layouts from public;
revoke all on public.user_dashboard_layouts from anon;
revoke all on public.user_dashboard_layouts from authenticated;
revoke all on public.user_dashboard_layouts from service_role;
grant select, insert, update on public.user_dashboard_layouts to authenticated;
