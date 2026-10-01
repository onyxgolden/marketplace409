-- Atomic save of custom field values (Rentec parity R15 fix) — AUTHORED, NOT APPLIED. Jason applies migrations.
--
-- Finding: custom-field-value POST was described as all-or-nothing but issued
-- a DELETE for cleared optional values and a separate UPSERT for the rest. If
-- the delete succeeded and the upsert failed, the request 500ed after
-- permanently clearing the old optional values.
--
-- save_rental_custom_field_values() performs the delete and the insert inside
-- a single database function call, which Postgres executes atomically
-- (all-or-nothing). The API route validates every value against its field
-- definition first; the function additionally refuses any field_id that is
-- not one of the caller's own definitions (defense in depth).
--
-- Additive only: no existing table or function is changed.

create or replace function save_rental_custom_field_values(
  p_owner_id text,
  p_record_id text,
  p_rows jsonb
)
returns void
language plpgsql
security invoker
as $$
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Values must be a JSON array.' using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_rows) as elem
    where not exists (
      select 1
      from rental_custom_fields f
      where f.owner_id = p_owner_id
        and f.id = elem ->> 'field_id'
    )
  ) then
    raise exception 'One of the fields is not valid for this record.' using errcode = 'P0001';
  end if;

  delete from rental_custom_field_values v
  where v.owner_id = p_owner_id
    and v.record_id = p_record_id
    and v.field_id in (
      select elem ->> 'field_id'
      from jsonb_array_elements(p_rows) as elem
    );

  insert into rental_custom_field_values (owner_id, field_id, record_id, value_text)
  select p_owner_id, elem ->> 'field_id', p_record_id, elem ->> 'value_text'
  from jsonb_array_elements(p_rows) as elem
  where elem ->> 'value_text' is not null;
end;
$$;

revoke all on function save_rental_custom_field_values(text, text, jsonb) from anon, authenticated;
grant execute on function save_rental_custom_field_values(text, text, jsonb) to authenticated;
