-- ============================================================================
-- Rentec parity R21: atomic application-submission-attempt recorder
-- (PR #526 CHANGES fix).
--
-- Problem (ChatGPT 2026-10-01): the public apply route enforced its
-- DB-backed rate limit as check-then-insert — read the recent attempts for
-- (owner, listing, ip), then insert a new attempt row. Two concurrent
-- double-submits could both pass the check and both insert, defeating the
-- limit, and a crash between the check and the insert left the attempt
-- unrecorded.
--
-- Fix: a SECURITY DEFINER RPC that serializes attempts per
-- (owner_id, listing_id, ip_hash) with an advisory transaction lock, counts
-- the in-window attempts, and inserts the attempt row in the same
-- transaction. Check and record are atomic: the limit cannot be bypassed by
-- racing, and a denied attempt records nothing. Returns true when the
-- attempt was recorded (allowed), false when the caller is rate-limited.
-- ============================================================================

create or replace function public.record_application_submission_attempt(
  p_owner_id text,
  p_listing_id text,
  p_ip_hash text,
  p_window_seconds integer,
  p_max_submissions integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if p_owner_id is null or btrim(p_owner_id) = '' then
    raise exception 'Owner id is required.'
      using errcode = '22023';
  end if;
  if p_listing_id is null or btrim(p_listing_id) = '' then
    raise exception 'Listing id is required.'
      using errcode = '22023';
  end if;
  if p_ip_hash is null or btrim(p_ip_hash) = '' then
    raise exception 'IP hash is required.'
      using errcode = '22023';
  end if;
  if p_window_seconds is null or p_window_seconds <= 0 then
    raise exception 'Window seconds must be positive.'
      using errcode = '22023';
  end if;
  if p_max_submissions is null or p_max_submissions <= 0 then
    raise exception 'Max submissions must be positive.'
      using errcode = '22023';
  end if;

  -- Serialize concurrent submissions from the same IP for the same listing.
  -- The advisory xact lock is released at transaction end; the count and the
  -- insert below run atomically inside this function's transaction.
  perform pg_advisory_xact_lock(
    hashtext(p_owner_id || '|' || p_listing_id || '|' || p_ip_hash)
  );

  select count(*) into v_count
    from rental_application_rate_limits
    where owner_id = p_owner_id
      and listing_id = p_listing_id
      and ip_hash = p_ip_hash
      and submitted_at >= now() - make_interval(secs => p_window_seconds);

  if v_count >= p_max_submissions then
    return false;
  end if;

  insert into rental_application_rate_limits(owner_id, listing_id, ip_hash)
    values (p_owner_id, p_listing_id, p_ip_hash);

  return true;
end;
$$;

-- Called by the service-role public intake route ONLY. This function is
-- SECURITY DEFINER and takes caller-supplied owner/listing/ip with only
-- nonempty checks — granting execute to authenticated would let any logged-in
-- user poison another workspace's rate-limit rows (e.g. pre-filling a
-- competitor's limiter to 429 their applicants). Execution is therefore
-- restricted to service_role, which the public route already uses.
revoke all on function public.record_application_submission_attempt(
  text, text, text, integer, integer
) from public, anon, authenticated;
grant execute on function public.record_application_submission_attempt(
  text, text, text, integer, integer
) to service_role;
