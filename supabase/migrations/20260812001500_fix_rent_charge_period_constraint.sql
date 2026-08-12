alter table rent_charges drop constraint if exists rent_charges_period_check;
alter table rent_charges add constraint rent_charges_period_check
    check (period ~ '^[0-9]{4}-[0-9]{2}$');
