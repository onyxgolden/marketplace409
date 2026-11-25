# Rental email delivery activation

Email delivery is fail-closed. Deploying the code and migration does not send mail.

Before activation, approve the provider and sender domain, create one `rental_email_settings` row per landlord with `status = 'active'`, and configure `RENTAL_NOTIFICATION_DELIVERY_SECRET`, `RENTAL_EMAIL_PROVIDER_URL`, `RENTAL_EMAIL_PROVIDER_TOKEN`, `NEXT_PUBLIC_SUPABASE_URL`, and `SUPABASE_SERVICE_ROLE_KEY` only in the server environment. The provider endpoint must accept the documented JSON payload and return `{ "id": "provider-message-id" }`.

Invoke `GET /api/rental/notifications/deliver` from the Vercel cron, which sends `CRON_SECRET` as a bearer token — Vercel Cron triggers its configured paths with GET, so POST would answer Method Not Allowed and leave queued rows undelivered. A manual authenticated scheduler may instead invoke `POST` with the delivery secret (`RENTAL_NOTIFICATION_DELIVERY_SECRET`); both methods share the same handler and the route accepts either secret. The Vercel cron runs it daily at 15:00 UTC (`vercel.json`); without that schedule nothing ever invokes it, which is how trigger-queued payment receipts sat unattempted for weeks in Oct–Nov 2026. Each call claims and delivers eligible rows, up to 10 per invocation. Claims use row locking, provider calls carry the notification ID as an idempotency key, and failures return to the queue with bounded exponential backoff until `max_attempts` is reached.

Tenant preferences apply only to `rent_reminder` and `balance_overdue`. Payment, lease, document, and maintenance notices are transactional and cannot be disabled through the optional-reminder preference.

Before first-tenant activation, run an approved-provider sandbox test for acceptance, delivery, bounce, complaint, duplicate scheduler calls, retry exhaustion, a tenant reminder opt-out, and paused landlord settings. Keep the owner setting paused if any check fails.
