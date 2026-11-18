-- Fix round 1 (P1 -- ChatGPT review 2026-11-18, PR #833): authorize the real storage-object
-- deletion path.
--
-- The base migration (20260901000700_create_private_health_tracker.sql) created only
-- health_document_object_insert and health_document_object_select policies on
-- storage.objects. HealthSourceDocumentCard.remove() calls
-- supabase.storage.from(bucket).remove([object_path]) after deleting the health_documents row --
-- with no DELETE policy on storage.objects, that call is rejected by RLS (storage.objects is
-- itself a regular Postgres table with RLS, same mechanism as every other table here), so the
-- stored file would silently remain orphaned forever even though the UI and test described it as
-- removed. Losing the metadata row revokes normal read access under the existing SELECT policy,
-- but that is not the same as deleting the stored document.
--
-- Mirrors health_document_object_insert's own ownership pattern exactly: the workspace id is the
-- object path's first folder segment (storage.foldername(name)[1]), checked against
-- health_has_workspace_access -- the same predicate, the same path convention, nothing new
-- invented for this one operation.
create policy health_document_object_delete on storage.objects for delete to authenticated
  using(bucket_id='health-documents' and public.health_has_workspace_access(((storage.foldername(name))[1])::uuid));
