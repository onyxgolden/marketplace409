-- Durable backstop for the DSCR lender seed's ON CONFLICT (nmls_number).
--
-- The seed migration 20261015230100 now creates uq_dscr_lenders_nmls itself
-- (guarded), but databases that already applied the seed before that
-- correction still need the constraint if it was never created. This
-- migration is a no-op wherever the constraint already exists (including
-- production, which received it manually).
--
-- Migration dependency receipt:
--   migration: 20261016233000_dscr_lenders_nmls_unique.sql
--   column dependencies: public.dscr_lenders(nmls_number) — text NOT NULL,
--     created by 20261015230000_dscr_lender_directory.sql
--   deployment order: after 20261015230400 (latest); safe to apply any time —
--     guarded DO block, no data writes, no seed interaction
--   approval state: pending review (filed for ChatGPT; local Qwen/Gemma review
--     under 2026-10-16 solo operating mode)

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_dscr_lenders_nmls'
  ) THEN
    ALTER TABLE public.dscr_lenders
      ADD CONSTRAINT uq_dscr_lenders_nmls UNIQUE (nmls_number);
  END IF;
END $$;
