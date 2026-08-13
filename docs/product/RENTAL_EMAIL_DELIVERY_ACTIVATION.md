# Rental email delivery activation

Email delivery is fail-closed. Deploying the code and migration does not send mail.

Before activation, approve the provider and sender domain, create one `rental_email_settings` row per landlord with `status = 'active'`, and configure `RENTAL_NOTIFICATION_DELIVERY_SECRET`, `RENTAL_EMAIL_PROVIDER_URL`, `RENTAL_EMAIL_PROVIDER_TOKEN`, `NEXT_PUBLIC_SUPABASE_URL`, and `SUPABASE_SERVICE_ROLE_KEY` only in the server environment. The provider endpoint must accept the documented JSON payload and return `{ "id": "provider-message-id" }`.

Invoke `POST /api/rental/notifications/deliver` from an authenticated scheduler using the delivery secret. Each call claims at most one eligible row. Claims use row locking, provider calls carry the notification ID as an idempotency key, and failures return to the queue with bounded exponential backoff until `max_attempts` is reached.

Tenant preferences apply only to `rent_reminder` and `balance_overdue`. Payment, lease, document, and maintenance notices are transactional and cannot be disabled through the optional-reminder preference.

Before first-tenant activation, run an approved-provider sandbox test for acceptance, delivery, bounce, complaint, duplicate scheduler calls, retry exhaustion, a tenant reminder opt-out, and paused landlord settings. Keep the owner setting paused if any check fails.
