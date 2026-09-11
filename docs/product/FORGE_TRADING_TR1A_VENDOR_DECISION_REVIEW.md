# FORGE Trading TR-1A: Market-Data / Security-Master Vendor Decision Review

**Status:** Research and decision preparation only. No vendor account, terms acceptance, payment,
subscription, credential request, secret, ingestion code, schema, migration, or TR-1A implementation
occurred while producing this document. No vendor was contacted.
**Prepared:** 2026-09-11, against `origin/main` @ `1348d048f50d4fa401ee6d3d543c4d8d5b5d32ef` (includes
merged PR #160, TR-0.5's ledger-authority resolution).
**Supersedes/extends:** `docs/product/FORGE_TRADING_TR0_DISCOVERY_AND_CONTRACTS.md`'s §5 vendor
research — that research is independently re-verified below, not merely restated, and one materially
stronger candidate it did not evaluate (Intrinio) is added.

---

## 1. Independent re-verification of TR-0's findings

TR-0 recommended Massive (formerly Polygon.io) based on research dated 2026-09-10. Each of TR-0's
three original candidates was re-fetched directly from its current official page today
(2026-09-11) rather than trusted from the prior write-up.

**Massive** ([massive.com/stocks](https://massive.com/stocks), accessed 2026-09-11) — **confirmed,
unchanged.** Individual tiers (Basic/free → Advanced $199/mo) are explicitly "licensed for personal
and non-professional use." The page states verbatim: *"For brokerage, redistribution,
customer-facing display, or 200+ users, you'll need a Business plan."* Business plan: **$2,499/mo**,
"Commercial & display rights included," real-time FMV + end-of-day SIP, 20+ years history. Reference
data confirmed to include FIGI identifiers, corporate actions (splits/dividends/IPOs back to 2008).
TR-0's $2,499/mo minimum-for-display finding holds exactly.

**Twelve Data** ([twelvedata.com/pricing](https://twelvedata.com/pricing), accessed 2026-09-11) —
**confirmed, with one new ambiguity surfaced.** Plans remain scoped to "personal, internal, and
non-commercial purposes." However, this re-fetch surfaced tier-label language TR-0's write-up did not
quote: Basic is labeled "Internal non-display usage," **Grow ($29/mo) is labeled "Internal display
data access,"** and Ultra is labeled "Internal non-display data access." **This is a genuine new
ambiguity, not a resolved finding in FORGE's favor** — "internal display" most plausibly means display
to your own internal/employee users, not to FORGE's own paying tenants and investors, who are external
end users of a commercial product. The overarching "non-commercial purposes" restriction on the same
page cuts against reading "internal display" as covering customer-facing display. Marked **yellow**,
not green — this specific phrase needs a direct vendor answer before Twelve Data could be selected at
$29/mo (see §6 draft inquiry). No published commercial/display price was found, matching TR-0.

**Alpha Vantage** ([alphavantage.co/premium](https://www.alphavantage.co/premium/), accessed
2026-09-11) — **confirmed, unchanged.** No redistribution, commercial-use, or display-licensing
language exists anywhere on the pricing page, and no linked Terms of Service was found from this page.
This remains a genuine information gap, not a favorable silence.

## 2. New candidate found: Intrinio (materially stronger than all three TR-0 candidates on price)

**Intrinio** ([intrinio.com/pricing](https://intrinio.com/pricing), accessed 2026-09-11) was not
evaluated in TR-0. It is a materially stronger candidate on the one dimension that matters most for
TR-1A's budget: **published, self-service commercial display pricing at roughly one-eighth of
Massive's Business tier.**

- **Individual** ($150/mo): explicitly "No redistribution or display" — same shape as Massive's
  individual tiers, not usable for FORGE's need.
- **Startup**: **explicit "Commercial Use and Display Rights,"** priced **$333/mo for the first 6
  months, $666/mo for the next 6 months, $999/mo thereafter** (billed quarterly). This is a
  *published* self-service price, not a "contact sales" figure.
- **Enterprise** ($1,250/mo+): everything in Startup plus more.
- All three tiers include 15-minute delayed US equity data (CBOE One feed) with **"No exchange fees
  or paperwork."**
- Reference data: US Fundamentals ("Company Reference & Metadata"), Adjustment Factors (i.e. adjusted
  historical prices) are included at Startup. **Corporate Actions (as a distinct event feed — earnings
  dates, investor days, splits/dividends events) is Enterprise-only ($1,250/mo+), not included at
  Startup.** Active/delisted status was not explicitly confirmed on this page — marked unresolved.
- Free trial available (no sandbox environment explicitly mentioned).

**A second candidate checked and ruled out**: **EODHD**
([eodhd.com/commercial-pricing](https://eodhd.com/commercial-pricing), accessed 2026-09-11). Its
"Internal Use" tier ($399/mo) *explicitly forbids* the exact thing FORGE needs — the page states
verbatim: *"Displaying the data or sharing it with individuals outside your company is not
permissible under this package."* Its Enterprise tier is $2,499/mo (same price as Massive Business,
no cost advantage) and this pricing page did not confirm explicit external-display rights at that
tier. **Red** — the published affordable tier is a clear contractual mismatch for FORGE's use case,
and the tier that might work costs the same as the existing best option with less confirmed evidence.

---

## 3. Verified comparison table

| Dimension | Massive | Twelve Data | Alpha Vantage | Intrinio |
|---|---|---|---|---|
| **1. Plan for TR-1A use** | Business | Grow (ambiguous) or higher | Unknown — no display tier found | Startup |
| **2. Price** | $2,499/mo | $29/mo published; real commercial price unknown | $49.99+/mo (development only; display cost unknown) | $333→$666→$999/mo (ramping), published |
| **3. Permits authenticated-user display?** | 🟢 Yes, explicit, at Business tier | 🟡 Ambiguous — "Internal display" label, unclear if it covers external customers | 🔴 Unknown — no language found at any price | 🟢 Yes, explicit, at Startup tier |
| **4. Redistribution/derived display/caching/history/multi-user** | Business tier: yes, explicit | Not confirmed at any published tier | Not confirmed | Startup: display yes; redistribution/caching terms not explicitly itemized on pricing page — unresolved |
| **5. Exchange fees / attribution / audit** | Not confirmed on pricing page | Not confirmed | Not confirmed | **"No exchange fees or paperwork"** explicitly stated — strongest confirmed answer of the four |
| **6. Quote delay** | 15-min (Starter+), real-time (Advanced+/Business) | Real-time claimed even on Basic (per-tier by market) | 15-min via separate "Alpha X Terminal" entitlement process | 15-min (CBOE One), all tiers |
| **7. Security-master coverage** | Strong: FIGI IDs, splits/dividends/IPOs to 2008 | Dividends/splits/earnings/IPO calendar across tiers | Not detailed in this research pass | Fundamentals + adjustment factors at Startup; **corporate-actions event feed is Enterprise-only** |
| **8. Sandbox/trial, limits, streaming** | Free tier no card required | Free tier, 800 req/day, limited WebSocket | 25 req/day free | Free trial available; no sandbox explicitly mentioned |
| **9. Self-service price or sales-gated?** | Self-service published ($2,499) | **Sales-gated** for real commercial use | **Sales-gated** (undocumented) | **Self-service published** |
| **10. Lock-in / cost growth** | Flat $2,499/mo regardless of symbol count (good for a 10-20 symbol slice — no per-symbol scaling penalty) | Unknown until negotiated | Unknown | Ramps to $999/mo by month 13; flat thereafter; corporate-actions upgrade path to $1,250/mo+ if needed later |

## 4. Minimum-compliant-plan table (actual legal cost of TR-1A, not the cheapest listed price)

| Vendor | Cheapest plan that actually authorizes FORGE's display use | Real monthly cost |
|---|---|---|
| Massive | Business | $2,499/mo |
| Twelve Data | Unknown — Grow's "Internal display" wording is unresolved, not confirmed compliant | Unknown (≥$29/mo if resolved favorably, otherwise a sales-negotiated figure) |
| Alpha Vantage | None found | Unknown, needs vendor contact |
| Intrinio | Startup | $333/mo (months 1-6), $666/mo (months 7-12), $999/mo thereafter |

## 5. Red/yellow/green licensing-risk assessment

- **Massive: 🟢 Green.** Explicit, unambiguous, published display-rights language at a known price.
- **Twelve Data: 🟡 Yellow.** Genuine ambiguity in the vendor's own tier-label wording ("Internal
  display data access" vs. an overarching "non-commercial purposes" restriction). Needs a direct
  vendor answer before use, not an inference either way.
- **Alpha Vantage: 🔴 Red** for immediate selection, not because display is forbidden but because
  **no licensing information exists to evaluate at all.** Selecting it today would mean displaying
  data under an unknown license — that is itself the failure mode this review exists to prevent.
- **Intrinio: 🟢 Green** for the display-rights question specifically (explicit, published, at a
  known price), **🟡 Yellow** for corporate-actions coverage specifically (Enterprise-only, not
  included at the Startup tier this recommendation is based on — TR-1A's own scope says corporate
  actions are needed, so this is a real, separate gap to resolve, not a blocking license risk).
- **EODHD: 🔴 Red** for its affordable tier (explicitly forbids external display); its viable tier is
  no cheaper than Massive with less confirmed evidence.

## 6. Recommendation

- **Preferred provider: Intrinio (Startup plan).** Explicit, published, self-service commercial
  display rights at $333/mo ramping to $999/mo — roughly one-eighth to one-third of Massive's
  Business tier for the same core permission, with "no exchange fees or paperwork" explicitly
  stated (the strongest fee-transparency answer of any candidate researched). The one real gap is
  corporate-actions event data being Enterprise-only ($1,250/mo+) — for a ~10-20 symbol TR-1A slice,
  this can likely be handled by starting with adjustment-factor-based pricing (included at Startup)
  and deferring live corporate-action *event* tracking, or by getting written confirmation from
  Intrinio on exactly what "Adjustment Factors" already covers before assuming a gap exists.
- **Acceptable fallback: Massive (Business plan), $2,499/mo.** Unambiguous licensing with the
  strongest confirmed security-master depth (FIGI, 20+ years, explicit corporate actions included at
  the Business tier itself, not gated further). Choose this if Intrinio's corporate-actions gap
  turns out to matter for TR-1A after direct clarification, or if Jason prefers the vendor TR-0
  already vetted over a newly-discovered one.
- **Reject: Alpha Vantage** (no licensing information exists — cannot be legally relied upon without
  a direct answer that doesn't yet exist) **and EODHD's affordable tier** (explicitly forbids the
  exact use FORGE needs; its viable tier offers no advantage over Massive).
- **Can TR-1A legally begin on a free or trial tier today? No.** Every free/trial tier examined across
  all five vendors is either explicitly non-display (Massive, EODHD's forbidden tier) or has no
  display-rights language published at all (Alpha Vantage) or is ambiguous (Twelve Data). Treating a
  free-tier start as "safe for now, upgrade later" would be building TR-1A on data FORGE may not have
  had the right to display in the first place — this is itself a 🔴 red risk, not a green one, despite
  how tempting a free start is for a 10-20 symbol proof-of-concept.

## 7. Capabilities that must remain provider-neutral in FORGE

Per the architecture plan's §5.1 (Market Data as its own bounded context, owning "time-stamped,
provenance-tagged quotes/bars") and principle #7 ("provider integrations must be replaceable"), the
following must never be hard-bound to any one vendor's specific shape, regardless of which is
selected:

- Instrument identity — FORGE's own internal `trading_instruments.id` is canonical; a vendor's own
  identifier (Massive's FIGI, Intrinio's internal ID, etc.) is stored as a mapped, provider-specific
  reference, never used as the row's own primary key.
- Quote/bar shape — normalize into FORGE's own schema (§6 of the architecture plan) at ingestion time,
  not read directly in vendor response shape anywhere past the ingestion boundary.
- Corporate-action representation — splits/dividends normalized into FORGE's own event shape
  regardless of whether the source vendor calls it "Corporate Actions," "Adjustment Factors," or
  something else.
- Rate-limit/entitlement handling — retry/backoff and entitlement-check logic lives in the
  vendor-specific adapter, never leaks into the domain layer.
- Pricing-tier assumptions — nothing in the domain model should assume "15-minute delay" or "EOD
  only" as a hardcoded constant; store the actual delay/provenance per quote (already required by §6),
  so a future vendor swap with different timeliness doesn't require a schema change.

## 8. Draft vendor-sales inquiry (NOT sent — for the Twelve Data ambiguity)

> Subject: Clarifying "Internal display data access" on the Grow plan
>
> We're evaluating Twelve Data for a small (10-20 symbol) delayed/EOD equity data feature inside our
> own SaaS product, where the data would be visible to our own authenticated paying customers (not
> just our internal employees). Your Grow plan ($29/mo) is labeled "Internal display data access,"
> while the plan tier descriptions also reference "personal, internal, and non-commercial purposes."
> Could you clarify whether "internal display" permits displaying delayed/EOD quote data to our
> product's own external, authenticated end users, or whether that specific use case requires a
> different (commercial) license and, if so, what that costs?

## 9. The decision Jason needs to make, in plain language

**Recommended choice: Intrinio's Startup plan.** It's the only option researched that combines
(a) an explicit, published, written right to show real market data to FORGE's own users, with
(b) an actually affordable price for a first small slice — **$333/month for the first six months,
$666/month for the next six, $999/month after that** — versus Massive's flat **$2,499/month**, which
is the next-cheapest option with equally clear licensing.

**The trade-off**: Intrinio's cheaper tier doesn't include a dedicated corporate-actions event feed
(stock splits/dividend announcements as their own trackable data) — that's an Enterprise-only feature
there, at $1,250/month. Massive includes it at its own $2,499/month Business tier. For a first slice
of 10-20 well-known large-cap stocks, this gap is probably tolerable at first (adjusted historical
prices, which already account for past splits, are included at Intrinio's Startup tier) — but it's a
real limitation to know about going in, not a surprise later.

**What genuinely cannot be resolved from public documentation alone**: Twelve Data's $29/month tier
looks tempting but its own licensing language is ambiguous about whether it covers showing data to
your customers versus just your own team — this needs a direct question to their sales team (drafted
above, not sent) before it could be trusted at that price.

**Bottom line choice**: pay ~$333-999/month now for a licensed feature (Intrinio), or ~$2,499/month
for one with a bit more built-in coverage and the vendor this program already vetted first (Massive).
Free tiers are not a safe way to start this feature regardless of which vendor is chosen.
