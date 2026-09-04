-- health_lab_results, health_workouts and health_regimen_items were insert-only (plus update for
-- regimen_items) by design when first built -- there was no edit/delete UI, so no client ever
-- needed the privilege. RLS already permits every operation via the existing "for all to
-- authenticated using (health_has_workspace_access(...))" policies created in
-- 20260901000700_create_private_health_tracker.sql; this migration only widens the column-level
-- grants those policies were waiting behind, so a workspace member can now edit or delete their
-- own household's records through the app instead of only ever appending to them.
grant update, delete on public.health_lab_results, public.health_workouts to authenticated;
grant delete on public.health_regimen_items to authenticated;
