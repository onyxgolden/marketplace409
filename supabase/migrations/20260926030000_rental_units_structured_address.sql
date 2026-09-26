-- Structured address entry for rental properties/units (UI slice J).
-- Adds nullable address columns to rental_units. Existing rows keep working:
-- all columns are nullable and the application treats a fully-blank address
-- group as "no structured address recorded" (falls back to the unit label).
-- NOT YET APPLIED — requires Jason's approval before running in any environment.

alter table if exists rental_units
  add column if not exists address_street text,
  add column if not exists address_unit text,
  add column if not exists address_city text,
  add column if not exists address_state char(2),
  add column if not exists address_zip text;
