-- Shared FORGE workspace membership -- Checkpoint 3 (RPC half), group covering notifications/support.
-- Converts the owner-equality guard in each function from `p_owner_id <> auth.uid()::text` (or the
-- `authenticated_owner_id` local-variable equivalent) to `not has_workspace_access(p_owner_id)`, so
-- an active co-owner can call these exactly as the primary owner can. create or replace function
-- does not reset previously granted privileges, so the original migrations' revoke/grant statements
-- (where present) remain in effect -- nothing to repeat here.
--
-- Every function body below is otherwise byte-for-byte identical to its current live definition
-- (captured via pg_get_functiondef against the linked Production database) except for the single
-- guard substitution -- generated, not hand-transcribed, specifically to avoid introducing a subtle
-- error into business logic this large. Where a function also uses its authenticated actor id for
-- audit-trail purposes (e.g. `recorded_by`, `approved_by`, `forge_cutover_activated_by`), that usage
-- is deliberately left untouched -- it should keep recording the real acting user, not the resolved
-- workspace owner (requirement: record the acting user separately from the canonical owner).

create or replace function public.cancel_rental_notification(p_owner_id text, p_notification_id text)
 returns rental_notification_outbox
 language plpgsql
 set search_path to 'public'
as $function$declare result rental_notification_outbox;begin
 update rental_notification_outbox set status='cancelled',cancelled_at=now() where owner_id=p_owner_id and has_workspace_access(p_owner_id) and id=p_notification_id and status in('queued','failed') returning * into result;
 if result.id is null then raise exception 'Cancellable notification was not found.';end if;return result;end$function$;


create or replace function public.update_rental_support_case(p_owner_id text, p_case_id text, p_status text, p_public_note text, p_private_note text, p_resolution text)
 returns rental_support_cases
 language plpgsql
 set search_path to 'public'
as $function$declare result rental_support_cases;event_name text;begin if not has_workspace_access(p_owner_id) or p_status not in('open','investigating','waiting_on_tenant','waiting_on_provider','resolved','closed')then raise exception 'Owner support update is invalid.';end if;event_name:=case when p_status='resolved'then'resolved'when p_status='closed'then'closed'else'status_changed'end;update rental_support_cases set status=p_status,tenant_visible_summary=coalesce(nullif(btrim(p_public_note),''),tenant_visible_summary),private_owner_note=coalesce(nullif(btrim(p_private_note),''),private_owner_note),resolution=case when p_status in('resolved','closed')then nullif(btrim(p_resolution),'')else resolution end,resolved_at=case when p_status='resolved'then now()else resolved_at end,closed_at=case when p_status='closed'then now()else closed_at end,updated_at=now()where owner_id=p_owner_id and id=p_case_id returning * into result;if result.id is null then raise exception 'Support case was not found.';end if;insert into rental_support_case_events(owner_id,id,case_id,event_type,public_note,private_note,status,recorded_by)values(p_owner_id,'rental_support_event_'||gen_random_uuid()::text,p_case_id,event_name,nullif(btrim(p_public_note),''),nullif(btrim(p_private_note),''),p_status,auth.uid()::text);return result;end$function$;
