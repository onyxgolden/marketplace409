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
--   approval state: fix round 1 (2026-10-17) — ChatGPT NEEDS CHANGES on the
--     unbound pg_constraint guard (D646-001); guard now bound to
--     public.dscr_lenders / contype 'u' / exactly nmls_number via catalog
--     joins. Re-review requested at the new exact head.

DO $$
DECLARE
  v_conname text := 'uq_dscr_lenders_nmls';
BEGIN
  -- 1. A unique constraint on exactly nmls_number already in place (under any
  --    name)? Nothing to do. The guard is bound to the relation, constraint
  --    kind, and column: constraint names are not globally unique, so a
  --    same-named constraint on an unrelated table (or on different columns)
  --    must not suppress this one. Catalog joins (not a regclass cast) keep
  --    the guard safe if the table is absent.
  IF EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE c.contype = 'u'
      AND n.nspname = 'public'
      AND t.relname = 'dscr_lenders'
      AND array_length(c.conkey, 1) = 1
      AND (SELECT a.attname
           FROM pg_attribute a
           WHERE a.attrelid = t.oid
             AND a.attnum = c.conkey[1]) = 'nmls_number'
  ) THEN
    RETURN;
  END IF;

  -- 2. The backing unique index name must be schema-unique. If an unrelated
  --    object already owns our preferred name, let PostgreSQL choose a
  --    collision-safe generated name (D646-002): PG's generated constraint
  --    names (dscr_lenders_nmls_number_key, suffixed _1/_2 as needed) are
  --    guaranteed unique within the schema — a second fixed fallback name can
  --    still collide. The seed's ON CONFLICT (nmls_number) uses index
  --    inference, so the physical name is immaterial.
  IF EXISTS (
    SELECT 1 FROM pg_class
    WHERE relname = v_conname
      AND relnamespace = 'public'::regnamespace
  ) THEN
    ALTER TABLE public.dscr_lenders ADD UNIQUE (nmls_number);
  ELSE
    EXECUTE format(
      'ALTER TABLE public.dscr_lenders ADD CONSTRAINT %I UNIQUE (nmls_number)',
      v_conname
    );
  END IF;
END $$;
