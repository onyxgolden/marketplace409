\set ON_ERROR_STOP on
begin;

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values
  ('66666666-6666-4666-8666-666666666666','00000000-0000-0000-0000-000000000000','authenticated','authenticated','borrower-terms@example.test','',now(),'{"provider":"email","providers":["email"]}','{}',now(),now()),
  ('77777777-7777-4777-8777-777777777777','00000000-0000-0000-0000-000000000000','authenticated','authenticated','other-user@example.test','',now(),'{"provider":"email","providers":["email"]}','{}',now(),now());

insert into private_financing_accounts(owner_id,id,product,status,opened_date,origination_principal_cents,created_by,updated_by)
values('terms-visibility-owner','terms-visibility-account','seller_financing','active','2030-01-01',1000000,'terms-visibility-owner','terms-visibility-owner');

insert into private_financing_borrowers(owner_id,id,email,full_name,auth_user_id,created_by,updated_by)
values('terms-visibility-owner','terms-visibility-borrower','borrower-terms@example.test','Borrower Terms','66666666-6666-4666-8666-666666666666','terms-visibility-owner','terms-visibility-owner');

insert into private_financing_account_borrowers(owner_id,id,account_id,borrower_id,role,status,activated_at,created_by,updated_by)
values('terms-visibility-owner','terms-visibility-membership','terms-visibility-account','terms-visibility-borrower','primary_borrower','active',now(),'terms-visibility-owner','terms-visibility-owner');

insert into private_financing_account_terms_versions(
  owner_id,id,account_id,version_number,payment_frequency,first_payment_due_date,
  regular_scheduled_payment_amount_cents,maturity_date,allocation_policy,
  extra_payment_allocation_policy,prepayment_policy,day_count_convention,effective_date,
  acting_seller_id,created_by
)
values(
  'terms-visibility-owner','terms-visibility-terms','terms-visibility-account',1,'monthly','2030-02-01',100000,null,
  'scheduled_component_order','highest_rate_first_extra','allowed_without_penalty_does_not_advance_due_date',
  'actual_365','2030-01-01','terms-visibility-owner','terms-visibility-owner'
);

set local role authenticated;
select set_config('request.jwt.claim.sub','66666666-6666-4666-8666-666666666666',true);
do $validation$
begin
  if (select count(*) from private_financing_account_terms_versions where account_id='terms-visibility-account') <> 1 then
    raise exception 'Active borrower could not read their account terms.';
  end if;
end
$validation$;

select set_config('request.jwt.claim.sub','77777777-7777-4777-8777-777777777777',true);
do $validation$
begin
  if (select count(*) from private_financing_account_terms_versions where account_id='terms-visibility-account') <> 0 then
    raise exception 'Unrelated user could read borrower account terms.';
  end if;
end
$validation$;
reset role;

select 'PRIVATE_FINANCING_BORROWER_TERMS_VISIBILITY_PASS' as result;
rollback;

