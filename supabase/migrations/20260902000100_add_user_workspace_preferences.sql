-- Per-user landing preference: which top-level workspace tile someone starred as their favorite
-- on the "Choose a workspace" hub (/), so a fresh visit there redirects straight to it. Personal
-- to the signed-in user, never shared with anyone else on the same account or workspace.
create table public.user_workspace_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  favorite_workspace_id text check (
    favorite_workspace_id in ('marketplace', 'rentals', 'forge', 'scheduling', 'dev', 'health')
  ),
  updated_at timestamptz not null default now()
);

alter table public.user_workspace_preferences enable row level security;
alter table public.user_workspace_preferences force row level security;

create policy user_workspace_preferences_self_all on public.user_workspace_preferences
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

grant select, insert, update, delete on public.user_workspace_preferences to authenticated;
