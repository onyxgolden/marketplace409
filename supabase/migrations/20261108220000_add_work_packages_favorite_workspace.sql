-- Allow the new "Work Packages" hub tile to be starred as a favorite workspace.
-- The CHECK on favorite_workspace_id was created inline (unnamed) in
-- 20260902000100, so Postgres named it
-- user_workspace_preferences_favorite_workspace_id_check. Drop and re-add it
-- with the same allowed set plus 'work-packages'. No other values change.
-- FILE ONLY: apply needs a separate owner word; until it is applied, starring
-- the Work Packages tile as a favorite fails at the database, while the tile
-- link itself works regardless.
alter table public.user_workspace_preferences
  drop constraint if exists user_workspace_preferences_favorite_workspace_id_check;

alter table public.user_workspace_preferences
  add constraint user_workspace_preferences_favorite_workspace_id_check
  check (favorite_workspace_id in ('marketplace', 'rentals', 'forge', 'scheduling', 'dev', 'health', 'work-packages'));
