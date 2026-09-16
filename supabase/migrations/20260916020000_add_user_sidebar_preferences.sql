-- Per-user, per-sidebar customization: which nav items someone has hidden from a given app
-- sidebar (an Excel-style "show/hide columns" checklist). Keyed by an arbitrary sidebar_key so
-- this one table/contract can be reused by a future sidebar (e.g. Forge Financial) without a new
-- migration -- only "rental-manager" is a real, wired-up key today; the API route enforces its own
-- allowlist of which keys are actually usable, same pattern as favorite-workspace's
-- VALID_WORKSPACE_IDS. Personal to the signed-in user, never shared with anyone else, including a
-- co-owner on the same workspace -- this is a display preference, not workspace-level state.
create table if not exists public.user_sidebar_preferences (
  user_id uuid not null references auth.users(id) on delete cascade,
  sidebar_key text not null check (sidebar_key ~ '^[a-z][a-z0-9-]*$'),
  hidden_item_ids jsonb not null default '[]'::jsonb check (jsonb_typeof(hidden_item_ids) = 'array'),
  updated_at timestamptz not null default now(),
  primary key (user_id, sidebar_key)
);

alter table public.user_sidebar_preferences enable row level security;
alter table public.user_sidebar_preferences force row level security;

drop policy if exists user_sidebar_preferences_self_all on public.user_sidebar_preferences;
create policy user_sidebar_preferences_self_all on public.user_sidebar_preferences
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- No DELETE: "reset to default" is expressed as an upsert of hidden_item_ids = '[]', matching
-- favorite-workspace's null-clears-the-favorite convention -- there is no legitimate row-deletion
-- workflow, so DELETE is deliberately not granted (production migrations run as supabase_admin,
-- which carries an ambient default ACL that would otherwise grant this automatically; the local
-- Supabase CLI stack has no such default, which is exactly what makes an omission like this visible
-- in local tests instead of silently only in production).
revoke all on public.user_sidebar_preferences from public;
revoke all on public.user_sidebar_preferences from anon;
revoke all on public.user_sidebar_preferences from authenticated;
revoke all on public.user_sidebar_preferences from service_role;
grant select, insert, update on public.user_sidebar_preferences to authenticated;
