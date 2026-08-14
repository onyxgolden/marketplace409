alter table rental_email_settings drop constraint if exists rental_email_settings_provider_check;
alter table rental_email_settings alter column provider set default 'resend';
alter table rental_email_settings add constraint rental_email_settings_provider_check check(provider in ('http','resend'));
