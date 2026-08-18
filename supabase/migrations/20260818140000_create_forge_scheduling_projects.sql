create table if not exists forge_scheduling_projects (
  owner_id text not null,
  id text not null,
  primary key (owner_id, id),

  project_name text not null default 'New Project',
  -- Reserves room for the wall-board (lane-based, few activities) vs. WBS/activity-based
  -- (Primavera-P6-style, many activities under a work breakdown structure) split planned
  -- next -- not built yet, just keeping the schema from needing a disruptive change later.
  project_type text not null default 'wallboard',
  start_date date,
  end_date date,

  -- The whole SchedulingBoard state (lanes, blocks, dependencies, calendars, blackout
  -- windows, ...) as one blob, same shape schedulingBoardState.js already works with --
  -- passed straight through to/from supabase-js, no JSON.stringify needed for jsonb.
  board jsonb not null,

  -- True only for the shared example seeded below. Its owner_id is a sentinel no real
  -- auth.uid() can ever equal, so the owner-only policy below never grants anyone write
  -- access to it (including the account that ends up "owning" future seeds) -- it's a
  -- read-only reference for every user, not just editable-by-one-person-then-shared.
  is_public boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_forge_scheduling_projects_owner
  on forge_scheduling_projects(owner_id);

create index if not exists idx_forge_scheduling_projects_public
  on forge_scheduling_projects(is_public) where is_public;

alter table forge_scheduling_projects enable row level security;

alter table forge_scheduling_projects force row level security;

create policy "forge_scheduling_projects_owner_all"
on forge_scheduling_projects
for all
to authenticated
using (
    owner_id = auth.uid()::text
)
with check (
    owner_id = auth.uid()::text
);

create policy "forge_scheduling_projects_public_select"
on forge_scheduling_projects
for select
to authenticated
using (
    is_public = true
);

-- Seeds the shared "Example project" every user sees, carried over from the demo board
-- built out during the scheduling engine's local development (lanes, blocks, dependencies,
-- calendar assignments). owner_id 'example' is the sentinel described above -- it can never
-- match a real auth.uid(), so this row is visible to everyone via the public-select policy
-- but not writable by anyone through the app.
insert into forge_scheduling_projects (owner_id, id, project_name, project_type, start_date, end_date, is_public, board, created_at, updated_at)
values (
  'example',
  'schedule_project_abc795c6-f018-4913-98b4-adb3a002e5a2',
  'Example project',
  'wallboard',
  '2026-08-18',
  '2027-08-17',
  true,
  '{"id": "schedule_project_abc795c6-f018-4913-98b4-adb3a002e5a2", "projectName": "Example project", "startDate": "2026-08-18", "endDate": "2027-08-17", "weekWidth": 144, "lanes": [{"id": "lane_ms", "name": "Milestones"}, {"id": "lane_5", "name": "Gov", "calendarId": "cal_4_10s"}, {"id": "lane_6", "name": "Gov", "calendarId": "cal_4_10s"}, {"id": "lane_gov", "name": "Governance", "calendarId": "cal_4_10s"}, {"id": "lane_10", "name": "Eng", "calendarId": "cal_5_10s"}, {"id": "lane_11", "name": "Eng", "calendarId": "cal_5_10s"}, {"id": "lane_16", "name": "Eng", "calendarId": "cal_5_10s"}, {"id": "lane_20", "name": "Eng"}, {"id": "lane_eng", "name": "Engineering"}, {"id": "lane_proc", "name": "Procurement"}, {"id": "lane_21", "name": "FE"}, {"id": "lane_field1", "name": "Field Execution"}, {"id": "lane_field2", "name": "Field Execution (cont.)"}, {"id": "lane_shut", "name": "Shutdown & Startup"}, {"id": "lane_23", "name": "Scaffolding Support"}], "blocks": [{"id": "b1", "label": "Kickoff", "category": "gov", "milestone": true, "duration": 0, "startIdx": 0, "laneId": "lane_5", "taskCode": "A1010", "fontSize": null, "textColor": null, "bold": true}, {"id": "b7", "taskCode": "A1040", "label": "Charter Approval", "category": "gov", "milestone": false, "duration": 1, "startIdx": 0, "laneId": "lane_6", "fontSize": null, "textColor": null, "bold": true}, {"id": "b8", "taskCode": "A1050", "label": "Stage Gate Review", "category": "gov", "milestone": false, "duration": 1, "startIdx": 1, "laneId": "lane_gov", "fontSize": null, "textColor": null, "bold": true}, {"id": "b9", "taskCode": "A1060", "label": "Piping Install", "category": "field", "milestone": false, "duration": 6, "startIdx": 21, "laneId": "lane_field1", "fontSize": null, "textColor": null, "bold": true}, {"id": "b12", "taskCode": "A1070", "label": "Conceptual Design", "category": "eng", "milestone": false, "duration": 1, "startIdx": 0, "laneId": "lane_10", "fontSize": null, "textColor": null, "bold": true}, {"id": "b13", "taskCode": "A1080", "label": "Feasibility / FEED", "category": "eng", "milestone": false, "duration": 1, "startIdx": 1, "laneId": "lane_10", "fontSize": null, "textColor": null, "bold": true}, {"id": "b14", "taskCode": "A1090", "label": "Detailed Design", "category": "eng", "milestone": false, "duration": 2, "startIdx": 2, "laneId": "lane_10", "fontSize": null, "textColor": "#ffffff", "bold": true}, {"id": "b15", "taskCode": "A1100", "label": "Civil Engineering", "category": "eng", "milestone": false, "duration": 2, "startIdx": 5, "laneId": "lane_11", "fontSize": null, "textColor": null, "bold": true}, {"id": "b17", "taskCode": "A1110", "label": "Mechanical Engineering", "category": "eng", "milestone": false, "duration": 5, "startIdx": 5, "laneId": "lane_16", "fontSize": null, "textColor": null, "bold": true}, {"id": "b18", "taskCode": "A1120", "label": "Electrical Engineering", "category": "eng", "milestone": false, "duration": 5, "startIdx": 7, "laneId": "lane_20", "fontSize": null, "textColor": null, "bold": true}, {"id": "b19", "taskCode": "A1130", "label": "Instrumentation Engineering", "category": "eng", "milestone": false, "duration": 5, "startIdx": 7, "laneId": "lane_eng", "fontSize": null, "textColor": null, "bold": true}, {"id": "b25", "taskCode": "A1150", "label": "scaffolding support", "category": "proc", "milestone": false, "duration": 12, "startIdx": 15, "laneId": "lane_field2", "fontSize": null, "textColor": null, "bold": true}, {"id": "b26", "taskCode": "A1160", "label": "Turnaround Window", "category": "shut", "milestone": false, "duration": 3, "startIdx": 12, "laneId": "lane_field1", "fontSize": null, "textColor": null, "bold": true}, {"id": "b27", "taskCode": "A1170", "label": "Turnaround Window Make Captial Tie-ins", "category": "shut", "milestone": false, "duration": 6, "startIdx": 27, "laneId": "lane_field1", "fontSize": null, "textColor": null, "bold": true}, {"id": "b28", "taskCode": "A1180", "label": "Pre-Startup Safety Review (PSSR)", "category": "shut", "milestone": true, "duration": 0, "startIdx": 33, "laneId": "lane_21", "fontSize": null, "textColor": null, "bold": true}, {"id": "b29", "taskCode": "A1190", "label": "Return to Service", "category": "shut", "milestone": true, "duration": 0, "startIdx": 34, "laneId": "lane_field1", "fontSize": null, "textColor": null, "bold": true}, {"id": "b30", "taskCode": "A1200", "label": "Investment / Funding Approval", "category": "gov", "milestone": true, "duration": 0, "startIdx": 21, "laneId": "lane_gov", "fontSize": null, "textColor": null, "bold": true}], "dependencies": [{"id": "dep31", "predecessorId": "b13", "successorId": "b14", "relationshipType": "FS", "lagDays": 0}, {"id": "dep32", "predecessorId": "b12", "successorId": "b13", "relationshipType": "FS", "lagDays": 0}, {"id": "dep33", "predecessorId": "b14", "successorId": "b15", "relationshipType": "FS", "lagDays": 0}, {"id": "dep34", "predecessorId": "b15", "successorId": "b18", "relationshipType": "FS", "lagDays": 0}, {"id": "dep35", "predecessorId": "b18", "successorId": "b25", "relationshipType": "FS", "lagDays": 0}, {"id": "dep36", "predecessorId": "b25", "successorId": "b27", "relationshipType": "FS", "lagDays": 0}, {"id": "dep37", "predecessorId": "b27", "successorId": "b28", "relationshipType": "FS", "lagDays": 0}, {"id": "dep38", "predecessorId": "b28", "successorId": "b29", "relationshipType": "FS", "lagDays": 0}, {"id": "dep39", "predecessorId": "b7", "successorId": "b8", "relationshipType": "FS", "lagDays": 0}, {"id": "dep40", "predecessorId": "b8", "successorId": "b14", "relationshipType": "FS", "lagDays": 0}], "customChips": [], "calendars": [{"id": "cal_4_10s", "name": "4-10s", "workingDays": [1, 2, 3, 4]}, {"id": "cal_4_10s_8", "name": "4-10s + 8", "workingDays": [1, 2, 3, 4, 5]}, {"id": "cal_5_10s", "name": "5-10s", "workingDays": [1, 2, 3, 4, 5]}, {"id": "cal_6_10s", "name": "6-10s", "workingDays": [1, 2, 3, 4, 5, 6]}, {"id": "cal_7_10s", "name": "7-10s", "workingDays": [0, 1, 2, 3, 4, 5, 6]}], "defaultCalendarId": "cal_5_10s", "blackoutWindows": [], "nextId": 41, "nextTaskNumber": 1210, "createdAt": "2026-08-18T04:40:17.149Z", "updatedAt": "2026-08-18T23:17:02.382Z"}'::jsonb,
  '2026-08-18T04:40:17.149Z',
  '2026-08-18T23:17:02.382Z'
)
on conflict (owner_id, id) do nothing;
