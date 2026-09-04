-- Selectable, editable reference workout programs (e.g. a hypertrophy program followed from a
-- PDF), distinct from health_workouts (which logs what was actually performed). A program has
-- many days; each day's exercises are a jsonb array, mirroring the health_workouts.details
-- pattern rather than a third normalized table -- consistent with how this schema already treats
-- an ordered list of exercises as one unstructured field.
create table public.health_programs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.health_workspaces(id) on delete cascade,
  name text not null,
  source text,
  notes text,
  created_by uuid not null references auth.users(id),
  updated_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.health_program_days (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.health_workspaces(id) on delete cascade,
  program_id uuid not null references public.health_programs(id) on delete cascade,
  day_number integer not null check (day_number > 0),
  title text not null,
  exercises jsonb not null default '[]'::jsonb,
  created_by uuid not null references auth.users(id),
  updated_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (jsonb_typeof(exercises) = 'array'),
  unique (program_id, day_number)
);

create index health_program_days_program on public.health_program_days(program_id, day_number);

do $$
declare t text;
begin
  foreach t in array array['health_programs', 'health_program_days'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('create policy %I on public.%I for all to authenticated using (public.health_has_workspace_access(workspace_id)) with check (public.health_has_workspace_access(workspace_id))', t || '_member_all', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.audit_health_record_change()', t || '_audit', t);
  end loop;
end $$;

grant select, insert, update, delete on public.health_programs, public.health_program_days to authenticated;
