# FORGE Capture — Rung 0 Threat Model & Data-Flow Diagram

**Date:** 2026-09-20 · Companion to `RUNG0_AUDIT.md`
**Scope note (2026-09-20):** FORGE Capture is a standalone, general-purpose desktop
utility. FORGE integration is an optional destination. The threat model below treats
the standalone utility as the primary product.

## 1. Trust boundaries

1. **User's machine (standalone utility)** — trusted for local-first editing; untrusted
   for integrity of hostile image input (metadata bombs, decompression abuse).
2. **FORGE web app (Next.js)** — trusted; enforces auth and RLS. Only involved when
   the user explicitly chooses "Save to FORGE".
3. **Supabase (Postgres + Storage)** — trusted store; RLS is the enforcement point.
   Only involved via explicit user action.
4. **Capture targets (websites, applications, screens)** — untrusted content sources;
   scrolling capture must not execute or persist anything from the target beyond pixels.
5. **Share-link recipients (Rung 5)** — untrusted; bearer-link scope only.

## 2. Data-flow diagram

```
  ┌──────────────────────────────────────────────────────────────┐
  │  STANDALONE DESKTOP UTILITY (primary product — no account)   │
  │                                                              │
  │  launch: independent / global shortcut / tray                │
  │                                                              │
  │  ┌────────────┐   ┌──────────────────┐   ┌────────────────┐  │
  │  │  Capture   │──►│  Rung-1 Editor   │──►│ Local save /   │  │
  │  │  sources:  │   │  core (Canvas 2D,│   │ clipboard /    │  │
  │  │  region,   │   │  local-first)    │   │ export PNG/JPG │  │
  │  │  window,   │   │                  │   │ (redactions    │  │
  │  │  monitor,  │   │  annotations +   │   │  flattened,    │  │
  │  │  scrolling │   │  source image    │   │  unrecoverable) │  │
  │  │  (Rung 2), │   │  kept DISTINCT   │   └────────────────┘  │
  │  │  flow      │   └──────────────────┘                       │
  │  │  (Rung 3)  │                                              │
  │  └────────────┘   explicit "Save to FORGE" ONLY (opt-in)     │
  └──────────────────────────────────────────────────────────────┼──┐
                                                                 │  │ HTTPS, only
                                                                 │  │ on explicit
                                                                 ▼  │ user action
                        ┌─────────────────────────────────────────┐│
                        │  FORGE (optional destination)           ││
                        │  Next.js API → auth → owner_id RLS →    ││
                        │  Storage bucket; signed URLs; audit     ││
                        │  events (metadata only, NO pixels)      ││
                        └─────────────────────────────────────────┘┘

  HARD BANS (architectural, not settings):
  - No automatic upload. No background sync.
  - No analytics capture of user content (pixels, OCR, annotations,
    typed content, filenames, capture metadata).
  - No background surveillance: every capture requires an explicit,
    visible user action; a persistent indicator shows while capturing.
```

Local-first invariant: **nothing crosses the HTTPS boundary without an explicit,
visible user action** ("Save to FORGE", "Share", "Export"). There is no background
sync, no auto-upload, no telemetry of capture content, and no capture without the
user invoking it.

## 3. Threats & mitigations

| # | Threat | Rung | Mitigation |
|---|---|---|---|
| T1 | Credential/secret visible in a capture gets uploaded or shared | 1–5 | Source-time exclusion preferred (auth-pause drops frames at the source); permanent blackout/redaction flattened on export; human review gate before any share; block sharing while sensitive-content findings are unresolved |
| T2 | Redaction is reversible (annotation layer shipped instead of flattened pixels) | 1 | Source image and annotation objects stored distinctly in the project; **export flattens redactions into pixels**; tests prove unrecoverability |
| T3 | Hostile image (metadata bomb, decompression bomb, polyglot) | 1 | Dimension + memory caps; metadata stripped on import; malformed project versions rejected safely; fuzz-ish corrupt-input tests |
| T4 | Silent/background capture or recording | 2–4 | Capture requires explicit user action; persistent visible indicator; no hidden recording; cancel/stop always available |
| T5 | Cross-workspace access to library items | 5 | `owner_id = auth.uid()` RLS on every table + storage path scoping `${user.id}/…`; hostile cross-workspace tests, not just happy paths |
| T6 | Share link leaks beyond intended recipient | 5 | Expiring, revocable links; public sharing off by default; download controls; audit events on share/revoke |
| T7 | Analytics exfiltration of capture content | 1–5 | Allowlist analytics policy; editor never emits capture-derived properties; privacy page already excludes recordings/clicks/typed text |
| T8 | Replay/automation misused against consequential systems | 7 | Replay disabled by default behind kill switch; hard ban on payments/banking/ledgers/leases/tenant/scheduling mutations; immutable execution receipts; research-only until separately authorized |
| T9 | Native companion becomes a privilege-escalation path | 2 | Companion is an authenticated client with user-scoped tokens only; no service keys on device; stops capture on display-geometry change if coordinates can't be trusted |
| T10 | LLM sees captured PII/financial data | all | No LLM calls in capture, markup, redaction, or replay control loop (architectural ban, not a filter) |
| T11 | Supply-chain: copyleft/unclear-licensed capture code | 0 | License matrix (RUNG0_LICENSE_MATRIX.md); no GPL/AGPL/SSPL in the dependency tree; MIT notices preserved in THIRD_PARTY_NOTICES.md where reuse occurs |
| T12 | Standalone tool abused for surveillance (background/scheduled capture of another user's screen) | 2–4 | Architectural ban: every capture requires an explicit, visible user action by the operator; persistent on-screen indicator while capturing; no scheduled, triggered, or background capture modes exist in the product; no remote-initiated capture API |
| T13 | Scrolling capture exfiltrates or executes target content | 2 | Scrolling paths capture pixels only; no script execution from the target in the stitching pipeline; DOM-assisted path runs with the user's own browser permissions; incomplete-capture reporting instead of silent partial data |

## 4. Privacy properties (by design)

- **Standalone-first:** the desktop utility works fully with no FORGE account and no
  sign-in. Local-first is not a fallback mode — it is the primary mode.
- **Local-first:** capture, editing, redaction, and project save work with no server.
- **Explicit upload:** "Save to FORGE" is a deliberate action; the library remains usable
  without cloud storage.
- **Two artifacts:** raw session and approved derivative are stored as different
  artifacts; sharing operates on the approved derivative only.
- **Retention:** local retention + secure deletion defined before Rung 5 ships
  (capture addendum to the Data Retention Policy).
- **No keylogging:** flow capture records click/scroll/drag events with timestamps and
  accessibility roles — never raw passwords, secret-field values, unrelated clipboard
  content, microphone audio, or background applications.
