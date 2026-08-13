# FORGE Capture Integration — Investigation Plan
**Purpose:** Determine what Mimik's existing architecture gives us for free, what needs adapting, and what's genuinely FORGE-specific — before any Claude Code session touches production code. This is a planning document only; nothing here should be built yet.

---

## 1. What Mimik actually is (verified against the live repo, Aug 2026)

Mimik (`github.com/westpoint-io/mimik`, MIT license, 79 stars) is a **Manifest V3 browser extension**, not a standalone app — built with:
- **WXT** (browser-extension build framework)
- **React + TypeScript**
- **Dexie** (a wrapper around IndexedDB) for local storage
- **Biome** for linting, **Vitest** for tests
- pnpm workspace layout (`src/`, `tests/`, `public/`, `patches/`)

### Its actual pipeline, piece by piece:
| Piece | How Mimik does it |
|---|---|
| **Capture** | A content script injected into the page listens for clicks, keystrokes, drag events, clipboard actions, and SPA route changes. Click interception fires *before* navigation, so nothing is lost on page transitions. Rapid clicks/keystrokes are merged into single logical steps. |
| **Screenshot + annotation** | Per step, it captures a screenshot and auto-frames/highlights the clicked element — no manual cropping. |
| **AI description (optional)** | Does **not** send screenshots to the AI. It extracts ~100 tokens of structured DOM context (page title, form, heading, sibling inputs) around the clicked element and sends *that* text to a BYO OpenAI/Anthropic key. This is why it's cheap and language-configurable. |
| **Redaction** | Regex-based auto-blur for emails, phones, SSNs, credit cards, IPs, MACs — plus a manual click-to-blur picker for anything else, applied across every screenshot where that element appears. |
| **Storage** | Everything (guides, steps, screenshots, DOM contexts) persists to a single local Dexie/IndexedDB database. No backend, no account, no telemetry. |
| **Export** | HTML (self-contained, base64 images), PDF (print-ready), Markdown — all generated client-side from the same stored data. |
| **Replay ("Guide Me")** | Walks a live page, highlighting the next element to click, using the same captured step data. |

**Key takeaway:** Mimik is a *browser extension* that watches a page from the outside. It has no concept of your app's internal state, your route names, your business objects, or your governance/evidence system — because it can't see any of that. Everything it captures is DOM-level (clicks, elements, screenshots), not FORGE-level (workspace, module, entity, ledger event).

---

## 2. What FORGE already has that Mimik doesn't need to provide

From what's already built in `marketplace409`:
- A layered architecture (`src/forge-os/`, `src/application/`, `src/infrastructure/`) with governance and evidence contracts
- An existing **evidence/session-snapshot system** (`SessionSnapshotBuilder`, `AcceptedEvidenceReference`, `EvidenceRecord`) built specifically to capture "what objectively happened" without letting automation guess intent
- A **contracts/events pattern** (`ForgeEvent.js`, `LifecycleTransitionEvent`) already designed for exactly the kind of structured, typed event Mimik's blog post gestures at with its "semantic event" example (`workspace: property, module: hvac, action: create_system...`)
- Supabase as the actual backend — so "local-only, no backend" (Mimik's core design constraint) is *not* a constraint FORGE needs to inherit

This matters because it changes the shape of the integration: FORGE doesn't need a browser extension's local-storage architecture at all. FORGE already has a server, a database, an event system, and an evidence/governance layer that's *more rigorous* than what Mimik needs for its own use case (a standalone Chrome extension with no backend).

---

## 3. Component-by-component: reuse, adapt, or build fresh

| Component | Verdict | Why |
|---|---|---|
| Click/keystroke/navigation capture logic | **Adapt the pattern, don't reuse the code** | Mimik's capture runs as a content script isolated in extension-land; FORGE would want this as in-app instrumentation (a React hook or event listener wired into existing components), which is architecturally different even if the event-merging *logic* (dedupe rapid clicks, collapse keystroke bursts) is worth studying and porting conceptually. |
| Screenshot + auto-framing | **Reuse the approach, likely swap the mechanism** | Extension-based screenshot capture (`chrome.tabs.captureVisibleTab`) isn't available to a normal web app. FORGE would need `html2canvas`/`dom-to-image`-style in-page capture, or a server-side headless-browser screenshot service if capture needs to happen outside the user's live session. This is the single biggest technical unknown — flag for investigation. |
| Redaction (regex + manual picker) | **Directly portable concept, straightforward to rebuild** | Small, self-contained, no extension-specific APIs involved. Given FORGE's data (tenant PII, payment info, ledger entries), this is not optional — it should be scoped as a hard requirement, not a nice-to-have, before any real workflow is recorded. |
| AI step descriptions from DOM context, not screenshots | **Directly reusable strategy** | This is a smart, cheap pattern worth adopting as-is: extract structured context, not pixels. FORGE's existing AI-manager pattern (already has a service layer calling AI providers) is a natural fit. |
| Local IndexedDB storage | **Not applicable** | FORGE already has Supabase. Guides/steps/screenshots should live there, scoped to the owner, consistent with everything else in the app. |
| Export (HTML/PDF/Markdown) | **Reusable concept, FORGE-native implementation** | Straightforward client-side generation from stored step data; no dependency on Mimik's code. |
| Guide Me replay | **Defer** | Genuinely useful eventually (training/onboarding), but it's the most speculative piece and not needed for the nearer-term use cases (engineering evidence, bug reports, release docs) that motivated this whole idea. |
| Semantic FORGE events (`workspace/module/action/entity`) | **This is the real FORGE-native work, no Mimik equivalent exists** | Mimik has no idea what a "property" or "ledger entry" is — it only sees DOM elements. Mapping a raw click to a meaningful FORGE-domain event is 100% new design work, and it's also the part that makes this more valuable than just installing Mimik standalone. |

---

## 4. Licensing check
Mimik is **MIT licensed** — permissive, allows copying/adapting code into a proprietary product with attribution retained, no copyleft obligations. If the decision is ever "port some of their actual code" rather than "reimplement the pattern," MIT makes that legally straightforward. (Confirmed directly against the repo's `LICENSE` badge and the maintainer's own posts — not just assumed from the earlier doc.)

---

## 5. Minimum viable integration (if this is ever greenlit)
Not everything in the original strategy doc's 8-slice sequence needs to happen for there to be value. The smallest version that's still genuinely useful:

1. **In-app capture hook** — a lightweight instrumentation layer on key FORGE workflows (not a browser extension) that logs a semantic event (workspace/module/action/entity/result) plus a DOM-context snapshot, following the existing `ForgeEvent` contract pattern.
2. **Screenshot capture** — resolve the extension-vs-in-app screenshot question first; this blocks everything downstream.
3. **Redaction pass** — mandatory before any screenshot touches storage, given the data involved.
4. **Storage** — new Supabase table(s), owner-scoped, following existing evidence/governance patterns rather than a parallel storage system.
5. **A single export path** (Markdown is simplest) to produce one real "How to record a tenant payment"-style guide, as a proof of concept.

Everything past that (AI descriptions, replay mode, PDF/HTML export, training-guide generation) is real future value but not required to prove the concept works.

---

## 6. Open questions to resolve before writing any code
- Can FORGE capture a usable screenshot from inside a normal web page (no extension permissions), or does this require a different mechanism (headless browser, server-side render capture)?
- Does semantic event capture live as a cross-cutting concern (a hook every component opts into) or does it piggyback on FORGE's existing event/governance emission points?
- Who is the guide for, first — Jason himself (engineering evidence) or an eventual property-manager end user (training/support)? These have different urgency and different data-sensitivity profiles.
- Where does this sit relative to FORGE's existing evidence/governance boundary — is a captured guide itself a form of `EvidenceRecord`, or a new, separate concept?

---

## 7. Recommended sequencing
Per your stated priorities, this stays **parked** behind: (1) closeout dashboard work finishing and shipping, (2) rental-manager/Stripe path stabilizing, (3) Agent Coordination Kernel resumption. This document exists so that whenever it *does* get picked up, the first Claude Code session can start from "here's what's reusable and what's genuinely new" instead of a cold read of Mimik's repo.

When ready, the first Claude Code session should still be **inspection-only** — no production code — focused on resolving the screenshot-capture open question (§6) first, since it blocks the rest of the design.

---

## 8. Addendum — Inspection findings (Aug 12, 2026)

Inspection-only pass against the live `marketplace409` repo, resolving §6 Q1 and checking §1/§3's claims about existing FORGE contracts against the actual code.

### §6 Q1 resolved: screenshot capture without extension permissions

**Answer: in-page DOM-to-canvas rendering** (`html2canvas`, or the more actively maintained `html-to-image` fork lineage). Neither is currently installed (checked `package.json` — stack is Next.js 16.2.6 / React 19.2.4, no Vite). This is the standard mechanism used for "export as image" features generally: it walks the live DOM and paints it onto a `<canvas>`, entirely client-side, no permission prompt, no extension APIs.

The two alternatives considered don't fit FORGE's actual requirement — silent, automatic capture at the moment of a real event, inside the user's live authenticated session:
- **`getDisplayMedia` (Screen Capture API)** — pixel-perfect, but browsers force a native picker dialog *every time a capture stream starts*, and this cannot be silently pre-authorized or persisted across page loads. Disqualifying for auto-capture-per-click.
- **Server-side headless browser (Puppeteer/Playwright)** — captures a URL you construct, not the DOM state the user is actually looking at mid-workflow (open modal, filled form, etc.), unless session state is separately serialized and replayed server-side — a materially different, larger problem than what Mimik's design solves.

**Known risk to spike-test before committing:** DOM-to-canvas fidelity breaks on some CSS (filters/shadows), cross-origin images without CORS headers, and any canvas/video/iframe content. Recommend a short spike rendering a real FORGE page with a modal + table before deciding.

### Correction — §1/§3's `ForgeEvent` field claim is wrong

The doc's `workspace: property, module: hvac, action: create_system...` semantic-event shape does **not** exist in FORGE today. Actual contracts, read directly from the repo:

| Contract | File | Actual payload fields |
|---|---|---|
| `ForgeEvent` | `src/forge-os/contracts/v1/events/ForgeEvent.js` | `{ eventId, eventType, timestamp, actorIdentity, correlationIdentity, data }` |
| `LifecycleTransitionEvent` | `src/forge-os/contracts/v1/events/LifecycleTransitionEvent.js` | `{ eventId, eventType, transitionId, lifecycleDomain, contextVersion, correlationIdentity, evidenceReferences }` |

A workspace/module/action/entity shape doesn't exist anywhere yet — it would need to be designed as a new event type, most likely nested inside `data`. This is still "100% new design work" as §3 concluded, just starting from a different actual baseline than the doc described.

### Correction — §5's storage plan is more solved than assumed

`src/application/property-evidence/PropertyEvidenceApplication.js`, backed by the `property_evidence` Supabase table (migration `supabase/migrations/20260808000600_create_property_evidence.sql`), already implements almost exactly what screenshot-evidence storage needs:
- Private bucket (`property-evidence`) with signed URLs (`createSignedUrl`), not public URLs
- RLS scoped by `owner_id`
- MIME-type validation that already allows `image/jpeg` / `image/png` (alongside `application/pdf`)
- Byte-size cap (10MB), `review_status`, `extraction_method` / `parser_version` tracking

§5 item 4 ("new Supabase table(s), owner-scoped, following existing evidence patterns") should read as **extend `property_evidence`'s pattern** rather than build a fresh table — this is the single most reusable thing found in the inspection.

Also confirmed: `EvidenceRecordContract` (`src/forge-os/contracts/v1/evidence/EvidenceRecord.js`) has a generic `artifacts: []` array with no explicit binary field, so a screenshot *reference* (bucket path, not raw bytes) fits without any contract change. `SessionSnapshotBuilder` (`src/forge-os/session/SessionSnapshotBuilder.js`) was confirmed to be pure metadata assembly today — no DOM/screenshot logic lives there, so none would need to be preserved or worked around.

### Fidelity spike — `html-to-image` (Aug 12, 2026)

Ran a live spike against `/forge/developer` (FORGE Programmer Dashboard — a real page with both a card/list view and a genuine in-page modal, opened via its "Review & run" flow). No repo code was changed: `html-to-image@1.11.11` was loaded from a CDN (`esm.sh`) directly in the browser console against the running dev server, `toPng(document.documentElement, { pixelRatio: 1 })` was called with the modal open, and the result was compared against a native Chrome screenshot of the same state. The modal was cancelled afterward without approving/running anything.

**Result: high fidelity, no visible defects.** Text, colored status badges (pill borders), dark code-preview blocks, the orange "Proposed" inline text, button styling (solid dark primary button vs. outlined secondary buttons), the dimmed backdrop, and the modal's drop shadow all rendered correctly and matched the live page. As a bonus, `toPng` on `document.documentElement` captured the entire scrollable document in one shot (2122×1100), not just the visible viewport — useful for a "capture everything relevant to this step" evidence use case, though it means the real capture code should probably scope to a specific container element (e.g. just the modal, or just the changed region) rather than the whole document, to keep evidence images focused and avoid unrelated background chrome (sidebar icons, unrelated cards) leaking into every screenshot.

No CORS/cross-origin-image, filter/shadow, or font-rendering defects turned up on this page. This was one page with fairly standard CSS (flex/grid layout, solid colors, simple borders) — it doesn't rule out fidelity issues on pages with heavier CSS (backdrop-filter blur, complex gradients, third-party embedded widgets like Stripe Elements or Plaid Link), which should be spot-checked before this is treated as fully general.

**Conclusion:** §6 Q1 is resolved with a positive result, not just a theoretical one — `html-to-image` is viable for FORGE's in-app capture use case.

### Fidelity spot-check — Stripe/Plaid embedded widgets (Aug 12, 2026)

Attempted to test the two real embedded-widget pages in the app: `/forge/rental/portal` (Stripe `PaymentElement`, via `TenantPaymentForm.jsx`) and `/forge/connections` (Plaid Link, via `PlaidConnectButton.js`). Neither would actually mount in this dev environment, for reasons unrelated to the capture library — noted here rather than worked around, since fixing either is a separate task:
- **Stripe**: no `STRIPE_SECRET_KEY` / `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` in `.env.local`, and the payment-session route additionally requires seeded DB rows (linked `rental_tenants`, active lease, unpaid charge, an enabled `landlord_payment_accounts` Stripe Connect row) that don't exist for this account.
- **Plaid**: sandbox keys *are* present, but `POST /api/plaid/link-token` returned `400 INVALID_LINK_CUSTOMIZATION` — the Plaid Dashboard's Data Transparency Messaging use case isn't configured for this account. This is a Plaid account-configuration gap, not a code or capture-library issue.

Rather than leave the question untested, ran a substitute test that isolates the actual mechanism at stake: **both widgets render as cross-origin iframes by design** (that's their PCI/security boundary — the host page is never allowed to script or read their contents). So the real question is "how does `html-to-image` handle a cross-origin iframe," which doesn't require either integration to be working. Injected a genuine cross-origin iframe into a live FORGE page (pointed at `127.0.0.1:3000` instead of `localhost:3000` — different origin, confirmed via a thrown `contentDocument` access from the parent — but with real, visually-rendered content and no `X-Frame-Options` blocking it, unlike the first attempt with an external site).

**Result: the cross-origin iframe is silently dropped from the capture — not rendered as a blank box, just absent entirely**, with the page content that would be behind/around it showing through uninterrupted, and no error or warning in the browser console. The native Chrome screenshot of the same state clearly shows the iframe's content and its border; the `html-to-image` output shows neither.

**Implication for the capture design:** if a screenshot is taken while a user has a Plaid Link modal or Stripe Payment Element open, the resulting "evidence" image will not show a blank placeholder where the widget was — it will look as if the widget was never there at all, with whatever's underneath showing through. For evidence/governance purposes this is a real gap, not a cosmetic one: a captured step showing "user pays rent" could silently omit the actual payment form. Any real implementation needs to either (a) detect when the capture target contains a cross-origin iframe and visibly flag/skip that step rather than silently produce a misleading image, or (b) special-case those specific flows (Plaid Link, Stripe Elements) to capture a static description/placeholder instead of attempting a pixel capture at all. This should be treated as a hard requirement for the capture design, not an edge case — payment and bank-connection flows are exactly the kind of step this feature would most want to document reliably.

### Fidelity spot-check — backdrop-filter blur and gradients (Aug 12, 2026)

Tested the two remaining CSS cases flagged as untested in the first spike. Confirmed FORGE's actual usage first: `backdrop-blur` appears in exactly one place in the codebase — the mobile sticky header in `ForgeApplicationRail.jsx` (`bg-white/95 backdrop-blur`, computed as `blur(8px)` over 95%-opacity white), gated to viewports under Tailwind's `lg` breakpoint. Gradients are more widespread — hero banners (`bg-gradient-to-r from-blue-950 to-red-700`), the Forge executive dashboard hero (`from-slate-900 to-slate-950`), and, notably, the desktop Forge sidebar background, a 5-stop `linear-gradient(90deg, #111827 0%, #334155 18%, #94a3b8 38%, #475569 52%, #0f172a 100%)`.

The live app's browser window sizing became unreliable mid-session in this environment (viewport dimensions drifted unpredictably between calls, unrelated to FORGE or the capture library — likely an artifact of the automation tooling), which made a same-scale native-vs-capture comparison of the real mobile header impossible to trust. Rather than report an inconclusive result, isolated the exact same real CSS values (the sidebar's actual 5-stop gradient, plus a `blur(10px)`/55%-white glass panel matching the header's approach) in a small fixed-size synthetic element injected into a fresh tab, and compared a native Chrome screenshot against an `html-to-image` capture of that element at 1:1 scale.

**Gradients: high fidelity, no defects.** Both the FORGE sidebar's real 5-stop gradient and a separate vivid 3-stop test gradient rendered identically between native and captured versions — smooth, correct color stops and angle, matching the result from the first spike.

**`backdrop-filter`: silently under-rendered.** In the native browser render, the glass panel over a busy striped background comes out as a completely flat, uniform color — the blur fully obscures the pattern beneath, as expected. In the `html-to-image` capture of the identical element, faint diagonal banding from the underlying stripe pattern is visible *through* the panel — the library applies the panel's semi-transparent color as a simple alpha composite but does not perform the actual blur. No console error or warning was produced in either the browser or during capture — same silent-failure pattern as the cross-origin iframe case.

**Implication for the capture design:** low real risk for FORGE specifically, since the only current `backdrop-blur` usage (the mobile sticky nav header) sits over plain page background, not sensitive content — a slightly-wrong translucency effect there is cosmetic. But this should be treated as a known, permanent limitation of the DOM-to-canvas technique generally (not a bug to fix later): any future UI that uses `backdrop-filter` to visually obscure something (e.g. a "blur to redact" treatment, or a glassmorphism panel over live financial data) would need its own dedicated redaction step *before* capture, since `html-to-image` cannot be relied upon to actually hide what's behind a blurred panel — it will show a dimmed but legible version instead.

### Net effect on open questions (§6)

- Q1 (screenshot mechanism) — **fully resolved**, not just theoretically. Three live spikes ran against real FORGE pages and isolated real CSS values: (1) a genuine modal+table view — text, badges, buttons, shadows all high fidelity; (2) a substitute cross-origin-iframe test standing in for Plaid Link/Stripe Elements (both blocked in this dev environment by missing keys/seed data and a Plaid Dashboard config gap, unrelated to the library) — the iframe was **silently dropped from the capture entirely**, no blank placeholder, no console error; (3) FORGE's real gradients (high fidelity) vs. `backdrop-filter` blur — **silently under-rendered**, showing an unblurred, dimmed composite instead of an actual blur, again with no error. `html-to-image` is viable and the default answer for FORGE's capture mechanism, but it has two known silent-failure modes that any real implementation must account for, not just a generic "fidelity may vary" caveat.
- Q2 (cross-cutting hook vs piggyback on existing emission points) — still open; now easier to reason about since the real `ForgeEvent`/`LifecycleTransitionEvent` shapes are known.
- Q3 (who's the guide for first) — still open, unaffected by this pass.
- Q4 (is a captured guide an `EvidenceRecord` or separate concept) — leans toward **reusing `EvidenceRecord`**, now that its `artifacts: []` field is confirmed generic enough and a matching storage pattern (`property_evidence`) already exists. The two silent-failure modes from Q1 sharpen this: if a captured guide becomes governance-grade evidence, a silently-incomplete screenshot (missing a payment widget, or misrepresenting a blurred panel as merely dimmed) is a correctness problem for the evidence record itself, not just a UX rough edge — reinforces that this can't be a "best effort" capture path if it's going to sit inside the evidence/governance layer.

### New open question — capture reliability detection (raised by the fidelity spikes)

Both silent-failure modes found above (cross-origin iframes, `backdrop-filter`) fail the same way: the capture *looks* complete and produces no error, but is quietly wrong. Before this is built for real, worth deciding: does the capture path need a pre-flight check (e.g. scan the target subtree for cross-origin iframes or `backdrop-filter` usage and flag/skip those steps) rather than trusting `html-to-image`'s output at face value? Given Q4 leans toward these captures becoming real `EvidenceRecord`s, silently-wrong evidence seems like the one failure mode worth explicitly designing against rather than discovering later.
