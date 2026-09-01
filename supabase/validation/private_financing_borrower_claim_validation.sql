\set ON_ERROR_STOP on
begin;

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('55555555-5555-4555-8555-555555555555','00000000-0000-0000-0000-000000000000','authenticated','authenticated','gabby-claim-validation@example.test','',now(),'{"provider":"email","providers":["email"]}','{}',now(),now());

insert into private_financing_accounts(owner_id,id,product,status,opened_date,origination_principal_cents,created_by,updated_by)
values('claim-validation-owner','claim-validation-account','seller_financing','active','2030-01-01',1000000,'claim-validation-owner','claim-validation-owner');
insert into private_financing_borrowers(owner_id,id,email,full_name,created_by,updated_by)
values('claim-validation-owner','claim-validation-borrower',' GABBY-CLAIM-VALIDATION@EXAMPLE.TEST ','Gabby Validation','claim-validation-owner','claim-validation-owner');
insert into private_financing_account_borrowers(owner_id,id,account_id,borrower_id,role,status,created_by,updated_by)
values('claim-validation-owner','claim-validation-membership','claim-validation-account','claim-validation-borrower','co_borrower','invited','claim-validation-owner','claim-validation-owner');

set local role authenticated;
select set_config('request.jwt.claim.sub','55555555-5555-4555-8555-555555555555',true);
select claim_private_financing_borrower_portal();
select claim_private_financing_borrower_portal();
reset role;

do $validation$
begin
  if not exists(select 1 from private_financing_borrowers where id='claim-validation-borrower' and auth_user_id='55555555-5555-4555-8555-555555555555') then
    raise exception 'Normalized borrower identity was not claimed.';
  end if;
  if not exists(select 1 from private_financing_account_borrowers where id='claim-validation-membership' and status='active' and activated_at is not null) then
    raise exception 'Invited borrower membership was not activated.';
  end if;
end
$validation$;

select 'PRIVATE_FINANCING_BORROWER_CLAIM_VALIDATION_PASS' as result,
  (select status from private_financing_account_borrowers where id='claim-validation-membership') as membership_status;
rollback;
