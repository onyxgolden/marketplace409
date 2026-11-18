// FORGE External Accounts Register — idempotent seed `external_accounts_seed_v1`.
//
// Sources (see the module footer for the full provenance note):
//   (a) the seed spreadsheet (36 rows, reconstructed inventory —
//       `~/workspace/user/files/FORGE_409_Accounts_Register_20_jhlt.xlsx`);
//   (b) the scope brief's §4 candidate families;
//   (c) the Gmail cross-check (`~/workspace/accounts-register/
//       gmail-crosscheck-2026-11-17.md`, 620 messages, 219 signup mail,
//       mailbox jasonmorgan99@gmail.com only).
//
// HONESTY RULES (brief §4 + the build brief — the seed is the place
// they are enforced, not just documented):
//   - An account email is set ONLY where Gmail proves a mail was
//     addressed to jasonmorgan99@gmail.com for that provider, or where
//     the account IS that mailbox (Gmail/Google). Never invented.
//   - No fee, billing, plan, or integration status is ever invented:
//     unknown stays unknown; a trial that ended stays a trial.
//   - Gmail findings are review-queue leads, never auto-confirmations:
//     a welcome mail proves an account exists, not that setup is
//     complete — setup_status stays in_progress where completion is
//     unproven (Namecheap contact verification, Resend sending domain).
//   - "Confirmed used" does not prove a registration (brief Read Me).
//   - Local tools/daemons are local_tool, never accounts.
//   - No secrets anywhere in this file: no passwords, keys, tokens,
//     or credential URLs. Credential location is always null here —
//     the owner fills locators in by hand after seeding.
//   - MIT-created apps are NOT seeded: zero evidence in this mailbox
//     (open recovery gap, see EXTERNAL_ACCOUNT_SEED_EXCLUSIONS).
//   - Pure entertainment/loyalty accounts found by the cross-check
//     are deliberately excluded (listed at the foot of this file).
//
// The seed never overwrites owner-edited values: seed_apply inserts
// missing rows only. Rerun is a no-op for rows that already exist.

import {
  EXTERNAL_ACCOUNT_SEED_VERSION,
  seedKeyForSlug,
} from "./externalAccountValidation";

export { EXTERNAL_ACCOUNT_SEED_VERSION };

// The only account email this seed ever asserts: Gmail proved a mail
// was addressed to it for that provider. Every other row has null.
const GMAIL = "jasonmorgan99@gmail.com";

function candidate(slug, providerName, purpose, associatedApp, over = {}) {
  return {
    seed_key: seedKeyForSlug(slug),
    provider_slug: slug,
    provider_name: providerName,
    purpose,
    associated_app: associatedApp,
    work_thread_label: null,
    account_email: null,
    plan_status: "unknown",
    billing_arrangement: null,
    api_integration_status: "unknown",
    still_needed: null,
    credential_location: null,
    record_status: "unverified_lead",
    setup_status: "unknown",
    source_kind: "reconstructed_inventory",
    source_reference: null,
    notes: null,
    ...over,
  };
}

// ---------------------------------------------------------------------------
// (a) Spreadsheet rows (36) — "Account Inventory" sheet, in sheet order.
// Status mapping: "Confirmed active" / "Account confirmed" ->
// confirmed_account; "Confirmed used" -> confirmed_account ONLY where a
// login demonstrably exists (ChatGPT/Claude/Muse — see notes), otherwise
// the row's own caveat governs; "Discussed" / "Evaluated" / "Mentioned"
// -> evaluating_service; "Implemented locally" -> local_tool.
// ---------------------------------------------------------------------------
const SPREADSHEET_ROWS = [
  candidate("github", "GitHub", "Development / source control", "FORGE", {
    record_status: "confirmed_account", setup_status: "ready",
    api_integration_status: "integrated", still_needed: true,
    source_reference: "spreadsheet row: GitHub — Confirmed active",
    notes: "Repositories and Actions; onyxgolden/marketplace409; onyxgolden/forge-ai-drop. No signup mail in this mailbox (1 Copilot mail only) — the account is proven by live use, not by Gmail.",
  }),
  candidate("vercel", "Vercel", "Hosting and deployments", "FORGE", {
    record_status: "confirmed_account", setup_status: "ready",
    api_integration_status: "integrated", still_needed: true,
    source_reference: "spreadsheet row: Vercel — Confirmed active",
    notes: "jason-morgan-s-projects/marketplace409. Zero signup mail in this mailbox — the account is proven by live deploys, not by Gmail.",
  }),
  candidate("supabase", "Supabase", "Database, authentication, storage", "FORGE", {
    account_email: GMAIL, record_status: "confirmed_account", setup_status: "ready",
    api_integration_status: "integrated", still_needed: true,
    source_kind: "email_crosscheck",
    source_reference: "gmail-crosscheck: Confirm your email and launch your projects on Supabase! (2026-05-27); Welcome to Supabase (2026-05-28)",
    notes: "Production migrations and auth; project bzqvenxjlstinmgbuvvg.",
  }),
  candidate("stripe", "Stripe", "Payments, ACH, sandbox", "Rental Manager", {
    account_email: GMAIL, record_status: "confirmed_account", setup_status: "ready",
    api_integration_status: "integrated", still_needed: true,
    source_kind: "email_crosscheck",
    source_reference: "gmail-crosscheck: Verify your email (2026-08-12); Activate your Stripe account (2026-08-17 and 2026-08-19)",
    notes: "409 Marketplace LLC test-mode sandbox; live payment activity. Activation reminders arrived twice, but live payments prove activation completed.",
  }),
  candidate("plaid", "Plaid", "Bank account linking", "Financial FORGE", {
    account_email: GMAIL, record_status: "confirmed_account", setup_status: "ready",
    api_integration_status: "integrated", still_needed: true,
    source_kind: "email_crosscheck",
    source_reference: "gmail-crosscheck: Welcome to Plaid (2026-07-02)",
    notes: "Sandbox and Link work; production access details unverified.",
  }),
  candidate("google-cloud", "Google Cloud / Cloud Vision", "Document/image processing", "FORGE", {
    account_email: GMAIL, record_status: "confirmed_account", setup_status: "blocked",
    plan_status: "trial", still_needed: true,
    source_kind: "email_crosscheck",
    source_reference: "gmail-crosscheck: Welcome to your Google Cloud Free Trial (2026-08-08); Action Needed: Upgrade to paid Google Cloud account (2026-11-07 — trial ended)",
    notes: "Free trial Aug 8 – Nov 7, 2026, now ENDED. Anything built in the trial is at risk without an upgrade decision. Confirm account and billing project.",
  }),
  candidate("fidelity", "Fidelity Investments", "Financial account connection", "Financial FORGE", {
    account_email: GMAIL, record_status: "confirmed_account", setup_status: "ready",
    api_integration_status: "not_integrated", still_needed: true,
    source_kind: "email_crosscheck",
    source_reference: "gmail-crosscheck: Your account application is almost done (2018-01-26); eDocuments account record updates (2024–2025)",
    notes: "Household emergency-fund money market. Stripe Financial Connections cannot connect to Fidelity, so its legs never appear in FORGE data — resolve one-sided.",
  }),
  candidate("yahoo-mail", "Yahoo Mail", "Email delivery testing", "FORGE", {
    record_status: "no_account_required",
    source_reference: "spreadsheet row: Yahoo Mail — Used/tested; signup unverified",
    notes: "No Jason Yahoo account — deliverability testing only. Mail seen is forwards from Brandy's Yahoo (bjemorgan@yahoo.com) and XP Property Management's Yahoo.",
  }),
  candidate("microsoft-partner-center", "Microsoft / Partner Center", "Windows Store publishing", "Capture", {
    record_status: "evaluating_service", setup_status: "not_started",
    source_reference: "spreadsheet row: Microsoft / Partner Center — Discussed; signup unverified",
    notes: "Developer registration not confirmed. Only consumer mail found (Home Use Program 2019; OneDrive welcome Jul 11, 2026; Cashback Jul 2026) — not a developer registration.",
  }),
  candidate("rentec-direct", "Rentec Direct", "Rental management data import", "Rental Manager", {
    record_status: "confirmed_account", setup_status: "ready", still_needed: true,
    source_reference: "spreadsheet row: Rentec Direct — Existing data; signup unverified",
    notes: "Legacy system of record; property and transaction data imported. Signup/owner email unverified — no registration mail under this Gmail.",
  }),
  candidate("quickbooks", "QuickBooks", "Accounting import/export", "Financial FORGE", {
    account_email: GMAIL, record_status: "unverified_lead",
    source_kind: "email_crosscheck",
    source_reference: "gmail-crosscheck: Intuit.com account verification-code mails (2022); A passkey was added to your Intuit Account (2025-11-25 — account still active)",
    notes: "Intuit account active (passkey Nov 25, 2025); QuickBooks-specific signup not isolated from the Intuit-wide account. Verify whether QuickBooks itself was ever opened.",
  }),
  candidate("quicken-simplifi", "Quicken Simplifi", "Transaction CSV import", "Financial FORGE", {
    record_status: "evaluating_service", setup_status: "not_started",
    api_integration_status: "not_integrated",
    source_reference: "spreadsheet row: Quicken Simplifi — Discussed; signup unverified",
    notes: "CSV importer developed. No Gmail mail from quicken.com or simplifimoney.com.",
  }),
  candidate("openai-chatgpt", "OpenAI / ChatGPT", "Architecture and code review", "All apps", {
    record_status: "confirmed_account", setup_status: "ready", still_needed: true,
    source_reference: "spreadsheet row: OpenAI / ChatGPT — Confirmed used",
    notes: "Chat login used daily (AI-team think tank). Separate API registration not established — do not conflate the chat login with an API account. No openai.com mail in this mailbox.",
  }),
  candidate("anthropic-claude", "Anthropic / Claude", "Implementation and coding", "FORGE", {
    account_email: GMAIL, record_status: "confirmed_account", setup_status: "ready",
    still_needed: true,
    source_kind: "email_crosscheck",
    source_reference: "gmail-crosscheck: Welcome to Claude. Let's get you set up. (2026-07-31); Welcome to Claude Code (2026-08-11)",
    notes: "API account not established (per spreadsheet); the Claude/Claude Code login is the confirmed account. No mail from anthropic.com itself.",
  }),
  candidate("muse", "Muse / Meta AI", "Implementation agent", "FORGE", {
    record_status: "confirmed_account", setup_status: "ready", still_needed: true,
    source_reference: "spreadsheet row: Muse / Meta AI — Confirmed used",
    notes: "Implementation agent (this system). Account/signup particulars unverified; subscription/plan details unverified. No mail from muse.ai or metal.ai.",
  }),
  candidate("xai-grok", "xAI / Grok", "Independent review and research", "FORGE", {
    account_email: GMAIL, record_status: "closed", setup_status: "retired",
    plan_status: "paid", still_needed: false,
    source_kind: "email_crosscheck",
    source_reference: "gmail-crosscheck: Welcome to The X Subscription (2026-10-20, from noreply@x.ai)",
    notes: "Grok Plus subscription TERMINATED Nov 3, 2026; access ends Nov 20, 2026. Access was via the X (Twitter) subscription, which bundles Grok — no separate xAI API-key mail found.",
  }),
  candidate("openvoice-v2", "OpenVoice V2", "Local narration", "Capture", {
    record_status: "local_tool", setup_status: "ready",
    plan_status: "not_applicable", api_integration_status: "integrated", still_needed: true,
    source_reference: "spreadsheet row: OpenVoice V2 — Implemented locally; no signup needed",
    notes: "Local narration synthesis for Capture PPTX-to-video; no signup needed.",
  }),
  candidate("whisper", "Whisper", "Local transcription", "Capture", {
    record_status: "local_tool", setup_status: "ready",
    plan_status: "not_applicable", api_integration_status: "integrated", still_needed: true,
    source_reference: "spreadsheet row: Whisper — Implemented locally; no signup needed",
    notes: "Local transcription (faster-whisper) for the receptionist and Capture; no signup needed.",
  }),
  candidate("silero-vad", "Silero VAD", "Voice activity detection", "Capture", {
    record_status: "local_tool", setup_status: "ready",
    plan_status: "not_applicable", api_integration_status: "integrated", still_needed: true,
    source_reference: "spreadsheet row: Silero VAD — Implemented locally; no signup needed",
    notes: "Local voice activity detection for the receptionist; no signup needed.",
  }),
  candidate("docusign", "DocuSign", "Electronic signatures", "Rental Manager", {
    account_email: GMAIL, record_status: "confirmed_account", setup_status: "ready",
    still_needed: true,
    source_kind: "email_crosscheck",
    source_reference: "gmail-crosscheck: Verify your identity to log in to Docusign (2024-11-02, x3); Verify a New Device (2023-11-16; 2024-11-02)",
    notes: "Login 2FA proves the account (Nov 2024); no welcome mail. The 2020 docusign.net mails are DuGood signing envelopes where Jason was the signer, not an account.",
  }),
  candidate("documenso", "Documenso", "Electronic signatures", "Rental Manager", {
    record_status: "evaluating_service", setup_status: "not_started",
    api_integration_status: "not_integrated",
    source_reference: "spreadsheet row: Documenso — Evaluated; signup unverified",
    notes: "Evaluated; no signup mail. Open-source e-signature candidate.",
  }),
  candidate("opensign", "OpenSign", "Electronic signatures", "Rental Manager", {
    record_status: "evaluating_service", setup_status: "not_started",
    api_integration_status: "not_integrated",
    source_reference: "spreadsheet row: OpenSign — Evaluated; signup unverified",
    notes: "Evaluated; no signup mail. Open-source e-signature candidate.",
  }),
  candidate("docuseal", "DocuSeal", "Electronic signatures", "Rental Manager", {
    record_status: "evaluating_service", setup_status: "not_started",
    api_integration_status: "not_integrated",
    source_reference: "spreadsheet row: DocuSeal — Evaluated; signup unverified",
    notes: "Evaluated; no signup mail. Open-source e-signature candidate.",
  }),
  candidate("twilio", "Twilio", "Communications", "FORGE", {
    record_status: "evaluating_service", setup_status: "not_started",
    api_integration_status: "not_integrated",
    source_reference: "spreadsheet row: Twilio — Mentioned; signup unverified",
    notes: "Receptionist trunk candidate; the local build replaced Twilio — no number bought, no forwarding change, no live calls. Zero mail from twilio.com.",
  }),
  candidate("polygon-io", "Polygon.io", "Market data API", "Financial FORGE", {
    record_status: "evaluating_service", setup_status: "not_started",
    api_integration_status: "not_integrated",
    source_reference: "spreadsheet row: Polygon.io — Evaluated; signup unverified",
    notes: "Evaluated; zero Gmail mail.",
  }),
  candidate("alpha-vantage", "Alpha Vantage", "Market data API", "Financial FORGE", {
    record_status: "evaluating_service", setup_status: "not_started",
    api_integration_status: "not_integrated",
    source_reference: "spreadsheet row: Alpha Vantage — Evaluated; signup unverified",
    notes: "Evaluated; zero Gmail mail.",
  }),
  candidate("finnhub", "Finnhub", "Market data API", "Financial FORGE", {
    record_status: "evaluating_service", setup_status: "not_started",
    api_integration_status: "not_integrated",
    source_reference: "spreadsheet row: Finnhub — Evaluated; signup unverified",
    notes: "Evaluated; zero Gmail mail.",
  }),
  candidate("twelve-data", "Twelve Data", "Market data API", "Financial FORGE", {
    record_status: "evaluating_service", setup_status: "not_started",
    api_integration_status: "not_integrated",
    source_reference: "spreadsheet row: Twelve Data — Evaluated; signup unverified",
    notes: "Evaluated; zero Gmail mail.",
  }),
  candidate("alpaca", "Alpaca", "Brokerage API", "Financial FORGE", {
    record_status: "evaluating_service", setup_status: "not_started",
    api_integration_status: "not_integrated",
    source_reference: "spreadsheet row: Alpaca — Evaluated; signup unverified",
    notes: "Evaluated; zero Gmail mail.",
  }),
  candidate("interactive-brokers", "Interactive Brokers", "Brokerage API", "Financial FORGE", {
    record_status: "evaluating_service", setup_status: "not_started",
    api_integration_status: "not_integrated",
    source_reference: "spreadsheet row: Interactive Brokers — Evaluated; signup unverified",
    notes: "Evaluated; zero Gmail mail.",
  }),
  candidate("charles-schwab", "Charles Schwab", "Brokerage integration", "Financial FORGE", {
    record_status: "evaluating_service", setup_status: "not_started",
    api_integration_status: "not_integrated",
    source_reference: "spreadsheet row: Charles Schwab — Evaluated; signup unverified",
    notes: "Evaluated; zero Gmail mail.",
  }),
  candidate("adobe-express", "Adobe Express", "Marketing design", "409 Marketplace", {
    account_email: GMAIL, record_status: "confirmed_account", setup_status: "ready",
    still_needed: true,
    source_kind: "email_crosscheck",
    source_reference: "gmail-crosscheck: Welcome to Adobe (2013-11-07; again 2022-12-19)",
    notes: "Adobe ID exists since 2013; Express-specific signup not isolated from the Adobe ID.",
  }),
  candidate("canva", "Canva", "Marketing design", "409 Marketplace", {
    record_status: "evaluating_service", setup_status: "not_started",
    api_integration_status: "not_integrated",
    source_reference: "spreadsheet row: Canva — Evaluated; signup unverified",
    notes: "Evaluated; no signup mail.",
  }),
  candidate("capcut", "CapCut", "Video editing", "Capture", {
    record_status: "evaluating_service", setup_status: "not_started",
    api_integration_status: "not_integrated",
    source_reference: "spreadsheet row: CapCut — Evaluated; signup unverified",
    notes: "Evaluated; no signup mail.",
  }),
  candidate("namecheap", "Namecheap", "Domain registration", "409 Marketplace", {
    account_email: GMAIL, record_status: "confirmed_account", setup_status: "in_progress",
    still_needed: true,
    source_kind: "email_crosscheck",
    source_reference: "gmail-crosscheck: Action required: Verify your contact information for your domain(s) (2026-05-26, 2026-05-31, 2026-06-06 — three reminders)",
    notes: "IDENTIFIED by the Gmail cross-check (the spreadsheet listed the registrar as unidentified). Domain 409marketplace.online is live. ICANN contact verification was requested THREE times May–Jun 2026 with no completion/verified mail found — check before a domain action is needed.",
  }),
  candidate("resend", "Resend", "Transactional email provider", "Rental Manager", {
    account_email: GMAIL, record_status: "confirmed_account", setup_status: "in_progress",
    still_needed: true,
    source_kind: "email_crosscheck",
    source_reference: "gmail-crosscheck: Welcome to Resend! (2026-08-14)",
    notes: "IDENTIFIED by the Gmail cross-check (the spreadsheet listed the provider as unidentified). Account created Aug 14, 2026; sending-domain verification/completion status not established by this mail alone.",
  }),
];

// ---------------------------------------------------------------------------
// (b) Scope-brief §4 families not in the spreadsheet. Local models and the
// daemon are local_tool (no signup); utilities and vendors with no login
// are no_account_required; prospective Radar sources are
// evaluating_service (Radar is scoped/GO, not built).
// ---------------------------------------------------------------------------
const BRIEF_FAMILY_ROWS = [
  candidate("qwen", "Qwen", "Local code review and analysis", "FORGE", {
    record_status: "local_tool", setup_status: "ready",
    plan_status: "not_applicable", api_integration_status: "integrated", still_needed: true,
    source_reference: "scope brief §4: FORGE/development — Qwen",
    notes: "Qwen3-Coder 30B, local via Ollama on the main iBUYPOWER; lead local reviewer. No signup. Jason named Qwen first in line for the local receptionist's brain (Nov 15).",
  }),
  candidate("deepseek", "DeepSeek", "Local second-opinion review", "FORGE", {
    record_status: "local_tool", setup_status: "ready",
    plan_status: "not_applicable", api_integration_status: "integrated", still_needed: true,
    source_reference: "scope brief §4: FORGE/development — DeepSeek",
    notes: "DeepSeek-R1-32B, local via Ollama; second-opinion reviewer. No signup.",
  }),
  candidate("hermes", "Hermes", "Local operations monitoring", "FORGE", {
    record_status: "local_tool", setup_status: "ready",
    plan_status: "not_applicable", api_integration_status: "integrated", still_needed: true,
    source_reference: "scope brief §4: FORGE/development — Hermes",
    notes: "Nous Hermes agent; Fleet Alerts alerting live (token verified, test alert delivered Oct 21). No signup.",
  }),
  candidate("gemini", "Gemini", "Google AI review and analysis", "FORGE", {
    record_status: "confirmed_account", setup_status: "in_progress",
    plan_status: "trial", still_needed: true,
    source_reference: "scope brief §4: FORGE/development — Gemini",
    notes: "Gemini API connector live Oct 29 (Phase A GO, 107/107). Its API key rides on a Google Cloud trial that ENDED Nov 7, 2026 — the key may be dead; verify before use. No live use.",
  }),
  candidate("ollama", "Ollama", "Local model runtime", "FORGE", {
    record_status: "local_tool", setup_status: "ready",
    plan_status: "not_applicable", api_integration_status: "integrated", still_needed: true,
    source_reference: "scope brief §4: FORGE/development — Ollama",
    notes: "Local model runtime on the main iBUYPOWER (0.40.6); serves Qwen, DeepSeek, Hermes. No signup.",
  }),
  candidate("forge-bridge-daemon", "FORGE Bridge daemon", "Desktop command bridge (iBUYPOWER)", "FORGE", {
    record_status: "local_tool", setup_status: "ready",
    plan_status: "not_applicable", api_integration_status: "integrated", still_needed: true,
    source_reference: "scope brief §4: FORGE/development — FORGE Bridge daemon",
    notes: "Local daemon on Jason's iBUYPOWER; routes machine work (GUI, PowerShell) via the drop. No signup; Jason's role is permission-only.",
  }),
  candidate("dugood", "DuGood", "Household credit union (banking, mortgage)", "Financial FORGE", {
    account_email: GMAIL, record_status: "confirmed_account", setup_status: "ready",
    api_integration_status: "integrated", still_needed: true,
    source_kind: "email_crosscheck",
    source_reference: "gmail-crosscheck: Welcome to DuGood (2018-04-26); Please verify your email address (2020-05-01); Welcome to DuGood Bill Pay (2020-06-09)",
    notes: "Household credit union. Home-equity loan is the actual home mortgage (closed-end, biweekly half-payments); money-market account is the household emergency fund. Account legs appear in FORGE financial data via Plaid.",
  }),
  candidate("etrade", "E*TRADE", "Brokerage", "Financial FORGE", {
    account_email: GMAIL, record_status: "confirmed_account", setup_status: "in_progress",
    still_needed: true,
    source_kind: "email_crosscheck",
    source_reference: "gmail-crosscheck: Action required: Please confirm your primary email address (2026-10-09)",
    notes: "Morgan Stanley brokerage; account dates to at least 2008–09. Primary-email confirmation requested Oct 9, 2026 and still outstanding.",
  }),
  candidate("graceland", "Graceland Portable Buildings", "Display cabin dealer program", "Other / cross-program", {
    work_thread_label: "Land / Hwy 62 + 8760 lots — display cabins",
    record_status: "no_account_required", still_needed: true,
    source_reference: "scope brief §4: Property — Graceland",
    notes: "Dealer program (consignment, 14–20% commission, no franchise fee). Confirmation email sent Nov 16, 2026 (appointment-only operation; office must be a separate structure at Jason's cost) — awaiting Graceland's written reply. No dealer-portal login on record.",
  }),
  candidate("f4-portable-buildings", "F4 Portable Buildings", "Repo/wholesale cabin vendor", "Other / cross-program", {
    work_thread_label: "Land / Hwy 62 + 8760 lots — display cabins",
    record_status: "no_account_required", still_needed: true,
    source_reference: "scope brief §4: Property — F4 Portable Buildings",
    notes: "Liberty TX vendor (Monica, f4portablebuildings@gmail.com). Reply + photos received Nov 16, 2026 (repo 16×40 partially finished); follow-up draft pending Jason's word. No portal login on record.",
  }),
  candidate("txdot", "TxDOT", "Driveway access permits (Form 1058)", "Other / cross-program", {
    work_thread_label: "Land / Hwy 62 + 8760 lots — access",
    record_status: "no_account_required", still_needed: true,
    source_reference: "scope brief §4: Property — TxDOT",
    notes: "Beaumont District; Orange Area Engineer Richard Bradley Jr., P.E., (409) 384-5493. Form 1058 for the Hwy 62 driveway widening and formalizing the 8760 frontage-road driveway; 60-day action window; lowest commercial tier 25-ft radius / 28-ft throat.",
  }),
  candidate("ocad-jefferson", "OCAD / Jefferson County publicsearch.us", "County property records + fraud alerts (Jefferson County)", "Other / cross-program", {
    work_thread_label: "Property alerts — Jefferson County",
    account_email: GMAIL, record_status: "confirmed_account", setup_status: "ready",
    still_needed: true,
    source_kind: "manual",
    source_reference: "Jefferson County Property Alert — registered + email-verified Nov 16, 2026; 4 keyword alerts live",
    notes: "jefferson.tx.publicsearch.us. 4 keyword alerts LIVE: MORGAN JASON / JASON MORGAN, MORGAN BRANDY, XP PROPERTY MANAGEMENT, JASON AND BRANDY MORGAN REVOCABLE LIVING TRUST. Alert history 0.",
  }),
  candidate("ocad-orange", "OCAD / Orange County Clerk", "County property records (Orange County)", "Other / cross-program", {
    work_thread_label: "Property alerts — Orange County",
    record_status: "no_account_required", still_needed: true,
    source_reference: "scope brief §4: Property — OCAD / publicsearch.us (Orange County)",
    notes: "No free property-fraud alert program confirmed for Orange County TX. Clerk Brandy Robertson, (409) 882-7055, countyclerk@co.orange.tx.us, 801 W. Division, Orange TX 77630 — Jason should call and ask whether they offer one.",
  }),
  candidate("orangefield-water", "Orangefield Water Supply Corp", "Water/sewer for Hwy 62 rentals", "Other / cross-program", {
    work_thread_label: "Land / Hwy 62 lot — utilities",
    record_status: "no_account_required", still_needed: true,
    source_reference: "scope brief §4: Property — Orangefield Water Supply",
    notes: "Water/sewer for the Hwy 62 rental phase: $24–30k (Jason's figure, scope unverified). Phone (409) 735-9422.",
  }),
  candidate("entergy", "Entergy", "Electric utility (house + well/apartment meters)", "Other / cross-program", {
    work_thread_label: "Land / Hwy 62 lot — utilities; home electrical",
    record_status: "unverified_lead", still_needed: true,
    source_reference: "scope brief §4: Property — Entergy",
    notes: "Electric utility for the house meter and the separate well/apartment meter (AMI meter AM10889532). Online account unconfirmed — verify which email holds it.",
  }),
  candidate("gmail-google", "Gmail / Google", "Primary email + Google account", "FORGE", {
    account_email: GMAIL, record_status: "confirmed_account", setup_status: "ready",
    api_integration_status: "integrated", still_needed: true,
    source_kind: "manual",
    source_reference: "Connected mailbox (jasonmorgan99@gmail.com) — the Gmail connector account itself",
    notes: "Primary Gmail; connected to Muse. Google password changed Nov 12 — saved google.com login stale; Google Calendar connector broken since Nov 9. Gmail works.",
  }),
  candidate("google-calendar", "Google Calendar", "Calendar", "FORGE", {
    account_email: GMAIL, record_status: "confirmed_account", setup_status: "blocked",
    api_integration_status: "not_integrated", still_needed: true,
    source_kind: "manual",
    source_reference: "scope brief §4: Communication/tools — Google Calendar",
    notes: "Same Google account as Gmail — NOT a separate login. Calendar connector broken since Nov 9 (Google password changed Nov 12); briefings skip calendar silently.",
  }),
  candidate("google-docs", "Google Docs", "Documents and notes", "FORGE", {
    account_email: GMAIL, record_status: "confirmed_account", setup_status: "ready",
    api_integration_status: "integrated", still_needed: true,
    source_kind: "manual",
    source_reference: "scope brief §4: Communication/tools — Google Docs",
    notes: "Same Google account as Gmail — NOT a separate login. Shared notebooks kept as Docs.",
  }),
  candidate("google-drive", "Google Drive", "File storage", "FORGE", {
    account_email: GMAIL, record_status: "confirmed_account", setup_status: "ready",
    api_integration_status: "integrated", still_needed: true,
    source_kind: "manual",
    source_reference: "scope brief §4: Communication/tools — Google Drive",
    notes: "Same Google account as Gmail — NOT a separate login.",
  }),
  candidate("google-voice", "Google Voice", "Secondary phone number", "FORGE", {
    account_email: GMAIL, record_status: "confirmed_account", setup_status: "ready",
    still_needed: true,
    source_kind: "email_crosscheck",
    source_reference: "gmail-crosscheck: Welcome to Google Voice (2010–2018 era)",
    notes: "Same Google account as Gmail — NOT a separate login.",
  }),
  candidate("google-pay", "Google Pay", "Payments", "FORGE", {
    account_email: GMAIL, record_status: "confirmed_account", setup_status: "ready",
    still_needed: true,
    source_kind: "email_crosscheck",
    source_reference: "gmail-crosscheck: jason, welcome to Google Pay (2010–2018 era)",
    notes: "Same Google account as Gmail — NOT a separate login.",
  }),
  candidate("facebook", "Facebook", "Social + FORGE page/groups", "FORGE", {
    account_email: GMAIL, record_status: "confirmed_account", setup_status: "ready",
    api_integration_status: "integrated", still_needed: true,
    source_kind: "email_crosscheck",
    source_reference: "gmail-crosscheck: Welcome to Facebook (2009-05-08)",
    notes: "Personal Facebook; FORGE page/group activity via the Facebook connector. Jason's profile photo is the identity reference for generated images.",
  }),
  candidate("instagram", "Instagram", "Social + shopping", "FORGE", {
    record_status: "confirmed_account", setup_status: "ready",
    api_integration_status: "integrated", still_needed: true,
    source_kind: "manual",
    source_reference: "Instagram connector connected (Muse connector list)",
    notes: "Connected to Muse (read/post). Signup email not in the Gmail cross-check — account email unconfirmed, do not invent.",
  }),
  candidate("threads", "Threads", "Social", "FORGE", {
    record_status: "unverified_lead",
    source_reference: "scope brief §4: Communication/tools — Threads",
    notes: "Threads connector exists; connection/login unconfirmed. Likely via the Instagram account — verify before claiming a separate login.",
  }),
  candidate("messenger", "Messenger", "Facebook messages", "FORGE", {
    account_email: GMAIL, record_status: "confirmed_account", setup_status: "ready",
    api_integration_status: "integrated", still_needed: true,
    source_kind: "manual",
    source_reference: "scope brief §4: Communication/tools — Messenger",
    notes: "Same Facebook account — NOT a separate login. Messenger read connector (personal messages, Marketplace threads).",
  }),
  candidate("telnyx", "Telnyx", "SIP trunk candidate (receptionist)", "FORGE", {
    record_status: "evaluating_service", setup_status: "not_started",
    api_integration_status: "not_integrated",
    source_reference: "scope brief §4: Communication/tools — Telnyx",
    notes: "Receptionist SIP trunk candidate — NOT approved; no number bought, no forwarding change, no live calls. Local build replaced Twilio.",
  }),
  candidate("norton", "Norton", "Antivirus (Jason's machines)", "FORGE", {
    record_status: "unverified_lead",
    source_reference: "scope brief §4: Communication/tools — Norton",
    notes: "Antivirus on Jason's machines (NEW UI: Security > Advanced > Antivirus, one Exclusions tab). Exclusions configured for the Capture sidecar, Ollama, forge-bridge, and mirrors. Account/login unconfirmed.",
  }),
  candidate("zello", "Zello", "Push-to-talk (site comms)", "Other / cross-program", {
    work_thread_label: "Crew comms — site radios",
    record_status: "evaluating_service", setup_status: "not_started",
    source_reference: "scope brief §4: Communication/tools — Zello",
    notes: "Free PTT app recommended Nov 14 for site comms where there is cell signal (Midland walkie-talkies promised 38 miles, died at 1 mile in the trees). Not set up.",
  }),
  candidate("generlink", "GenerLink", "Generator interlock (metered transfer)", "Other / cross-program", {
    work_thread_label: "Home electrical — generator hookup",
    record_status: "evaluating_service", setup_status: "not_started",
    still_needed: false,
    source_reference: "scope brief §4: Communication/tools — GenerLink",
    notes: "Generator interlock product ($1,230–$1,749) — Jason balked at the price. His method is a meter pull; the cheap code-legal alternative being priced is a panel interlock + inlet box. Scope is the WELL AND APARTMENT meter only, not the house meter.",
  }),
  candidate("home-depot", "Home Depot", "Retail supplier (Orange TX)", "Other / cross-program", {
    work_thread_label: "Purchasing — generators, tools",
    record_status: "no_account_required",
    source_reference: "scope brief §4: Communication/tools — Home Depot",
    notes: "Retail supplier (Orange TX store). Generator/chainsaw pricing Nov 2026 (Champion 201412 $1,099; Milwaukee M18 FUEL 14-inch $349 in stock). No online account on record.",
  }),
  candidate("harbor-freight", "Harbor Freight", "Retail supplier (Orange TX)", "Other / cross-program", {
    work_thread_label: "Purchasing — generators, tools",
    record_status: "no_account_required",
    source_reference: "scope brief §4: Communication/tools — Harbor Freight",
    notes: "Retail supplier (Orange TX). Predator 13,000W tri-fuel generator $1,299.99 in stock, Aisle 8. No online account on record.",
  }),
  candidate("rythm-health", "Rythm Health", "Lab testing subscription (Ethan)", "FORGE", {
    record_status: "confirmed_account", setup_status: "ready",
    plan_status: "paid",
    source_reference: "scope brief §4: Health — Rythm Health",
    notes: "ETHAN Morgan's account ($70/month subscription), not Jason's — Jason holds the screenshots, not the login. Do not conflate with a Jason account. Ethan's Nov 9, 2026 set: Rythm Score 67% (AVERAGE).",
  }),
  candidate("labtech-diagnostics", "LABTECH Diagnostics", "Blood labs (Dr. Gerstenberg)", "FORGE", {
    record_status: "no_account_required", still_needed: true,
    source_reference: "scope brief §4: Health — LABTECH Diagnostics",
    notes: "Lab for Jason's blood work (drawn Nov 6, 2026, Dr. K Paul Gerstenberg, DO, Port Neches; LABTECH Diagnostics, San Antonio). Results on paper — no portal account on record. Latest A1c 5.6% (improved); LDL 200 flagged high.",
  }),
  candidate("apple-health", "Apple Health", "iPhone health metrics", "FORGE", {
    record_status: "no_account_required", setup_status: "ready",
    api_integration_status: "integrated", still_needed: true,
    source_reference: "scope brief §4: Health — Apple Health",
    notes: "iPhone-synced health metrics (Apple HealthKit connector). Device-local store; the Apple ID is tracked as its own row.",
  }),
  // Property Risk Radar prospective sources (brief §5 must-pass fixture).
  // All evaluating_service / not integrated: Radar is scoped/GO, not built.
  candidate("windy", "Windy", "Weather + live cameras (Radar prospect)", "Other / cross-program", {
    work_thread_label: "Property Risk Radar",
    record_status: "evaluating_service", setup_status: "not_started",
    api_integration_status: "not_integrated",
    source_reference: "scope brief §4/§5: Property Risk Radar prospective source — Windy",
    notes: "Prospective Radar source. Windy free tier restricts reuse — rights check owed before any use.",
  }),
  candidate("houston-transtar", "Houston TranStar", "Live traffic cameras (Radar prospect)", "Other / cross-program", {
    work_thread_label: "Property Risk Radar",
    record_status: "evaluating_service", setup_status: "not_started",
    api_integration_status: "not_integrated",
    source_reference: "scope brief §4/§5: Property Risk Radar prospective source — Houston TranStar",
    notes: "Prospective Radar live-camera source. TranStar requires consent for framing/hotlinking — camera rights are the gate.",
  }),
  candidate("511ny", "511NY", "Live traffic cameras (Radar prospect)", "Other / cross-program", {
    work_thread_label: "Property Risk Radar",
    record_status: "evaluating_service", setup_status: "not_started",
    api_integration_status: "not_integrated",
    source_reference: "scope brief §4/§5: Property Risk Radar prospective source — 511NY",
    notes: "Prospective Radar live-camera source — rights unverified.",
  }),
  candidate("earthcam", "EarthCam", "Live cameras (Radar prospect)", "Other / cross-program", {
    work_thread_label: "Property Risk Radar",
    record_status: "evaluating_service", setup_status: "not_started",
    api_integration_status: "not_integrated",
    source_reference: "scope brief §4/§5: Property Risk Radar prospective source — EarthCam",
    notes: "Prospective Radar live-camera source — rights unverified.",
  }),
  candidate("trafficland", "TrafficLand", "Live traffic cameras (Radar prospect)", "Other / cross-program", {
    work_thread_label: "Property Risk Radar",
    record_status: "evaluating_service", setup_status: "not_started",
    api_integration_status: "not_integrated",
    source_reference: "scope brief §4/§5: Property Risk Radar prospective source — TrafficLand",
    notes: "Prospective Radar live-camera source — rights unverified.",
  }),
  candidate("osiris", "OSIRIS", "Live cameras (Radar prospect)", "Other / cross-program", {
    work_thread_label: "Property Risk Radar",
    record_status: "evaluating_service", setup_status: "not_started",
    api_integration_status: "not_integrated",
    source_reference: "scope brief §4/§5: Property Risk Radar prospective source — OSIRIS",
    notes: "Prospective Radar live-camera source — rights unverified.",
  }),
  candidate("noaa-nws", "NOAA / NWS", "Weather data (Radar prospect)", "Other / cross-program", {
    work_thread_label: "Property Risk Radar",
    record_status: "evaluating_service", setup_status: "not_started",
    api_integration_status: "not_integrated",
    source_reference: "scope brief §4/§5: Property Risk Radar prospective source — NOAA/NWS",
    notes: "Prospective Radar public-data source (federal, generally reusable — verify terms).",
  }),
  candidate("usgs", "USGS", "Earthquake data (Radar prospect)", "Other / cross-program", {
    work_thread_label: "Property Risk Radar",
    record_status: "evaluating_service", setup_status: "not_started",
    api_integration_status: "not_integrated",
    source_reference: "scope brief §4/§5: Property Risk Radar prospective source — USGS",
    notes: "Prospective Radar public-data source (federal, generally reusable — verify terms).",
  }),
  candidate("nifc", "NIFC", "Wildfire data (Radar prospect)", "Other / cross-program", {
    work_thread_label: "Property Risk Radar",
    record_status: "evaluating_service", setup_status: "not_started",
    api_integration_status: "not_integrated",
    source_reference: "scope brief §4/§5: Property Risk Radar prospective source — NIFC",
    notes: "Prospective Radar public-data source (federal, generally reusable — verify terms).",
  }),
  candidate("fema", "FEMA", "Flood data (Radar prospect)", "Other / cross-program", {
    work_thread_label: "Property Risk Radar",
    record_status: "evaluating_service", setup_status: "not_started",
    api_integration_status: "not_integrated",
    source_reference: "scope brief §4/§5: Property Risk Radar prospective source — FEMA",
    notes: "Prospective Radar public-data source (federal, generally reusable — verify terms). Flood zones already verified for the lots (Zone X / Zone AE) from FEMA maps.",
  }),
];

// ---------------------------------------------------------------------------
// (b continued) Travel / commerce / connectors (brief §4) and
// (c) Gmail cross-check gaps — providers with signup/verification mail
// that are NOT in the spreadsheet. Every gap row carries the mail as
// its source_reference; the email is set only where the mail was
// addressed to jasonmorgan99@gmail.com.
// ---------------------------------------------------------------------------
const CONNECTOR_AND_GAP_ROWS = [
  candidate("expedia", "Expedia", "Hotel search and booking", "FORGE", {
    record_status: "unverified_lead",
    api_integration_status: "integrated",
    source_reference: "scope brief §4: Travel/commerce/connectors — Expedia",
    notes: "Hotel connector (search + pay-now booking). Login unconfirmed.",
  }),
  candidate("duffel", "Duffel", "Flight search and booking", "FORGE", {
    record_status: "unverified_lead",
    api_integration_status: "integrated",
    source_reference: "scope brief §4: Travel/commerce/connectors — Duffel",
    notes: "Flight connector (search, book, cancel; pay-at-pickup rental cars). Login unconfirmed.",
  }),
  candidate("ticketmaster", "Ticketmaster", "Event tickets", "FORGE", {
    account_email: GMAIL, record_status: "confirmed_account", setup_status: "ready",
    api_integration_status: "integrated", still_needed: true,
    source_kind: "email_crosscheck",
    source_reference: "gmail-crosscheck: Welcome to Ticketmaster — enjoy your new membership benefits now (2019-09-27)",
    notes: "Membership since Sep 2019.",
  }),
  candidate("uber", "Uber", "Courier deliveries", "FORGE", {
    record_status: "unverified_lead",
    api_integration_status: "integrated",
    source_reference: "scope brief §4: Travel/commerce/connectors — Uber",
    notes: "Uber Courier connector (estimate, book, track, cancel). Login unconfirmed.",
  }),
  candidate("shopify", "Shopify", "Storefront", "FORGE", {
    record_status: "unverified_lead",
    api_integration_status: "integrated",
    source_reference: "scope brief §4: Travel/commerce/connectors — Shopify",
    notes: "Shopify connector (products, orders, customers). Login unconfirmed.",
  }),
  candidate("spotify", "Spotify", "Music and podcasts", "FORGE", {
    account_email: GMAIL, record_status: "confirmed_account", setup_status: "ready",
    api_integration_status: "integrated", still_needed: true,
    source_kind: "email_crosscheck",
    source_reference: "gmail-crosscheck: Confirm your account (2023-05-19)",
    notes: "Spotify connector (search, play, playlists).",
  }),
  candidate("meta-ads", "Meta Ads", "Facebook/Instagram advertising", "FORGE", {
    record_status: "unverified_lead",
    source_reference: "scope brief §4: Travel/commerce/connectors — Meta Ads",
    notes: "Meta Business Manager / Ads. The underlying Meta account is confirmed (Sep 20, 2026); Ads/Business access unconfirmed — verify before claiming an Ads account.",
  }),
  candidate("shop-pay", "Shop Pay", "Checkout wallet", "FORGE", {
    record_status: "unverified_lead",
    api_integration_status: "integrated",
    source_reference: "scope brief §4: Travel/commerce/connectors — Shop Pay",
    notes: "Shop Pay wallet connector. Login unconfirmed.",
  }),
  candidate("tailscale", "Tailscale", "Private network (VM access)", "FORGE", {
    record_status: "confirmed_account", setup_status: "ready",
    api_integration_status: "integrated", still_needed: true,
    source_kind: "manual",
    source_reference: "Tailscale connector — this VM joins Jason's Tailscale network",
    notes: "Private network; the VM reaches Jason's services through it. Tailnet owner email unconfirmed — do not invent.",
  }),
  candidate("health-connect", "Health Connect", "Android health metrics", "FORGE", {
    record_status: "no_account_required", setup_status: "ready",
    api_integration_status: "integrated", still_needed: true,
    source_reference: "scope brief §4: Travel/commerce/connectors — Health Connect",
    notes: "Android-synced health metrics (Health Connect connector). Device-local; no separate login.",
  }),
  candidate("cloudflare", "Cloudflare", "DNS / API", "FORGE", {
    record_status: "confirmed_account", setup_status: "ready",
    api_integration_status: "integrated", still_needed: true,
    source_kind: "manual",
    source_reference: "Cloudflare connector — registered API",
    notes: "Registered API (custom.cloudflare). Account email unconfirmed — do not invent.",
  }),
  candidate("floorplanner", "Floorplanner", "Floor plans and design", "FORGE", {
    account_email: GMAIL, record_status: "confirmed_account", setup_status: "ready",
    still_needed: true,
    source_kind: "email_crosscheck",
    source_reference: "gmail-crosscheck: Your saved design (2015-12-30; 2016-01-04; 2016-12-05; 2017-05-09, from no-reply@floorplanner.com)",
    notes: "SPREADSHEET GAP (Jason said it was in the sheet; it was not). Account since at least Dec 2015; designs were being saved 2015–2017. No welcome mail in the set.",
  }),
  candidate("planner-5d", "Planner 5D", "Floor plans and design", "FORGE", {
    account_email: GMAIL, record_status: "confirmed_account", setup_status: "ready",
    still_needed: true,
    source_kind: "email_crosscheck",
    source_reference: "gmail-crosscheck: Your free plan is activated (2026-09-20); verification-code mail (2026-09-20)",
    notes: "SPREADSHEET GAP. Free plan activated Sep 20, 2026. 201 messages from planner5d.com in the mailbox (mostly marketing).",
  }),
  candidate("homestyler", "Homestyler", "Floor plans and design (Autodesk)", "FORGE", {
    account_email: GMAIL, record_status: "confirmed_account", setup_status: "ready",
    still_needed: true,
    source_kind: "email_crosscheck",
    source_reference: "gmail-crosscheck: Welcome to Autodesk Homestyler! (2014-09-05, from noreply.homestyler@autodesk.com)",
    notes: "SPREADSHEET GAP. Floor-planner account since Sep 2014.",
  }),
  candidate("bentley", "Bentley", "CAD / engineering software", "FORGE", {
    account_email: GMAIL, record_status: "unverified_lead",
    source_kind: "email_crosscheck",
    source_reference: "gmail-crosscheck: Complete Your Registration Process With Bentley (2014-03-08)",
    notes: "SPREADSHEET GAP. Registration started Mar 8, 2014; no completion mail found — likely abandoned, but the registration was started.",
  }),
  candidate("cad-forum", "CAD Forum", "CAD community", "FORGE", {
    account_email: GMAIL, record_status: "confirmed_account", setup_status: "ready",
    source_kind: "email_crosscheck",
    source_reference: "gmail-crosscheck: Welcome to CAD Forum discussion (EN) (2013-10-29)",
    notes: "SPREADSHEET GAP (minor). Community account.",
  }),
  candidate("guidde", "Guidde", "Video SOP documentation", "Capture", {
    account_email: GMAIL, record_status: "confirmed_account", setup_status: "ready",
    still_needed: true,
    source_kind: "email_crosscheck",
    source_reference: "gmail-crosscheck: Welcome to Guidde — Video Documentation Made Simple (2026-10-28); Complete your Guidde sign in x2 (2026-10-28)",
    notes: "SPREADSHEET GAP. Account created Oct 2026. Guidde is the STUDIED PATTERN for Capture PPTX-to-video only — never a subscription (Jason's Nov 15 + Nov 16 word).",
  }),
  candidate("scribe", "Scribe", "SOP documentation", "Capture", {
    record_status: "unverified_lead",
    source_reference: "gmail-crosscheck: no mail from scribehow.com; Jason's own sent mail 'Scribe for training' (2026-08-11) shows use",
    notes: "Used for training (Aug 11, 2026 sent mail) but no Gmail signup evidence. Account unconfirmed.",
  }),
  candidate("tenantcloud", "TenantCloud", "Rental management (competitor research)", "Rental Manager", {
    account_email: GMAIL, record_status: "confirmed_account", setup_status: "ready",
    source_kind: "email_crosscheck",
    source_reference: "gmail-crosscheck: Welcome to TenantCloud! (2021-07-13)",
    notes: "SPREADSHEET GAP. Rental-management account (competitor research).",
  }),
  candidate("rent-com", "Rent.com", "Rental listings", "Rental Manager", {
    account_email: GMAIL, record_status: "confirmed_account", setup_status: "ready",
    source_kind: "email_crosscheck",
    source_reference: "gmail-crosscheck: Welcome to Rent. (2024-02-04)",
    notes: "SPREADSHEET GAP. Rental listings account.",
  }),
  candidate("xome", "Xome", "Real-estate auctions", "Other / cross-program", {
    work_thread_label: "Land / property research",
    account_email: GMAIL, record_status: "confirmed_account", setup_status: "ready",
    source_kind: "email_crosscheck",
    source_reference: "gmail-crosscheck: Welcome to Xome! + Verify Your Email Address (both 2026-04-14)",
    notes: "SPREADSHEET GAP. Real-estate auctions.",
  }),
  candidate("coldwell-banker", "Coldwell Banker", "Real-estate listings", "Other / cross-program", {
    work_thread_label: "Land / property research",
    account_email: GMAIL, record_status: "confirmed_account", setup_status: "ready",
    source_kind: "email_crosscheck",
    source_reference: "gmail-crosscheck: Welcome to coldwellbanker.com! (2020-03-13)",
    notes: "SPREADSHEET GAP.",
  }),
  candidate("zillow-rental-manager", "Zillow Rental Manager", "Rental listings", "Rental Manager", {
    record_status: "confirmed_account", setup_status: "ready",
    source_reference: "gmail-crosscheck: account evidenced Jan 31, 2020 via a forward from Brandy's Yahoo ('Important updates to your Zillow Rental Manager account')",
    notes: "SPREADSHEET GAP. Account evidenced 2020 via forward, not a signup mail — account email unclear, do not invent.",
  }),
  candidate("everydollar", "EveryDollar", "Budgeting (Ramsey)", "Financial FORGE", {
    account_email: GMAIL, record_status: "confirmed_account", setup_status: "ready",
    source_kind: "email_crosscheck",
    source_reference: "gmail-crosscheck: Action Required: Please Verify Your Email Address + Welcome to EveryDollar! (both 2018-05-11)",
    notes: "SPREADSHEET GAP. Budgeting app (Ramsey).",
  }),
  candidate("rocket-mortgage", "Rocket Mortgage", "Mortgage", "Financial FORGE", {
    account_email: GMAIL, record_status: "confirmed_account", setup_status: "ready",
    source_kind: "email_crosscheck",
    source_reference: "gmail-crosscheck: Welcome to Rocket Mortgage (2018-07-31)",
    notes: "SPREADSHEET GAP.",
  }),
  candidate("edward-jones", "Edward Jones", "Brokerage", "Financial FORGE", {
    account_email: GMAIL, record_status: "confirmed_account", setup_status: "ready",
    source_kind: "email_crosscheck",
    source_reference: "gmail-crosscheck: Welcome To Edward Jones AccountLink (2009-03-25)",
    notes: "SPREADSHEET GAP. Brokerage; AccountLink since 2009.",
  }),
  candidate("chase", "Chase Online", "Bank", "Financial FORGE", {
    account_email: GMAIL, record_status: "confirmed_account", setup_status: "ready",
    api_integration_status: "not_applicable",
    source_kind: "email_crosscheck",
    source_reference: "gmail-crosscheck: Welcome to Chase Online (2016-07-29)",
    notes: "SPREADSHEET GAP. Bank.",
  }),
  candidate("credit-karma", "Credit Karma", "Credit monitoring", "Financial FORGE", {
    account_email: GMAIL, record_status: "confirmed_account", setup_status: "ready",
    api_integration_status: "not_applicable",
    source_kind: "email_crosscheck",
    source_reference: "gmail-crosscheck: Welcome to Credit Karma! (2023-12-05); Welcome, Jason. Ready to watch your hard work pay off? (2023-12-15)",
    notes: "SPREADSHEET GAP.",
  }),
  candidate("coinbase", "Coinbase", "Crypto brokerage", "Financial FORGE", {
    account_email: GMAIL, record_status: "confirmed_account", setup_status: "ready",
    api_integration_status: "not_applicable",
    source_kind: "email_crosscheck",
    source_reference: "gmail-crosscheck: Welcome to Coinbase + verification-code mail (both 2025-02-03); Verify your device to sign in (2026-03-11)",
    notes: "SPREADSHEET GAP. Coinbase Final Approval Letter delivered Nov 15, 2026 — do not re-deliver.",
  }),
  candidate("venmo", "Venmo", "Payments", "Financial FORGE", {
    account_email: GMAIL, record_status: "confirmed_account", setup_status: "in_progress",
    api_integration_status: "not_applicable", still_needed: true,
    source_kind: "email_crosscheck",
    source_reference: "gmail-crosscheck: Verify Email Address on Venmo (2025-03-10); Finish setting up your account and get rewarded (2025-04-10)",
    notes: "SPREADSHEET GAP. Email verified Mar 10, 2025, but setup still incomplete a month later (Apr 10 prompt); no later completion mail found.",
  }),
  candidate("starlink", "Starlink", "Satellite internet", "Other / cross-program", {
    work_thread_label: "Home connectivity",
    account_email: GMAIL, record_status: "confirmed_account", setup_status: "ready",
    still_needed: true,
    source_kind: "email_crosscheck",
    source_reference: "gmail-crosscheck: Your Starlink is ready! Confirm your order in the next 7 days (2022-02-14); Welcome to Starlink (2025-12-07)",
    notes: "SPREADSHEET GAP. Residential service; $143/month from ~Dec 7, 2026 (prepared, not delivered — verify).",
  }),
  candidate("finelo", "Finelo", "Trading education", "Financial FORGE", {
    account_email: GMAIL, record_status: "unverified_lead", setup_status: "in_progress",
    api_integration_status: "not_applicable",
    source_kind: "email_crosscheck",
    source_reference: "gmail-crosscheck: Confirm Your Email (2026-03-09 AND 2026-08-20 — twice); Alert: High demand — confirm your participation (2026-08-22)",
    notes: "SPREADSHEET GAP. Repeated email confirms (Mar + Aug 2026) suggest setup never completed (or was re-registered).",
  }),
  candidate("vestwell", "Vestwell", "Retirement-plan platform", "Financial FORGE", {
    account_email: GMAIL, record_status: "unverified_lead", setup_status: "in_progress",
    api_integration_status: "not_applicable",
    source_kind: "email_crosscheck",
    source_reference: "gmail-crosscheck: Welcome to Vestwell: Your New Savings Platform (2026-04-21); Register for Your Retirement Plan! (2026-05-06)",
    notes: "SPREADSHEET GAP. Registration action outstanding (May 6, 2026).",
  }),
  candidate("link-stripe", "Link (by Stripe)", "Checkout wallet", "Financial FORGE", {
    account_email: GMAIL, record_status: "confirmed_account", setup_status: "ready",
    source_kind: "email_crosscheck",
    source_reference: "gmail-crosscheck: Verify your email + Welcome to Link (both 2026-05-26)",
    notes: "SPREADSHEET GAP. Stripe's Link wallet; arguably part of Stripe — kept separate because it is a distinct login surface.",
  }),
  candidate("bitwarden", "Bitwarden", "Password manager", "FORGE", {
    account_email: GMAIL, record_status: "confirmed_account", setup_status: "ready",
    still_needed: true,
    source_kind: "email_crosscheck",
    source_reference: "gmail-crosscheck: Verify Your Email + Welcome to Bitwarden! + verification-code mail (all 2026-08-27)",
    notes: "SPREADSHEET GAP. Password manager — directly relevant to credential location. Verify the vault contents against this register.",
  }),
  candidate("globalgpt", "GlobalGPT", "AI tool", "FORGE", {
    account_email: GMAIL, record_status: "confirmed_account", setup_status: "ready",
    source_kind: "email_crosscheck",
    source_reference: "gmail-crosscheck: Welcome to GlobalGPT (2026-11-10)",
    notes: "SPREADSHEET GAP. AI tool.",
  }),
  candidate("posthog", "PostHog", "Product analytics", "FORGE", {
    account_email: GMAIL, record_status: "confirmed_account", setup_status: "ready",
    source_kind: "email_crosscheck",
    source_reference: "gmail-crosscheck: Welcome to PostHog! (2026-09-12)",
    notes: "SPREADSHEET GAP. Product analytics (dev tool).",
  }),
  candidate("perplexity", "Perplexity", "AI search", "FORGE", {
    account_email: GMAIL, record_status: "confirmed_account", setup_status: "ready",
    source_kind: "email_crosscheck",
    source_reference: "gmail-crosscheck: Welcome to Perplexity (2026-03-19)",
    notes: "SPREADSHEET GAP. AI search.",
  }),
  candidate("collx", "CollX", "Trading-cards app", "Other / cross-program", {
    work_thread_label: "Trading cards / collectibles",
    account_email: GMAIL, record_status: "confirmed_account", setup_status: "ready",
    source_kind: "email_crosscheck",
    source_reference: "gmail-crosscheck: Please verify your email address + Welcome to CollX! (both 2025-08-24)",
    notes: "SPREADSHEET GAP. Trading-cards app.",
  }),
  candidate("alt-xyz", "Alt (alt.xyz)", "Trading-cards / alternative assets", "Other / cross-program", {
    work_thread_label: "Trading cards / collectibles",
    account_email: GMAIL, record_status: "confirmed_account", setup_status: "ready",
    source_kind: "email_crosscheck",
    source_reference: "gmail-crosscheck: Verify your email address + Welcome to Alt (both 2025-08-24)",
    notes: "SPREADSHEET GAP. Trading-cards / alternative-assets app.",
  }),
  candidate("centurylink", "CenturyLink", "Internet / phone", "Other / cross-program", {
    work_thread_label: "Home connectivity",
    account_email: GMAIL, record_status: "unverified_lead", setup_status: "in_progress",
    source_kind: "email_crosscheck",
    source_reference: "gmail-crosscheck: It's time to set-up your My CenturyLink Profile (2022-03-03); We've noticed you have not completed your My CenturyLink Profile (2022-03-04)",
    notes: "SPREADSHEET GAP (minor). Profile setup incomplete (Mar 2022 notices); no completion found.",
  }),
  candidate("meta-account", "Meta account", "Meta login (Facebook/Instagram/Ads)", "FORGE", {
    account_email: GMAIL, record_status: "confirmed_account", setup_status: "ready",
    still_needed: true,
    source_kind: "email_crosscheck",
    source_reference: "gmail-crosscheck: Confirm your email for your new Meta account (2026-09-20)",
    notes: "SPREADSHEET GAP. Meta account (Facebook/Instagram/Meta Ads underlying login).",
  }),
  candidate("apple-id", "Apple ID", "Apple login", "FORGE", {
    account_email: GMAIL, record_status: "confirmed_account", setup_status: "ready",
    still_needed: true,
    source_kind: "email_crosscheck",
    source_reference: "gmail-crosscheck: Verify your email address. (2026-10-11)",
    notes: "SPREADSHEET GAP. Apple ID; verify which devices/services use it.",
  }),
  candidate("samsung", "Samsung", "Device account + Wallet", "FORGE", {
    account_email: GMAIL, record_status: "confirmed_account", setup_status: "ready",
    source_kind: "email_crosscheck",
    source_reference: "gmail-crosscheck: account verification mails 2020–2026; Welcome to Samsung Wallet! (2026-03-10)",
    notes: "SPREADSHEET GAP.",
  }),
  candidate("box", "Box", "Cloud storage", "FORGE", {
    account_email: GMAIL, record_status: "confirmed_account", setup_status: "ready",
    source_kind: "email_crosscheck",
    source_reference: "gmail-crosscheck: Welcome to Box.net Jason Morgan! (2010-09-02)",
    notes: "SPREADSHEET GAP. Cloud storage; account since 2010.",
  }),
  candidate("evernote", "Evernote", "Notes", "FORGE", {
    account_email: GMAIL, record_status: "confirmed_account", setup_status: "ready",
    source_kind: "email_crosscheck",
    source_reference: "gmail-crosscheck: Welcome to Evernote (2010-12-02)",
    notes: "SPREADSHEET GAP.",
  }),
  candidate("mcafee", "McAfee", "Antivirus (former)", "FORGE", {
    account_email: GMAIL, record_status: "closed", setup_status: "retired",
    plan_status: "trial", still_needed: false,
    source_kind: "email_crosscheck",
    source_reference: "gmail-crosscheck: Welcome to McAfee — your 30-day trial starts today (2019-12-07)",
    notes: "SPREADSHEET GAP (historical). 30-day trial Dec 2019; Norton is the current AV.",
  }),
  candidate("login-gov", "Login.gov", "Government login", "Other / cross-program", {
    work_thread_label: "Government services",
    account_email: GMAIL, record_status: "confirmed_account", setup_status: "ready",
    source_kind: "email_crosscheck",
    source_reference: "gmail-crosscheck: Confirm your email (2025-03-08)",
    notes: "SPREADSHEET GAP. Government login.",
  }),
  candidate("purple-wave", "Purple Wave", "Equipment auctions", "Other / cross-program", {
    work_thread_label: "Equipment purchasing",
    account_email: GMAIL, record_status: "confirmed_account", setup_status: "ready",
    source_kind: "email_crosscheck",
    source_reference: "gmail-crosscheck: Confirm Your Account + Welcome to Purple Wave! (2026-02-04–06)",
    notes: "SPREADSHEET GAP. Equipment auctions.",
  }),
  candidate("equipmentfacts", "EquipmentFacts", "Equipment auctions", "Other / cross-program", {
    work_thread_label: "Equipment purchasing",
    account_email: GMAIL, record_status: "confirmed_account", setup_status: "ready",
    source_kind: "email_crosscheck",
    source_reference: "gmail-crosscheck: Welcome To equipmentfacts.com (2024-10-01)",
    notes: "SPREADSHEET GAP. Equipment auctions.",
  }),
  candidate("23andme", "23andMe", "Genetic testing", "FORGE", {
    account_email: GMAIL, record_status: "confirmed_account", setup_status: "ready",
    source_kind: "email_crosscheck",
    source_reference: "gmail-crosscheck: Finish Creating Your Account (2018-12-24); Your reports are ready (2020-12-20)",
    notes: "SPREADSHEET GAP. Account completed by Dec 2020 (reports ready).",
  }),
  candidate("linkedin", "LinkedIn", "Professional network", "FORGE", {
    account_email: GMAIL, record_status: "confirmed_account", setup_status: "ready",
    source_kind: "email_crosscheck",
    source_reference: "gmail-crosscheck: Please confirm your email address (2008-10-09)",
    notes: "SPREADSHEET GAP. Professional network; account since 2008.",
  }),
  candidate("quest-diagnostics", "Quest Diagnostics (MyQuest)", "Lab results portal", "FORGE", {
    account_email: GMAIL, record_status: "confirmed_account", setup_status: "ready",
    source_kind: "email_crosscheck",
    source_reference: "gmail-crosscheck: Welcome to MyQuest (2020-10-31)",
    notes: "SPREADSHEET GAP. Health portal (lab results).",
  }),
  candidate("icims", "iCIMS", "Applicant tracking (job applications)", "Other / cross-program", {
    work_thread_label: "Employment — ETS / Stronghold onboarding",
    account_email: GMAIL, record_status: "confirmed_account", setup_status: "ready",
    source_kind: "email_crosscheck",
    source_reference: "gmail-crosscheck: Verify your email address (2023-02-01)",
    notes: "SPREADSHEET GAP. Applicant-tracking system (same vendor as the Stronghold/ETS onboarding portal).",
  }),
  candidate("nes-fircroft", "NES Fircroft onboarding portal", "Staffing onboarding", "Other / cross-program", {
    work_thread_label: "Employment — onboarding",
    account_email: GMAIL, record_status: "confirmed_account", setup_status: "ready",
    source_kind: "email_crosscheck",
    source_reference: "gmail-crosscheck: Welcome to NES Fircroft's Onboarding Portal (2026-06-16)",
    notes: "SPREADSHEET GAP. Staffing onboarding portal (one-time use Jun 2026).",
  }),
  candidate("cbre", "CBRE Talent Community", "Talent community", "Other / cross-program", {
    work_thread_label: "Employment — job search",
    account_email: GMAIL, record_status: "confirmed_account", setup_status: "ready",
    source_kind: "email_crosscheck",
    source_reference: "gmail-crosscheck: Welcome to the CBRE Talent Community (2026-04-13)",
    notes: "SPREADSHEET GAP. Talent community (not a job application).",
  }),
  candidate("mt-gov-ui", "MT.gov UI Claimant Center", "Montana unemployment claimant portal", "Other / cross-program", {
    work_thread_label: "Government services",
    account_email: GMAIL, record_status: "confirmed_account", setup_status: "ready",
    source_kind: "email_crosscheck",
    source_reference: "gmail-crosscheck: Welcome to UI Claimant Center (2026-05-23)",
    notes: "SPREADSHEET GAP. Montana unemployment claimant portal.",
  }),
  candidate("hscloudsuite", "HSCloudSuite", "Health department portal", "Other / cross-program", {
    work_thread_label: "Government services",
    account_email: GMAIL, record_status: "confirmed_account", setup_status: "ready",
    source_kind: "email_crosscheck",
    source_reference: "gmail-crosscheck: Welcome to My Health Department! (2025-02-20)",
    notes: "SPREADSHEET GAP. Health department portal.",
  }),
  candidate("discover-business", "Discover it Business", "Business credit card", "Financial FORGE", {
    record_status: "confirmed_account", setup_status: "ready",
    api_integration_status: "not_applicable",
    source_reference: "gmail-crosscheck: Welcome to Discover it Business (2020-01-17, forwarded from XP Property Management's Yahoo)",
    notes: "SPREADSHEET GAP (financial — side find). Business credit card; welcome forwarded from XP Property Management's Yahoo — account email unclear, do not invent.",
  }),
];

// ---------------------------------------------------------------------------
// (d) Seed threads. Threaded work rides on the candidate rows above:
// Radar's pending thread (the §5 fixture), plus the unfinished-account
// threads the cross-check names. Nothing here is a live tracker row —
// the tracker lives in the drop, not the DB; these are register threads
// that the report section surfaces.
// ---------------------------------------------------------------------------
export const SEED_THREADS = [
  {
    account_seed_key: seedKeyForSlug("windy"),
    title: "Property Risk Radar — scope GO Oct 16, build not started",
    reference: "briefs/property-risk-radar/",
    state: "open",
    next_action: "Jason's word needed to start R0 (source/rights records)",
    owner: "Jason Morgan",
    next_review_on: null,
  },
  {
    account_seed_key: seedKeyForSlug("houston-transtar"),
    title: "Property Risk Radar — camera rights (TranStar consent)",
    reference: "briefs/property-risk-radar/",
    state: "blocked",
    next_action: "Ask TranStar for framing/hotlinking consent before any camera use",
    owner: "Jason Morgan",
    next_review_on: null,
  },
  {
    account_seed_key: seedKeyForSlug("namecheap"),
    title: "Namecheap — contact verification never completed",
    reference: "gmail-crosscheck §2.1",
    state: "open",
    next_action: "Complete the contact verification asked 3× (May–Jun 2026) or confirm the domain is held elsewhere",
    owner: "Jason Morgan",
    next_review_on: null,
  },
  {
    account_seed_key: seedKeyForSlug("google-cloud"),
    title: "Google Cloud — trial ended Nov 7, 2026 (upgrade or lose it)",
    reference: "gmail-crosscheck §2.3",
    state: "blocked",
    next_action: "Decide: upgrade, or let it lapse — the Gemini API key rides on this trial",
    owner: "Jason Morgan",
    next_review_on: null,
  },
  {
    account_seed_key: seedKeyForSlug("resend"),
    title: "Resend — sending domain not yet verified",
    reference: "gmail-crosscheck §2.2",
    state: "open",
    next_action: "Verify the sending domain (DNS records) or the app cannot send from the custom domain",
    owner: "Jason Morgan",
    next_review_on: null,
  },
  {
    account_seed_key: seedKeyForSlug("etrade"),
    title: "E*TRADE — primary-email confirmation outstanding (Oct 9, 2026)",
    reference: "gmail-crosscheck §2.4",
    state: "open",
    next_action: "Confirm the primary email address",
    owner: "Jason Morgan",
    next_review_on: null,
  },
  {
    account_seed_key: seedKeyForSlug("venmo"),
    title: "Venmo — finish setup",
    reference: "gmail-crosscheck §2.4",
    state: "open",
    next_action: "Finish setting up the account (prompted Apr 10, 2025)",
    owner: "Jason Morgan",
    next_review_on: null,
  },
  {
    account_seed_key: seedKeyForSlug("finelo"),
    title: "Finelo — repeated email confirms, setup unclear",
    reference: "gmail-crosscheck §2.4",
    state: "open",
    next_action: "Confirm whether the account was ever completed (Mar + Aug 2026 confirms)",
    owner: "Jason Morgan",
    next_review_on: null,
  },
  {
    account_seed_key: seedKeyForSlug("vestwell"),
    title: "Vestwell — retirement-plan registration outstanding",
    reference: "gmail-crosscheck §2.4",
    state: "open",
    next_action: "Complete the registration (May 6, 2026)",
    owner: "Jason Morgan",
    next_review_on: null,
  },
];

// ---------------------------------------------------------------------------
// Deliberately NOT seeded. Keeping this list visible here is the honest
// record — the seed does not invent or smuggle these in.
// ---------------------------------------------------------------------------
export const SEED_EXCLUSIONS = [
  "Pure entertainment / loyalty accounts (streaming, rewards, store loyalty) — out of scope for a register of work-relevant accounts.",
  "MIT-created apps (App Inventor / Scratch / Media Lab and the several MIT research signups Jason named Nov 17) — ZERO hits in jasonmorgan99@gmail.com; likely under another email. Open recovery gap: find the mailbox, then seed them.",
  "Competitor-research accounts Claude created that he cannot recall (Jason, Nov 17) — recoverable only from the Gmail signup trail; seed them when identified, never from memory.",
  "Any account whose only evidence is 'Jason mentioned it once' with no mail, no login, and no workspace — it stays out until there is something to verify.",
];

// ---------------------------------------------------------------------------
// Assembly.
// ---------------------------------------------------------------------------
const ALL_SEED_CANDIDATES = [
  ...SPREADSHEET_ROWS,
  ...BRIEF_FAMILY_ROWS,
  ...CONNECTOR_AND_GAP_ROWS,
];

/** The full idempotent seed set, sorted by seed_key for determinism. */
export function buildSeedCandidates() {
  return [...ALL_SEED_CANDIDATES].sort((a, b) =>
    a.seed_key < b.seed_key ? -1 : a.seed_key > b.seed_key ? 1 : 0,
  );
}

export { buildSeedCandidates as getSeedCandidates };

/** Seed threads, keyed to the candidates above. */
export function buildSeedThreads() {
  return SEED_THREADS.map((thread) => ({ ...thread }));
}
