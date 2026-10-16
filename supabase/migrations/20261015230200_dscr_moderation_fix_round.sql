-- DSCR fix round (ChatGPT review DSCR-IMPL-001..005, 2026-10-15).
--
-- IMPL-002: audit append-only + retention-safe.
--   - FKs on audit/versions/abuse_reports: ON DELETE CASCADE -> ON DELETE RESTRICT
--     (listings are soft-removed via status; dependents must survive).
--   - dscr_lender_audit rejects UPDATE/DELETE at the DB boundary for ALL roles,
--     including the service role / SECURITY DEFINER paths.
--   - Every state change + its audit event happens in ONE transaction via the
--     SECURITY DEFINER RPCs below (no more insert-then-unchecked-audit).
-- IMPL-003: duplicate-NMLS + 24h throttle are atomic.
--   - UNIQUE(nmls_number) at the DB boundary.
--   - dscr_submit_lender() serializes per-user with pg_advisory_xact_lock,
--     so the 3-per-24h count and the insert cannot race.
--   - Duplicate NMLS is preserved as a reviewable staged version row
--     (dscr_lender_versions), never a second listing, never discarded.
-- IMPL-001: moderation lifecycle transitions live in dscr_review_transition()
--   and dscr_stage_version() — approve/reject/publish/unpublish/reconfirm/
--   remove plus staged provider edits, each with its audit event, atomic.
-- IMPL-005: dscr_report_abuse() couples report + counter + audit atomically
--   with per-user-per-lender and per-user-global 24h throttles.
-- IMPL-004: corrective update for the CoreVest seed row (NV/ID/ND/SD removed,
--   duplicate NE removed) in case seed v1 was already applied anywhere.
--   The seed migration file itself is also corrected for fresh installs.

-- ---------------------------------------------------------------------------
-- 1. NMLS uniqueness (IMPL-003)
-- ---------------------------------------------------------------------------
ALTER TABLE public.dscr_lenders
  ADD CONSTRAINT dscr_lenders_nmls_unique UNIQUE (nmls_number);

-- ---------------------------------------------------------------------------
-- 2. Retention-safe foreign keys: RESTRICT instead of CASCADE (IMPL-002)
-- ---------------------------------------------------------------------------
ALTER TABLE public.dscr_lender_audit
  DROP CONSTRAINT IF EXISTS dscr_lender_audit_lender_id_fkey;
ALTER TABLE public.dscr_lender_audit
  ADD CONSTRAINT dscr_lender_audit_lender_id_fkey
  FOREIGN KEY (lender_id) REFERENCES public.dscr_lenders(id) ON DELETE RESTRICT;

ALTER TABLE public.dscr_lender_versions
  DROP CONSTRAINT IF EXISTS dscr_lender_versions_lender_id_fkey;
ALTER TABLE public.dscr_lender_versions
  ADD CONSTRAINT dscr_lender_versions_lender_id_fkey
  FOREIGN KEY (lender_id) REFERENCES public.dscr_lenders(id) ON DELETE RESTRICT;

ALTER TABLE public.dscr_lender_abuse_reports
  DROP CONSTRAINT IF EXISTS dscr_lender_abuse_reports_lender_id_fkey;
ALTER TABLE public.dscr_lender_abuse_reports
  ADD CONSTRAINT dscr_lender_abuse_reports_lender_id_fkey
  FOREIGN KEY (lender_id) REFERENCES public.dscr_lenders(id) ON DELETE RESTRICT;

-- ---------------------------------------------------------------------------
-- 3. Audit immutability: UPDATE/DELETE rejected for every role (IMPL-002)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dscr_audit_immutable()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'dscr_lender_audit is append-only: UPDATE and DELETE are prohibited';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_dscr_audit_immutable ON public.dscr_lender_audit;
CREATE TRIGGER trg_dscr_audit_immutable
  BEFORE UPDATE OR DELETE ON public.dscr_lender_audit
  FOR EACH ROW EXECUTE FUNCTION public.dscr_audit_immutable();

-- ---------------------------------------------------------------------------
-- 4. IMPL-004 corrective update FIRST (before the no-duplicate-states CHECK
--    below): CoreVest NV/ID/ND/SD are NOT served per
--    https://www.corevestfinance.com/contact (retrieved 2026-10-15);
--    duplicate NE removed. Applies only if seed v1 was already applied.
-- ---------------------------------------------------------------------------
UPDATE public.dscr_lenders
SET states_served = ARRAY['CA','TX','FL','NY','NJ','AZ','CO','WA','OR','UT','GA','NC','SC','TN','VA','MD','PA','OH','IL','MI','MN','WI','MO','KS','OK','AR','LA','MS','AL','KY','IN','IA','NE','NM','MT','WY','ME','NH','VT','MA','CT','RI','DE','DC','HI'],
    public_source_url = 'https://www.corevestfinance.com/contact',
    public_source_retrieved_at = '2026-10-15',
    seed_receipt = 'Seed v2 (2026-10-15, IMPL-004 correction): NMLS 1627183 and phone 844.223.7496 from corevestfinance.com/contact. States served = all states EXCEPT Nevada, Idaho, North Dakota, South Dakota, which corevestfinance.com/contact states it does "not currently lend in" (retrieved 2026-10-15). Duplicate Nebraska entry removed. Loan range $75k-$2M+, up to 80% LTV, SFR 1-4 unit, 30-year DSCR terms per corevestfinance.com DSCR pages (provider-claimed). Subsidiary of Redwood Trust per site.',
    updated_at = now()
WHERE nmls_number = '1627183';

-- ---------------------------------------------------------------------------
-- 5. No duplicate states in states_served (IMPL-004 guard)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dscr_states_unique(states text[])
RETURNS boolean AS $$
  SELECT states IS NULL
     OR cardinality(states) = (SELECT count(DISTINCT s) FROM unnest(states) AS s);
$$ LANGUAGE sql IMMUTABLE;

ALTER TABLE public.dscr_lenders
  DROP CONSTRAINT IF EXISTS dscr_lenders_states_unique;
ALTER TABLE public.dscr_lenders
  ADD CONSTRAINT dscr_lenders_states_unique
  CHECK (public.dscr_states_unique(states_served));

-- ---------------------------------------------------------------------------
-- 6. Small jsonb helpers used by the RPCs
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dscr_jsonb_text_array(v jsonb)
RETURNS text[] AS $$
  SELECT CASE
    WHEN jsonb_typeof(v) = 'array'
    THEN coalesce((SELECT array_agg(x) FROM jsonb_array_elements_text(v) AS x), '{}'::text[])
    ELSE '{}'::text[]
  END;
$$ LANGUAGE sql IMMUTABLE;

-- ---------------------------------------------------------------------------
-- 7. dscr_submit_lender: atomic submit (IMPL-002 + IMPL-003)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dscr_submit_lender(p_user_id uuid, p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_recent int;
  v_existing_id uuid;
  v_lender_id uuid;
  v_version_id uuid;
  v_version_no int;
BEGIN
  -- Serialize this user's submissions: the 24h count check and the insert
  -- below are one atomic unit. Concurrent requests cannot both pass.
  PERFORM pg_advisory_xact_lock(hashtext('dscr_submit:' || p_user_id::text));

  SELECT count(*) INTO v_recent
  FROM public.dscr_lenders
  WHERE owner_user_id = p_user_id
    AND created_at >= now() - interval '24 hours';
  IF v_recent >= 3 THEN
    RAISE EXCEPTION 'SUBMIT_THROTTLED' USING ERRCODE = 'P0001';
  END IF;

  SELECT id INTO v_existing_id
  FROM public.dscr_lenders
  WHERE nmls_number = p_payload ->> 'nmls_number';

  IF v_existing_id IS NOT NULL THEN
    -- Duplicate NMLS: preserve the submission as a reviewable staged version.
    SELECT coalesce(max(version_number), 0) + 1 INTO v_version_no
    FROM public.dscr_lender_versions WHERE lender_id = v_existing_id;
    INSERT INTO public.dscr_lender_versions
      (lender_id, version_number, payload, submitted_by, review_status)
    VALUES (v_existing_id, v_version_no, p_payload, p_user_id, 'pending')
    RETURNING id INTO v_version_id;
    INSERT INTO public.dscr_lender_audit
      (lender_id, actor_user_id, action, note)
    VALUES (v_existing_id, p_user_id, 'submitted',
            'Duplicate-NMLS submission preserved as staged version for admin review.');
    RETURN jsonb_build_object(
      'duplicate', true, 'lender_id', v_existing_id, 'version_id', v_version_id);
  END IF;

  BEGIN
    INSERT INTO public.dscr_lenders (
      company_name, nmls_number, nmls_consumer_access_url,
      identity_review_status, status,
      states_served, min_loan_amount, max_loan_amount,
      property_types, transaction_types,
      occupancy_entity_restrictions, max_ltv, min_credit_score_claim,
      prepayment_penalty_availability, min_dscr_accepted,
      contact_name, contact_phone, contact_email, application_url,
      owner_user_id, terms_as_of_date
    ) VALUES (
      p_payload ->> 'company_name',
      p_payload ->> 'nmls_number',
      p_payload ->> 'nmls_consumer_access_url',
      'pending', 'pending_review',
      public.dscr_jsonb_text_array(p_payload -> 'states_served'),
      (p_payload ->> 'min_loan_amount')::numeric,
      (p_payload ->> 'max_loan_amount')::numeric,
      public.dscr_jsonb_text_array(p_payload -> 'property_types'),
      public.dscr_jsonb_text_array(p_payload -> 'transaction_types'),
      nullif(p_payload ->> 'occupancy_entity_restrictions', ''),
      (p_payload ->> 'max_ltv')::numeric,
      (p_payload ->> 'min_credit_score_claim')::integer,
      nullif(p_payload ->> 'prepayment_penalty_availability', ''),
      (p_payload ->> 'min_dscr_accepted')::numeric,
      nullif(p_payload ->> 'contact_name', ''),
      nullif(p_payload ->> 'contact_phone', ''),
      nullif(p_payload ->> 'contact_email', ''),
      nullif(p_payload ->> 'application_url', ''),
      p_user_id,
      (p_payload ->> 'terms_as_of_date')::date
    )
    RETURNING id INTO v_lender_id;
  EXCEPTION WHEN unique_violation THEN
    -- Lost a cross-user race on the NMLS unique constraint: stage as a
    -- duplicate claim instead of failing or creating a second row.
    SELECT id INTO v_existing_id
    FROM public.dscr_lenders
    WHERE nmls_number = p_payload ->> 'nmls_number';
    SELECT coalesce(max(version_number), 0) + 1 INTO v_version_no
    FROM public.dscr_lender_versions WHERE lender_id = v_existing_id;
    INSERT INTO public.dscr_lender_versions
      (lender_id, version_number, payload, submitted_by, review_status)
    VALUES (v_existing_id, v_version_no, p_payload, p_user_id, 'pending')
    RETURNING id INTO v_version_id;
    INSERT INTO public.dscr_lender_audit
      (lender_id, actor_user_id, action, note)
    VALUES (v_existing_id, p_user_id, 'submitted',
            'Duplicate-NMLS submission (race) preserved as staged version for admin review.');
    RETURN jsonb_build_object(
      'duplicate', true, 'lender_id', v_existing_id, 'version_id', v_version_id);
  END;

  INSERT INTO public.dscr_lender_audit
    (lender_id, actor_user_id, action, note)
  VALUES (v_lender_id, p_user_id, 'submitted',
          'Provider submission queued for directory review.');

  RETURN jsonb_build_object('ok', true, 'id', v_lender_id);
END;
$$;

-- ---------------------------------------------------------------------------
-- 8. dscr_stage_version: provider edit staging (IMPL-001)
--    The live row is never touched; the edit waits in dscr_lender_versions.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dscr_stage_version(
  p_user_id uuid, p_lender_id uuid, p_payload jsonb, p_removal_requested boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_version_id uuid;
  v_version_no int;
  v_note text;
BEGIN
  PERFORM 1 FROM public.dscr_lenders WHERE id = p_lender_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'VERSION_LENDER_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  SELECT coalesce(max(version_number), 0) + 1 INTO v_version_no
  FROM public.dscr_lender_versions WHERE lender_id = p_lender_id;

  INSERT INTO public.dscr_lender_versions
    (lender_id, version_number, payload, submitted_by, review_status)
  VALUES (p_lender_id, v_version_no, p_payload, p_user_id, 'pending')
  RETURNING id INTO v_version_id;

  v_note := CASE WHEN p_removal_requested
    THEN 'Provider requested removal; staged as version for admin review. Live listing untouched.'
    ELSE 'Provider edit staged as version for admin review. Live listing untouched.'
  END;
  INSERT INTO public.dscr_lender_audit (lender_id, actor_user_id, action, note)
  VALUES (p_lender_id, p_user_id, 'edited', v_note);

  RETURN jsonb_build_object('ok', true, 'version_id', v_version_id,
                            'version_number', v_version_no);
END;
$$;

-- ---------------------------------------------------------------------------
-- 9. dscr_review_transition: admin moderation transitions (IMPL-001)
--    Every transition validates the current state, applies the change, and
--    writes its audit event in ONE transaction.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dscr_review_transition(
  p_actor_id uuid, p_lender_id uuid, p_action text,
  p_note text DEFAULT NULL, p_version_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
  v_payload jsonb;
  v_version_lender uuid;
  v_version_status text;
BEGIN
  SELECT status INTO v_status FROM public.dscr_lenders
  WHERE id = p_lender_id FOR UPDATE;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'TRANSITION_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  IF p_action = 'approve_submission' THEN
    IF v_status <> 'pending_review' THEN
      RAISE EXCEPTION 'TRANSITION_INVALID: approve_submission requires pending_review'
        USING ERRCODE = 'P0001';
    END IF;
    UPDATE public.dscr_lenders
    SET status = 'published',
        identity_review_status = 'identity-confirmed',
        last_directory_reviewed_at = now()
    WHERE id = p_lender_id;
    INSERT INTO public.dscr_lender_audit (lender_id, actor_user_id, action, note)
    VALUES (p_lender_id, p_actor_id, 'approved',
            coalesce(p_note, 'Submission approved; listing published and ownership bound.'));

  ELSIF p_action = 'reject_submission' THEN
    IF v_status <> 'pending_review' THEN
      RAISE EXCEPTION 'TRANSITION_INVALID: reject_submission requires pending_review'
        USING ERRCODE = 'P0001';
    END IF;
    UPDATE public.dscr_lenders SET status = 'unpublished' WHERE id = p_lender_id;
    INSERT INTO public.dscr_lender_audit (lender_id, actor_user_id, action, note)
    VALUES (p_lender_id, p_actor_id, 'rejected',
            coalesce(p_note, 'Submission rejected.'));

  ELSIF p_action = 'approve_version' THEN
    IF p_version_id IS NULL THEN
      RAISE EXCEPTION 'TRANSITION_INVALID: approve_version requires version_id'
        USING ERRCODE = 'P0001';
    END IF;
    SELECT payload, review_status, lender_id
      INTO v_payload, v_version_status, v_version_lender
    FROM public.dscr_lender_versions WHERE id = p_version_id FOR UPDATE;
    IF v_version_status IS NULL OR v_version_lender <> p_lender_id THEN
      RAISE EXCEPTION 'TRANSITION_NOT_FOUND: version not found for lender'
        USING ERRCODE = 'P0001';
    END IF;
    IF v_version_status <> 'pending' THEN
      RAISE EXCEPTION 'TRANSITION_INVALID: version is not pending'
        USING ERRCODE = 'P0001';
    END IF;
    UPDATE public.dscr_lenders SET
      states_served = public.dscr_jsonb_text_array(v_payload -> 'states_served'),
      min_loan_amount = (v_payload ->> 'min_loan_amount')::numeric,
      max_loan_amount = (v_payload ->> 'max_loan_amount')::numeric,
      property_types = public.dscr_jsonb_text_array(v_payload -> 'property_types'),
      transaction_types = public.dscr_jsonb_text_array(v_payload -> 'transaction_types'),
      occupancy_entity_restrictions = nullif(v_payload ->> 'occupancy_entity_restrictions', ''),
      max_ltv = (v_payload ->> 'max_ltv')::numeric,
      min_credit_score_claim = (v_payload ->> 'min_credit_score_claim')::integer,
      prepayment_penalty_availability = nullif(v_payload ->> 'prepayment_penalty_availability', ''),
      min_dscr_accepted = (v_payload ->> 'min_dscr_accepted')::numeric,
      contact_name = nullif(v_payload ->> 'contact_name', ''),
      contact_phone = nullif(v_payload ->> 'contact_phone', ''),
      contact_email = nullif(v_payload ->> 'contact_email', ''),
      application_url = nullif(v_payload ->> 'application_url', ''),
      last_directory_reviewed_at = now()
    WHERE id = p_lender_id;
    UPDATE public.dscr_lender_versions
    SET review_status = 'approved', reviewed_by = p_actor_id, reviewed_at = now(),
        review_note = p_note
    WHERE id = p_version_id;
    INSERT INTO public.dscr_lender_audit (lender_id, actor_user_id, action, note)
    VALUES (p_lender_id, p_actor_id, 'approved',
            coalesce(p_note, 'Staged version approved and applied to live listing.'));

  ELSIF p_action = 'reject_version' THEN
    IF p_version_id IS NULL THEN
      RAISE EXCEPTION 'TRANSITION_INVALID: reject_version requires version_id'
        USING ERRCODE = 'P0001';
    END IF;
    SELECT review_status, lender_id INTO v_version_status, v_version_lender
    FROM public.dscr_lender_versions WHERE id = p_version_id FOR UPDATE;
    IF v_version_status IS NULL OR v_version_lender <> p_lender_id THEN
      RAISE EXCEPTION 'TRANSITION_NOT_FOUND: version not found for lender'
        USING ERRCODE = 'P0001';
    END IF;
    IF v_version_status <> 'pending' THEN
      RAISE EXCEPTION 'TRANSITION_INVALID: version is not pending'
        USING ERRCODE = 'P0001';
    END IF;
    UPDATE public.dscr_lender_versions
    SET review_status = 'rejected', reviewed_by = p_actor_id, reviewed_at = now(),
        review_note = p_note
    WHERE id = p_version_id;
    INSERT INTO public.dscr_lender_audit (lender_id, actor_user_id, action, note)
    VALUES (p_lender_id, p_actor_id, 'rejected',
            coalesce(p_note, 'Staged version rejected; live listing unchanged.'));

  ELSIF p_action = 'publish' THEN
    IF v_status <> 'unpublished' THEN
      RAISE EXCEPTION 'TRANSITION_INVALID: publish requires unpublished'
        USING ERRCODE = 'P0001';
    END IF;
    UPDATE public.dscr_lenders
    SET status = 'published', last_directory_reviewed_at = now()
    WHERE id = p_lender_id;
    INSERT INTO public.dscr_lender_audit (lender_id, actor_user_id, action, note)
    VALUES (p_lender_id, p_actor_id, 'published',
            coalesce(p_note, 'Listing published.'));

  ELSIF p_action = 'unpublish' THEN
    IF v_status <> 'published' THEN
      RAISE EXCEPTION 'TRANSITION_INVALID: unpublish requires published'
        USING ERRCODE = 'P0001';
    END IF;
    UPDATE public.dscr_lenders SET status = 'unpublished' WHERE id = p_lender_id;
    INSERT INTO public.dscr_lender_audit (lender_id, actor_user_id, action, note)
    VALUES (p_lender_id, p_actor_id, 'unpublished',
            coalesce(p_note, 'Listing unpublished from public views; record retained.'));

  ELSIF p_action = 'reconfirm' THEN
    IF v_status <> 'published' THEN
      RAISE EXCEPTION 'TRANSITION_INVALID: reconfirm requires published'
        USING ERRCODE = 'P0001';
    END IF;
    UPDATE public.dscr_lenders SET last_directory_reviewed_at = now()
    WHERE id = p_lender_id;
    INSERT INTO public.dscr_lender_audit (lender_id, actor_user_id, action, note)
    VALUES (p_lender_id, p_actor_id, 'reconfirmed',
            coalesce(p_note, 'Directory review reconfirmed; terms freshness reset.'));

  ELSIF p_action = 'remove' THEN
    -- Soft removal only: status -> unpublished, audit retained (IMPL-002).
    IF v_status NOT IN ('published', 'unpublished', 'pending_review') THEN
      RAISE EXCEPTION 'TRANSITION_INVALID: remove requires a live-state listing'
        USING ERRCODE = 'P0001';
    END IF;
    UPDATE public.dscr_lenders SET status = 'unpublished' WHERE id = p_lender_id;
    INSERT INTO public.dscr_lender_audit (lender_id, actor_user_id, action, note)
    VALUES (p_lender_id, p_actor_id, 'removed',
            coalesce(p_note, 'Listing soft-removed from public views; audit trail retained.'));

  ELSE
    RAISE EXCEPTION 'TRANSITION_INVALID: unknown action %', p_action
      USING ERRCODE = 'P0001';
  END IF;

  RETURN jsonb_build_object('ok', true, 'action', p_action, 'lender_id', p_lender_id);
END;
$$;

-- ---------------------------------------------------------------------------
-- 10. dscr_report_abuse: atomic abuse report (IMPL-005)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dscr_report_abuse(
  p_user_id uuid, p_lender_id uuid, p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_found boolean;
  v_dup int;
  v_global int;
BEGIN
  -- Serialize this user's reports on this lender.
  PERFORM pg_advisory_xact_lock(
    hashtext('dscr_report:' || p_user_id::text || ':' || p_lender_id::text));

  SELECT true INTO v_found
  FROM public.dscr_lenders
  WHERE id = p_lender_id AND status = 'published';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'REPORT_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  -- One report per user per lender per 24h.
  SELECT count(*) INTO v_dup
  FROM public.dscr_lender_abuse_reports
  WHERE lender_id = p_lender_id
    AND reporter_user_id = p_user_id
    AND created_at >= now() - interval '24 hours';
  IF v_dup >= 1 THEN
    RAISE EXCEPTION 'REPORT_THROTTLED' USING ERRCODE = 'P0001';
  END IF;

  -- Global cap: 10 reports per user per 24h (spam control).
  SELECT count(*) INTO v_global
  FROM public.dscr_lender_abuse_reports
  WHERE reporter_user_id = p_user_id
    AND created_at >= now() - interval '24 hours';
  IF v_global >= 10 THEN
    RAISE EXCEPTION 'REPORT_THROTTLED' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.dscr_lender_abuse_reports (lender_id, reporter_user_id, reason)
  VALUES (p_lender_id, p_user_id, p_reason);

  UPDATE public.dscr_lenders
  SET abuse_report_count = abuse_report_count + 1
  WHERE id = p_lender_id;

  INSERT INTO public.dscr_lender_audit (lender_id, actor_user_id, action, note)
  VALUES (p_lender_id, p_user_id, 'abuse_reported',
          left(p_reason, 500));

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- ---------------------------------------------------------------------------
-- 11. Execute grants (routes call these via the service-role client)
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.dscr_submit_lender(uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dscr_stage_version(uuid, uuid, jsonb, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dscr_review_transition(uuid, uuid, text, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dscr_report_abuse(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dscr_audit_immutable() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dscr_states_unique(text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dscr_jsonb_text_array(jsonb) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.dscr_submit_lender(uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.dscr_stage_version(uuid, uuid, jsonb, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.dscr_review_transition(uuid, uuid, text, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.dscr_report_abuse(uuid, uuid, text) TO service_role;
