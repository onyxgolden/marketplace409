-- DSCR fix round R1 (ChatGPT re-review DSCR-R1-001..003, 2026-10-15).
--
-- Authoritative freshness semantics (R1-001):
--   - last_provider_confirmed_at: the provider last asserted their terms are
--     current. The public directory (filterListings) hides listings whose
--     provider confirmation is absent or older than 180 days.
--   - last_directory_reviewed_at: the directory admin last reviewed the listing.
--   - terms_as_of_date: as-of date of the currently-live terms.
-- Any transition that puts (or keeps) a listing in front of the public must
-- establish provider-confirmed freshness; otherwise the listing would be
-- published yet invisible in the default directory view.
--
-- R1-001 changes:
--   - dscr_submit_lender: new listings record last_provider_confirmed_at = now()
--     (the provider just asserted current terms).
--   - dscr_review_transition approve_submission / approve_version / reconfirm /
--     publish now set last_provider_confirmed_at = now() alongside
--     last_directory_reviewed_at.
--   - approve_version applies the staged payload's terms_as_of_date to the live
--     row, so an approved edit carries its reviewed as-of date.
--
-- R1-002 changes:
--   - dscr_lender_versions gains request_type ('term_edit' | 'removal_request'),
--     persisted as structured immutable review state at staging time.
--   - dscr_stage_version stores p_removal_requested as request_type.
--   - dscr_review_transition approve_version branches on request_type: a
--     removal_request soft-removes (status -> 'unpublished') WITHOUT applying
--     the term payload; a term_edit applies the payload as before. Both write
--     the matching audit event atomically.
--
-- R1-003 changes:
--   - New durable table dscr_lender_submission_attempts records EVERY accepted
--     submission attempt (new listings AND duplicate-NMLS claims) inside the
--     serialized transaction. The 3-per-user/24h throttle counts attempts, so
--     unlimited duplicate claims can no longer bypass it.
--   - Version-number allocation is serialized per lender with
--     pg_advisory_xact_lock('dscr_version:' || lender_id) in dscr_submit_lender
--     (both duplicate paths) and dscr_stage_version, so concurrent duplicate
--     claims or staged edits cannot collide on version_number.
--   - Lock ordering is user-lock -> lender-lock in dscr_submit_lender;
--     dscr_stage_version takes only the lender lock, so no lock cycle is
--     possible.

-- ---------------------------------------------------------------------------
-- 1. request_type on staged versions (R1-002)
-- ---------------------------------------------------------------------------
ALTER TABLE public.dscr_lender_versions
  ADD COLUMN IF NOT EXISTS request_type text NOT NULL DEFAULT 'term_edit';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'dscr_lender_versions_request_type_check'
  ) THEN
    ALTER TABLE public.dscr_lender_versions
      ADD CONSTRAINT dscr_lender_versions_request_type_check
      CHECK (request_type IN ('term_edit', 'removal_request'));
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Durable per-user submission-attempt records (R1-003)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.dscr_lender_submission_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  lender_id uuid REFERENCES public.dscr_lenders(id) ON DELETE RESTRICT,
  nmls_number text NOT NULL,
  was_duplicate boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dscr_submission_attempts_user_created
  ON public.dscr_lender_submission_attempts (user_id, created_at);

ALTER TABLE public.dscr_lender_submission_attempts ENABLE ROW LEVEL SECURITY;
-- No public policies: attempts are written/read only via the service role
-- inside dscr_submit_lender(). Direct public writes stay blocked.

-- ---------------------------------------------------------------------------
-- 3. dscr_submit_lender: attempt-counted throttle + per-lender version lock
--    (R1-001 freshness on insert, R1-003 throttle + version serialization)
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
  -- Serialize this user's submissions: the 24h attempt-count check and every
  -- write below are one atomic unit. Concurrent requests cannot both pass.
  PERFORM pg_advisory_xact_lock(hashtext('dscr_submit:' || p_user_id::text));

  -- R1-003: count ALL accepted submission attempts in the last 24 hours
  -- (new listings AND duplicate-NMLS claims), not just lender rows.
  SELECT count(*) INTO v_recent
  FROM public.dscr_lender_submission_attempts
  WHERE user_id = p_user_id
    AND created_at >= now() - interval '24 hours';
  IF v_recent >= 3 THEN
    RAISE EXCEPTION 'SUBMIT_THROTTLED' USING ERRCODE = 'P0001';
  END IF;

  SELECT id INTO v_existing_id
  FROM public.dscr_lenders
  WHERE nmls_number = p_payload ->> 'nmls_number';

  IF v_existing_id IS NOT NULL THEN
    -- Duplicate NMLS: preserve the submission as a reviewable staged version.
    -- R1-003: serialize version allocation per lender.
    PERFORM pg_advisory_xact_lock(hashtext('dscr_version:' || v_existing_id::text));
    SELECT coalesce(max(version_number), 0) + 1 INTO v_version_no
    FROM public.dscr_lender_versions WHERE lender_id = v_existing_id;
    INSERT INTO public.dscr_lender_versions
      (lender_id, version_number, payload, submitted_by, review_status, request_type)
    VALUES (v_existing_id, v_version_no, p_payload, p_user_id, 'pending', 'term_edit')
    RETURNING id INTO v_version_id;
    INSERT INTO public.dscr_lender_submission_attempts
      (user_id, lender_id, nmls_number, was_duplicate)
    VALUES (p_user_id, v_existing_id, p_payload ->> 'nmls_number', true);
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
      owner_user_id, terms_as_of_date,
      last_provider_confirmed_at
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
      (p_payload ->> 'terms_as_of_date')::date,
      -- R1-001: the provider just asserted these terms are current.
      now()
    )
    RETURNING id INTO v_lender_id;
  EXCEPTION WHEN unique_violation THEN
    -- Lost a cross-user race on the NMLS unique constraint: stage as a
    -- duplicate claim instead of failing or creating a second row.
    SELECT id INTO v_existing_id
    FROM public.dscr_lenders
    WHERE nmls_number = p_payload ->> 'nmls_number';
    -- R1-003: serialize version allocation per lender (same lock as above).
    PERFORM pg_advisory_xact_lock(hashtext('dscr_version:' || v_existing_id::text));
    SELECT coalesce(max(version_number), 0) + 1 INTO v_version_no
    FROM public.dscr_lender_versions WHERE lender_id = v_existing_id;
    INSERT INTO public.dscr_lender_versions
      (lender_id, version_number, payload, submitted_by, review_status, request_type)
    VALUES (v_existing_id, v_version_no, p_payload, p_user_id, 'pending', 'term_edit')
    RETURNING id INTO v_version_id;
    INSERT INTO public.dscr_lender_submission_attempts
      (user_id, lender_id, nmls_number, was_duplicate)
    VALUES (p_user_id, v_existing_id, p_payload ->> 'nmls_number', true);
    INSERT INTO public.dscr_lender_audit
      (lender_id, actor_user_id, action, note)
    VALUES (v_existing_id, p_user_id, 'submitted',
            'Duplicate-NMLS submission (race) preserved as staged version for admin review.');
    RETURN jsonb_build_object(
      'duplicate', true, 'lender_id', v_existing_id, 'version_id', v_version_id);
  END;

  -- R1-003: this accepted new-listing attempt counts toward the 24h throttle.
  INSERT INTO public.dscr_lender_submission_attempts
    (user_id, lender_id, nmls_number, was_duplicate)
  VALUES (p_user_id, v_lender_id, p_payload ->> 'nmls_number', false);

  INSERT INTO public.dscr_lender_audit
    (lender_id, actor_user_id, action, note)
  VALUES (v_lender_id, p_user_id, 'submitted',
          'Provider submission queued for directory review.');

  RETURN jsonb_build_object('ok', true, 'id', v_lender_id);
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. dscr_stage_version: persist request_type + serialize version allocation
--    (R1-002 structured removal state, R1-003 per-lender version lock)
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

  -- R1-003: serialize version allocation per lender so concurrent staged
  -- edits cannot collide on version_number.
  PERFORM pg_advisory_xact_lock(hashtext('dscr_version:' || p_lender_id::text));

  SELECT coalesce(max(version_number), 0) + 1 INTO v_version_no
  FROM public.dscr_lender_versions WHERE lender_id = p_lender_id;

  -- R1-002: the requested operation is structured immutable review state,
  -- not free-text audit wording.
  INSERT INTO public.dscr_lender_versions
    (lender_id, version_number, payload, submitted_by, review_status, request_type)
  VALUES (p_lender_id, v_version_no, p_payload, p_user_id, 'pending',
          CASE WHEN p_removal_requested THEN 'removal_request' ELSE 'term_edit' END)
  RETURNING id INTO v_version_id;

  v_note := CASE WHEN p_removal_requested
    THEN 'Provider requested removal; staged as removal-request version for admin review. Live listing untouched.'
    ELSE 'Provider edit staged as version for admin review. Live listing untouched.'
  END;
  INSERT INTO public.dscr_lender_audit (lender_id, actor_user_id, action, note)
  VALUES (p_lender_id, p_user_id, 'edited', v_note);

  RETURN jsonb_build_object('ok', true, 'version_id', v_version_id,
                            'version_number', v_version_no,
                            'request_type',
                            CASE WHEN p_removal_requested THEN 'removal_request' ELSE 'term_edit' END);
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. dscr_review_transition: R1-001 freshness + R1-002 removal-request branch
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
  v_request_type text;
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
        -- R1-001: approval establishes provider-confirmed freshness, otherwise
        -- the new listing would be published yet invisible in the default view.
        last_directory_reviewed_at = now(),
        last_provider_confirmed_at = now()
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
    SELECT payload, review_status, lender_id, request_type
      INTO v_payload, v_version_status, v_version_lender, v_request_type
    FROM public.dscr_lender_versions WHERE id = p_version_id FOR UPDATE;
    IF v_version_status IS NULL OR v_version_lender <> p_lender_id THEN
      RAISE EXCEPTION 'TRANSITION_NOT_FOUND: version not found for lender'
        USING ERRCODE = 'P0001';
    END IF;
    IF v_version_status <> 'pending' THEN
      RAISE EXCEPTION 'TRANSITION_INVALID: version is not pending'
        USING ERRCODE = 'P0001';
    END IF;

    IF v_request_type = 'removal_request' THEN
      -- R1-002: approving a removal request soft-removes the listing WITHOUT
      -- applying the staged term payload. The payload is intentionally ignored.
      UPDATE public.dscr_lenders
      SET status = 'unpublished',
          last_directory_reviewed_at = now()
      WHERE id = p_lender_id;
      UPDATE public.dscr_lender_versions
      SET review_status = 'approved', reviewed_by = p_actor_id, reviewed_at = now(),
          review_note = p_note
      WHERE id = p_version_id;
      INSERT INTO public.dscr_lender_audit (lender_id, actor_user_id, action, note)
      VALUES (p_lender_id, p_actor_id, 'removed',
              coalesce(p_note, 'Provider removal request approved; listing soft-removed. Staged term payload was NOT applied.'));
    ELSE
      -- term_edit: apply the staged payload, refresh the reviewed as-of date,
      -- and establish provider-confirmed freshness (R1-001).
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
        terms_as_of_date = coalesce((v_payload ->> 'terms_as_of_date')::date, terms_as_of_date),
        last_directory_reviewed_at = now(),
        last_provider_confirmed_at = now()
      WHERE id = p_lender_id;
      UPDATE public.dscr_lender_versions
      SET review_status = 'approved', reviewed_by = p_actor_id, reviewed_at = now(),
          review_note = p_note
      WHERE id = p_version_id;
      INSERT INTO public.dscr_lender_audit (lender_id, actor_user_id, action, note)
      VALUES (p_lender_id, p_actor_id, 'approved',
              coalesce(p_note, 'Staged version approved and applied to live listing.'));
    END IF;

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
    -- R1-002: rejection touches ONLY the version row; the live listing
    -- (including a removal-targeted one) is left exactly as it was.
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
    SET status = 'published',
        -- R1-001: publish asserts the listing is fit for the public view,
        -- which requires provider-confirmed freshness.
        last_directory_reviewed_at = now(),
        last_provider_confirmed_at = now()
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
    UPDATE public.dscr_lenders
    SET -- R1-001: reconfirm re-establishes BOTH freshness timestamps, so a
        -- reconfirmed listing reappears in the default directory view.
        last_directory_reviewed_at = now(),
        last_provider_confirmed_at = now()
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
-- 6. Execute grants for the new table (service role only; routes use RPCs)
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.dscr_submit_lender(uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dscr_stage_version(uuid, uuid, jsonb, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dscr_review_transition(uuid, uuid, text, text, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.dscr_submit_lender(uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.dscr_stage_version(uuid, uuid, jsonb, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.dscr_review_transition(uuid, uuid, text, text, uuid) TO service_role;
