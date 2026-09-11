# PostHog privacy-safe analytics integration

Status: code foundation only; disabled; no production configuration; no deployment.

## Purpose and boundary

PostHog may receive a small, enumerated set of product-usage signals after an
explicit user opt-in. It must never receive tenant, borrower, financial,
payment, lease, property-address, authentication, health, or other personal
content. PostHog is not an operational system of record.

This slice deliberately provides no consent user interface and sets no
environment variables. Consequently, it cannot transmit an event in any
environment as committed. Production enablement requires a separate privacy
review, approved consent UI, approved public browser key, and deployment
authorization.

## Fail-closed controls

1. Analytics requires all of: an explicit build-time enable flag, an explicit
   kill-switch release, an approved PostHog ingestion host, a syntactically
   valid public browser key, and stored user consent.
2. No PostHog SDK or DOM recorder is present. Autocapture, automatic page
   views, page-leave capture, exception capture, surveys, feature flags, person
   profiles, and session recording are structurally unavailable.
3. Session recording is hard-disabled in code. No text, input, DOM, image, or
   page content is read. A future recording proposal requires a separately
   reviewed code and consent change.
4. The capture boundary rejects every event except the five named events below
   and never accepts URLs, paths, query strings, titles, DOM content, error
   messages, stacks, amounts, or arbitrary properties.
5. Analytics keeps only a random in-memory session pseudonym. The separate consent decision contains
   only the word `granted` and no identity or product data.
6. Raw internal user and workspace IDs must be transformed into deterministic,
   scope-separated SHA-256 pseudonyms before attachment to an approved event.
   PostHog `identify` and group-identification events are not used. Every API
   payload sets `$process_person_profile=false`. Names, email
   addresses, phone numbers, or business names are prohibited.

## Minimal taxonomy

| Event | Approved properties | Purpose |
| --- | --- | --- |
| `forge_navigation` | `surface`, `destination`, optional pseudonymous scopes | Coarse module navigation; never a URL or record path |
| `forge_onboarding_completed` | `surface`, `onboarding`, `outcome`, optional pseudonymous scopes | Onboarding completion or blockage |
| `forge_workflow_completed` | `surface`, `workflow`, `outcome`, optional pseudonymous scopes | Completion of an approved business workflow |
| `forge_error_observed` | `surface`, `error_code`, optional pseudonymous scopes | Enumerated client error category; never message or stack |
| `forge_feature_used` | `surface`, `feature`, `action`, optional pseudonymous scopes | Explicitly instrumented feature usage |

All property values are code-enumerated in `src/lib/analytics/policy.js`.
Adding an event, property, or value requires code review and tests. Arbitrary
strings and numbers are never accepted because they could contain personal or
financial data.

## Environment variables

No values are added by this pull request.

| Variable | Activation value | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_FORGE_ANALYTICS_ENABLED` | `true` | Defaults disabled |
| `NEXT_PUBLIC_FORGE_ANALYTICS_KILL_SWITCH` | `false` | Any missing or different value blocks analytics |
| `NEXT_PUBLIC_POSTHOG_KEY` | Public `phc_...` browser key | Public ingestion key only; never a personal API key |
| `NEXT_PUBLIC_POSTHOG_HOST` | `https://us.i.posthog.com` | Only U.S. and E.U. ingestion hosts are accepted |

These variables are public browser configuration, not GitHub Actions secrets.
They must not include PostHog personal API keys or any server credential.

## Consent lifecycle

- Default: denied; the SDK is not imported or initialized.
- Grant: a future reviewed consent UI may call `grantAnalyticsConsent`, then
  initialize analytics on the next page load.
- Revoke: the UI must call `revokeAnalyticsConsent` and
  `resetAnalyticsSubject`; collection stops on reload. A production proposal
  should also provide an immediate SDK opt-out before activation.
- Sign-out: the authentication flow must call `resetAnalyticsSubject` before
  analytics identification is enabled in a future slice.

## Retention and vendor review gates

Before production activation:

1. Add PostHog to the public Privacy Policy and vendor inventory.
2. Record the approved U.S. project, data-processing terms, incident contacts,
   subprocessors, and a short retention period appropriate for coarse product
   events.
3. Configure PostHog project settings so autocapture and recordings remain off.
4. Verify with browser network inspection that no request occurs before consent
   and that emitted payloads contain only the approved taxonomy.
5. Complete user deletion/export mapping for analytics pseudonyms.
6. Obtain explicit owner approval for environment configuration and deployment.

The transport uses PostHog's documented public single-event capture endpoint:
https://posthog.com/docs/api/capture#single-event

## Kill procedure

Set `NEXT_PUBLIC_FORGE_ANALYTICS_KILL_SWITCH=true` (or remove the release value)
and deploy the configuration change. Because Next.js public variables are
embedded at build time, changing the hosted value without a new deployment is
not sufficient. PostHog-side project disablement is an additional emergency
control, not a replacement for the application kill switch.
