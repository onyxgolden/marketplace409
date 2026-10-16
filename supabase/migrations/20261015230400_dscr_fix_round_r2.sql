-- DSCR fix round R2 (ChatGPT re-review DSCR-R2-001, 2026-10-16).
--
-- DSCR-R2-001: generic `publish` bypassed rejected-submission identity approval.
--   reject_submission moved pending_review -> unpublished WITHOUT confirming
--   identity, and publish accepted EVERY unpublished row, refreshing both the
--   directory-review AND provider-confirmation timestamps. Attack path:
--     pending_review -> reject_submission -> unpublished -> publish -> published
--   bypassed the required initial provider/identity approval and ownership
--   binding, and manufactured "fresh provider confirmation" from an unrelated
--   admin publish action.
--
-- Fix (fail closed at the database boundary):
--   1. `publish` now requires identity_review_status = 'identity-confirmed',
--      which is set ONLY by approve_submission. A rejected initial submission
--      (identity_review_status = 'pending') can never reach the public view
--      through publish; it must go through approve_submission. Previously
--      approved + administratively unpublished listings (identity-confirmed)
--      keep the intended republish path.
--   2. `publish` no longer sets last_provider_confirmed_at. Provider freshness
--      must come from a provider assertion (initial submission, approved staged
--      provider edit) or explicit reviewable evidence — never manufactured by
--      an admin publish action. publish refreshes last_directory_reviewed_at
--      only. A republished listing whose provider confirmation is stale stays
--      hidden from the default directory until the provider re-asserts
--      (staged edit -> approve_version).

-- ---------------------------------------------------------------------------
-- 1. dscr_review_transition: R2-001 publish identity guard + no manufactured
--    provider freshness
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
  v_identity text;
  v_payload jsonb;
  v_version_lender uuid;
  v_version_status text;
  v_request_type text;
BEGIN
  SELECT status, identity_review_status INTO v_status, v_identity
  FROM public.dscr_lenders
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
    -- R2-001: identity_review_status is deliberately NOT touched here. A
    -- rejected submission keeps identity 'pending', so publish (which now
    -- requires 'identity-confirmed') can never resurrect it.
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
    -- DSCR-R2-001: fail closed unless identity was confirmed through
    -- approve_submission. This kills the
    --   pending_review -> reject_submission -> unpublished -> publish -> published
    -- bypass: a rejected submission keeps identity_review_status = 'pending'
    -- and can never be published; it must go through approve_submission.
    IF v_identity <> 'identity-confirmed' THEN
      RAISE EXCEPTION 'TRANSITION_INVALID: publish requires identity-confirmed (rejected submissions must go through approve_submission)'
        USING ERRCODE = 'P0001';
    END IF;
    UPDATE public.dscr_lenders
    SET status = 'published',
        -- DSCR-R2-001: publish refreshes ONLY the directory-review timestamp.
        -- Provider freshness is NOT manufactured here; it comes from a
        -- provider assertion (initial submission, approved staged edit) or
        -- explicit reviewable evidence. A republished listing whose provider
        -- confirmation is stale stays hidden from the default directory until
        -- the provider re-asserts.
        last_directory_reviewed_at = now()
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
-- 2. Execute grants (CREATE OR REPLACE preserves them, re-assert for safety)
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.dscr_review_transition(uuid, uuid, text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.dscr_review_transition(uuid, uuid, text, text, uuid) TO service_role;
