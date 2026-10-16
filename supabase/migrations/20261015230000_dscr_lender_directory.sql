-- DSCR loan provider directory: listings, moderation lifecycle, audit trail.
-- FORGE is a directory, not a lender. No origination, no underwriting, no rate quotes.

-- Main listings table. status: draft | pending_review | published | unpublished
CREATE TABLE IF NOT EXISTS public.dscr_lenders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name text NOT NULL,
  nmls_number text NOT NULL,
  nmls_consumer_access_url text NOT NULL,
  identity_review_status text NOT NULL DEFAULT 'unverified'
    CHECK (identity_review_status IN ('pending', 'identity-confirmed', 'unverified')),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'pending_review', 'published', 'unpublished')),

  -- Provider-claimed terms (every card labels these as provider-claimed)
  states_served text[] NOT NULL DEFAULT '{}',
  min_loan_amount numeric,
  max_loan_amount numeric,
  property_types text[] NOT NULL DEFAULT '{}',
  transaction_types text[] NOT NULL DEFAULT '{}',
  occupancy_entity_restrictions text,
  max_ltv numeric,
  min_credit_score_claim integer,
  prepayment_penalty_availability text,
  min_dscr_accepted numeric,
  contact_name text,
  contact_phone text,
  contact_email text,
  application_url text,

  -- Freshness (DSCR-SCOPE-002/004)
  terms_as_of_date date,
  last_directory_reviewed_at timestamptz,
  last_provider_confirmed_at timestamptz,

  -- Ownership / provenance
  owner_user_id uuid REFERENCES auth.users(id),
  public_source_url text,
  public_source_retrieved_at date,
  seed_receipt text,

  -- Abuse reporting
  abuse_report_count integer NOT NULL DEFAULT 0,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Staged edits: provider changes never silently replace the live version.
CREATE TABLE IF NOT EXISTS public.dscr_lender_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lender_id uuid NOT NULL REFERENCES public.dscr_lenders(id) ON DELETE CASCADE,
  version_number integer NOT NULL,
  payload jsonb NOT NULL,
  submitted_by uuid REFERENCES auth.users(id),
  review_status text NOT NULL DEFAULT 'pending'
    CHECK (review_status IN ('pending', 'approved', 'rejected')),
  reviewed_by uuid REFERENCES auth.users(id),
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (lender_id, version_number)
);

-- Append-only moderation audit (DSCR-SCOPE-003)
CREATE TABLE IF NOT EXISTS public.dscr_lender_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lender_id uuid NOT NULL REFERENCES public.dscr_lenders(id) ON DELETE CASCADE,
  actor_user_id uuid REFERENCES auth.users(id),
  action text NOT NULL
    CHECK (action IN ('submitted', 'approved', 'rejected', 'published', 'unpublished', 'edited', 'removed', 'reconfirmed', 'abuse_reported')),
  diff jsonb,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Abuse reports from users (one row per report)
CREATE TABLE IF NOT EXISTS public.dscr_lender_abuse_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lender_id uuid NOT NULL REFERENCES public.dscr_lenders(id) ON DELETE CASCADE,
  reporter_user_id uuid REFERENCES auth.users(id),
  reason text NOT NULL,
  details text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_dscr_lenders_status ON public.dscr_lenders(status);
CREATE INDEX IF NOT EXISTS idx_dscr_lenders_nmls ON public.dscr_lenders(nmls_number);
CREATE INDEX IF NOT EXISTS idx_dscr_lender_versions_lender ON public.dscr_lender_versions(lender_id);
CREATE INDEX IF NOT EXISTS idx_dscr_lender_audit_lender ON public.dscr_lender_audit(lender_id);

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.dscr_lenders_touch_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_dscr_lenders_touch ON public.dscr_lenders;
CREATE TRIGGER trg_dscr_lenders_touch
  BEFORE UPDATE ON public.dscr_lenders
  FOR EACH ROW EXECUTE FUNCTION public.dscr_lenders_touch_updated_at();

-- RLS: public read of published listings only; writes via service role / admin.
ALTER TABLE public.dscr_lenders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dscr_lender_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dscr_lender_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dscr_lender_abuse_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dscr_lenders_public_read ON public.dscr_lenders;
CREATE POLICY dscr_lenders_public_read ON public.dscr_lenders
  FOR SELECT USING (status = 'published');

-- No public insert/update/delete; API routes use the service role with auth checks.
