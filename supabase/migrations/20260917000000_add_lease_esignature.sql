-- Closes the e-signature gap on lease preparation versions. `rental_lease_preparations`/
-- `rental_lease_preparation_versions` (20260813002700) already let an owner draft, version, and
-- approve lease terms for tenant review -- but nothing captures a tenant actually signing. That
-- migration's own test asserts this deliberately: "keeps approval owner controlled and distinct
-- from signature" (`expect(sql).not.toContain("signed_at")`). This migration adds the signature
-- step, at zero external cost: no e-signature vendor, built on the same self-attested,
-- server-stamped consent pattern already proven for autopay authorization
-- (`request_rental_autopay_enrollment`'s `consent_text`/`consented_at`).
--
-- Legal basis (US ESIGN Act / UETA): an electronic signature is valid given (1) intent to sign,
-- (2) consent to conduct the transaction electronically, (3) the signature associated with the
-- record, and (4) durable, accurate retention. This satisfies all four: an explicit typed name plus
-- a required acknowledgement checkbox (enforced client-side and by a minimum-length signer-name
-- check here) is intent+consent; the foreign key to the exact (preparation_id, version_number)
-- being signed is association; this table, insert-only in practice (no update/delete policy is
-- granted to anyone), is retention. No owner signature is captured here -- approving a version
-- (`approve_rental_lease_preparation_version`) already is the owner's own authenticated execution
-- of those terms; only the tenant side needed a new step.
--
-- One signature per (preparation, version, tenant): if the owner later saves a new lease
-- preparation version, `save_rental_lease_preparation_version` already resets
-- `approved_version = null`, so a prior signature -- tied to the specific version_number it was
-- given for -- simply stops counting toward "fully executed" the moment a new version is approved.
-- No explicit invalidation is needed; the version bump does that structurally, the same way a real
-- lease amendment requires fresh signatures rather than silently reusing an old one.
create table if not exists rental_lease_signatures (
  owner_id text not null,
  id text not null,
  lease_id text not null,
  preparation_id text not null,
  version_number integer not null check (version_number > 0),
  tenant_id text not null,
  signer_name text not null check (btrim(signer_name) <> ''),
  signature_statement text not null check (btrim(signature_statement) <> ''),
  ip_address text,
  user_agent text,
  signed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  primary key (owner_id, id),
  unique (owner_id, preparation_id, version_number, tenant_id),
  foreign key (owner_id, lease_id) references rental_leases (owner_id, id) on delete restrict,
  foreign key (owner_id, preparation_id) references rental_lease_preparations (owner_id, id) on delete restrict,
  foreign key (owner_id, tenant_id) references rental_tenants (owner_id, id) on delete restrict
);

create index if not exists idx_rental_lease_signatures_owner_lease
  on rental_lease_signatures (owner_id, lease_id);
create index if not exists idx_rental_lease_signatures_preparation_version
  on rental_lease_signatures (owner_id, preparation_id, version_number);

alter table rental_lease_signatures enable row level security;
alter table rental_lease_signatures force row level security;

-- Read-only for everyone at the RLS layer -- every write happens through the security-definer RPC
-- below, which derives owner_id/tenant_id itself and never trusts a client-supplied value for
-- either. No insert/update/delete policy is granted to any role.
create policy "rental_lease_signatures_owner_select"
  on rental_lease_signatures for select to authenticated
  using (has_workspace_access(owner_id));

-- Any tenant on the lease can see every signature on it (not only their own) -- ordinary
-- co-signer transparency (seeing "who else has signed"), the same visibility a commercial
-- e-signature tool would show, and it reveals nothing about a co-tenant beyond their own name and
-- signing time, which a co-tenant already knows.
create policy "rental_lease_signatures_tenant_select"
  on rental_lease_signatures for select to authenticated
  using (rental_actor_has_lease_access(owner_id, lease_id));

-- RLS restricts which rows a role sees; it does not substitute for the underlying table grant
-- Postgres itself requires before a role may attempt the select at all.
grant select on table rental_lease_signatures to authenticated;

create or replace function sign_rental_lease_preparation_version(
  p_lease_id text,
  p_preparation_id text,
  p_version_number integer,
  p_signer_name text,
  p_ip_address text,
  p_user_agent text
)
returns jsonb
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  authenticated_user_id uuid := auth.uid();
  tenant_record rental_tenants%rowtype;
  prep_record rental_lease_preparations%rowtype;
  result rental_lease_signatures%rowtype;
  total_tenants integer;
  signed_tenants integer;
begin
  if authenticated_user_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  select * into tenant_record from rental_tenants where auth_user_id = authenticated_user_id;
  if tenant_record.id is null then
    raise exception 'No tenant portal access is linked to this account.' using errcode = '42501';
  end if;
  if not rental_actor_has_lease_access(tenant_record.owner_id, p_lease_id) then
    raise exception 'Active tenant lease access is required.' using errcode = '42501';
  end if;

  select * into prep_record
    from rental_lease_preparations
   where owner_id = tenant_record.owner_id and id = p_preparation_id and lease_id = p_lease_id
   for update;
  if prep_record.id is null then
    raise exception 'Lease preparation was not found.' using errcode = 'P0002';
  end if;
  if prep_record.status <> 'approved' or prep_record.approved_version is distinct from p_version_number then
    raise exception 'Only the currently approved lease version can be signed.' using errcode = '22023';
  end if;

  if length(btrim(coalesce(p_signer_name, ''))) < 2 then
    raise exception 'A typed legal name is required to sign.' using errcode = '22023';
  end if;

  insert into rental_lease_signatures (
    owner_id, id, lease_id, preparation_id, version_number, tenant_id,
    signer_name, signature_statement, ip_address, user_agent, signed_at
  ) values (
    tenant_record.owner_id,
    'rental_lease_signature_' || gen_random_uuid()::text,
    p_lease_id, p_preparation_id, p_version_number, tenant_record.id,
    btrim(p_signer_name),
    'By typing my name above, I am signing this lease electronically. I understand this carries '
      || 'the same legal effect as a handwritten signature, I have reviewed Lease Preparation '
      || 'Version ' || p_version_number || ' in full, and I consent to conduct this transaction '
      || 'electronically.',
    nullif(btrim(p_ip_address), ''), nullif(btrim(p_user_agent), ''), now()
  )
  -- Idempotent: signing the same already-signed version again is a no-op, never a second row and
  -- never an error -- a tenant re-submitting after a network hiccup gets their original signature
  -- back, not a confusing failure.
  on conflict (owner_id, preparation_id, version_number, tenant_id) do nothing
  returning * into result;

  if result.id is null then
    select * into result from rental_lease_signatures
     where owner_id = tenant_record.owner_id and preparation_id = p_preparation_id
       and version_number = p_version_number and tenant_id = tenant_record.id;
  end if;

  select count(*) into total_tenants
    from rental_lease_tenants where owner_id = tenant_record.owner_id and lease_id = p_lease_id;
  select count(*) into signed_tenants
    from rental_lease_signatures
   where owner_id = tenant_record.owner_id and preparation_id = p_preparation_id
     and version_number = p_version_number;

  return jsonb_build_object(
    'signatureId', result.id,
    'leaseId', p_lease_id,
    'preparationId', p_preparation_id,
    'versionNumber', p_version_number,
    'signerName', result.signer_name,
    'signedAt', result.signed_at,
    'fullyExecuted', signed_tenants >= total_tenants
  );
end;
$$;

revoke all on function sign_rental_lease_preparation_version(text, text, integer, text, text, text)
  from public, anon;
grant execute on function sign_rental_lease_preparation_version(text, text, integer, text, text, text)
  to authenticated;
