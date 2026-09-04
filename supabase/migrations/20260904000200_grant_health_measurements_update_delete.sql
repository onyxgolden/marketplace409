-- health_measurements was insert-only, same as the other health tables before
-- 20260904000100_grant_health_update_delete.sql -- it was left out of that migration because the
-- Vitals UI (steps, blood pressure, heart rate, blood oxygen, sleep, weight) didn't exist yet. RLS
-- already permits every operation via the workspace-access policy from
-- 20260901000700_create_private_health_tracker.sql; this only widens the column-level grant.
grant update, delete on public.health_measurements to authenticated;
