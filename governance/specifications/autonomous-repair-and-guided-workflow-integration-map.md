# FORGE Brain Autonomous Repair and Guided Workflow — Integration Map

## Status

Phase AR-0 + GW-0 read-only repository inspection, complete. **Phase GW-1 (Guided Workflow Engine
foundation), complete** -- see Section 6. **Phase AR-1 (Repair Controller foundation), complete** -- see
Section 7. **Phase GW-2 (state-aware first-tenant readiness), complete** -- see Section 9. GW-1 and AR-1
were committed and merged to `main` as PR #54 (merge commit `97d41db3e8657ac64a453187f2a27d9dff62b56c`)
before GW-2 began. GW-2 itself stops here for owner review -- no commit, push, merge, deploy, or
migration has occurred for it. AR-2 (autonomous incident diagnosis) has explicitly not been started, per
instruction.

A note on how this document is being kept current: `scripts/governance/generateValidationEvidence.mjs`
(the real entry point for the deterministic governance updater's synchronized-document pipeline)
requires the checked-out branch to literally be `main` -- it's built for session closeout and the
scheduled nightly refresh, not a mid-build checkpoint on a feature branch. So this specification
document itself is being kept as the durable, human-readable record of decisions and progress for this
work, consistent with Section 9's instruction to keep continuing architecture and progress in the
authoritative handoff documents -- once this branch reaches `main`, the deterministic updater's own
governance-state/session-snapshot pipeline picks up cleanly from there, unmodified by anything below.

Source specification: `FORGE_BRAIN_AUTONOMOUS_REPAIR_DESIGN.md` (owner + ChatGPT, proposed architecture, owner approval required before implementation).

This document is evidence and analysis only. It does not implement the Autonomous Repair Controller or Guided Workflow Engine, grant either subsystem any authority, mutate production or landlord records, or commit/push/merge/deploy/migrate anything. No application code was changed to produce this document.

## Overlap check

Checked `gh pr list --state open` and `git branch -r` at inspection time. Two open PRs exist (`fix/simplifi-mixed-account-safety`, a draft Vercel Analytics install) and ~20 recent branches, none related to repair automation or landlord guidance. **No duplicate or overlapping work exists for either subsystem.**

---

## 1. Shared Forge Brain knowledge boundary

Both subsystems are specified to consume Forge Brain's source-cited knowledge without inheriting each other's authority. Forge Brain already exists (built earlier this session, 5 phases, merged to `main`) and is the right shared substrate:

- **Query engine**: `scripts/engineering-brain/query/runQuery.mjs` — deterministic, ranked, citation-bearing (`source_path`, `symbol_or_section`, `authority_level`, `commit_sha`, `content_hash`, `confidence`), never fabricates when evidence is insufficient. This is precisely the "recommendations, not authority" contract Section 1 of the design doc requires of Forge Brain.
- **Persistence**: `scripts/engineering-brain/persistence/` — Supabase-backed, RLS-gated to the single programmer email, `is_forge_programmer()`.
- **Reference API pattern**: `src/app/api/forge/engineering-brain/query/route.js` — session-based auth (not service-role), 404-not-403 on unauthorized. Any future Repair Controller diagnostic stage that needs cited context should call through this same query engine rather than re-querying git or re-deriving citations.

Forge Brain today has no write path, no mutation capability, and no execution capability — it already satisfies "cannot directly commit, merge, deploy, change secrets, or mutate production data" by construction, not by added restriction.

---

## 2. Autonomous Repair Controller

### What already exists to reuse

- **The deterministic governance updater** (the doc's repeatedly-referenced "existing authoritative FORGE handoff/governance documents" mechanism): `scripts/governance/synchronizeAuthoritativeGovernance.mjs`, dispatched via `scripts/governance/dispatchGovernanceMode.mjs` → `scripts/governance/runGovernancePipeline.mjs`. Real CLI entry points already wired into CI: `scripts/governance/generateValidationEvidence.mjs`, `scripts/governance/verifyShadowGovernance.mjs`, `scripts/governance/reconcileGovernanceRefresh.mjs` (all three invoked from `.github/workflows/forge-governance-refresh.yml`), plus `scripts/orchestration/runEngineeringConversationSession.mjs` for session bootstrap generation.
- **Protected-section synchronization** (Section 9's "do not overwrite reviewed sections"): `scripts/governance/replaceSyncSection.mjs` — `FORGE:SYNC:<sectionId>:START/END` HTML-comment markers delimit machine-updatable regions inside otherwise human-owned documents; `replaceSyncSectionContent()` only ever touches content between markers and throws if a section id isn't found. This is the literal mechanism to reuse for repair-evidence writeback — it already exists and is battle-tested by the governance refresh automation.
- **Isolated-worktree precedent**: this session's own working pattern (`.claude/worktrees/<name>`, one branch per unit of work, full gate before any push) is a live example of exactly the "temporary worktree lifecycle" Phase AR-3 specifies. No new mechanism needs to be invented; it needs to be made agent-drivable instead of Claude-session-driven.
- **Existing CI validation surface**: `npx vitest run`, `npm run build`, `npx eslint` are the established focused/broad/build validation layers already used for every change this session — the Repair Controller's validation pipeline (Section 6.F) should shell out to these same commands, not reimplement test running.

### What does not exist (confirmed, no duplication risk)

`grep`-checked for `RepairIncident`, `RepairManifest`, `RepairAuthorityPolicy`, `repairId`, `incidentId` across `scripts/` and `src/` — zero matches. No incident/manifest/authority/evidence schema, no collector, no diagnostic orchestrator, no diff-policy evaluator, no authority engine exists anywhere in the repository today. Phase AR-1 starts from nothing, not from a partial implementation.

### Where new code would belong

Following Engineering Brain's own placement precedent (deterministic, non-UI, script-driven capability lives in `scripts/`, not `src/`): propose `scripts/repair-controller/` for the incident/manifest/evidence/policy schemas, the deny-by-default authority evaluator, and the dry-run CLI — mirroring `scripts/engineering-brain/`'s internal shape (flat modules + a `query/`-style subdirectory for evaluation logic + `__tests__/`).

---

## 3. Guided Workflow Engine

### What already exists to reuse

- **Owner/actor authorization split — already load-bearing in Rental Manager, not merely available.** `src/lib/supabase/resolveEffectiveOwnerId.js` (JS) and `has_workspace_access()` / `resolve_effective_owner_id()` (SQL, `supabase/migrations/20260829000100_add_workspace_authorization_helpers.sql`) are already the mechanism `createAuthenticatedRentalManagerApplication.js` uses to distinguish acting user from canonical workspace owner, and Rental Manager's RLS/RPCs were fully converted onto it (`20260829000300`–`20260829001400` migration series, per GW-0 research). A Guided Workflow session's `actingUserId`/`canonicalOwnerId` split (Section 12's `GuidedWorkflowSession` contract) should call through the same `createAuthenticatedRentalManagerApplication()` factory — or a sibling factory of identical shape — rather than deriving ownership independently. This is the single strongest reuse point found in the entire inspection.
- **A ready-made, non-mutating GW-1 prototype candidate**: `src/application/rental/buildRentalDashboardSummary.js` already computes a prioritized, severity-scored `needsAttention[]` queue (overdue rent, urgent maintenance, missing insurance, missing deposits, missing move-in inspections, expiring leases, vacancies, unsettled payments, open support) with `{id, severity, score, label, detail, destination}` per item, rendered today by `src/components/forge/ForgeNeedsAttentionQueue.jsx`. This is functionally "Today's priorities" (Section 12) already built as a dashboard widget. Per the design doc's own instruction ("preferably Review what requires attention today, or another workflow confirmed complete by inspection"), **this is the recommended GW-1 prototype** — it is read-only today, so a guidance layer over it inherits that non-mutating property for free, and no new business logic needs to be invented for the first slice.
- **Content-authoring pattern worth reusing (not the interaction pattern)**: `src/components/forge/rental/rentalHelpContent.js` + `RentalHelpModal.jsx`, and the identical `schedulingHelpContent.js` + `SchedulingHelpModal.jsx` pair, both separate plain-data step/section content from a dumb rendering component. Reuse this authoring shape for `GuidedWorkflowStep.instruction`/`.explanation` content. Their *interaction* pattern (static "?" reference modal, no highlighting, no sequencing, no completion tracking) is confirmed **not** prior art for step-by-step guidance — that capability does not exist anywhere in the codebase today.

### Real gaps this inspection found (not assumptions — confirmed absent)

- **No semantic UI target registry exists.** No `data-forge-guide`-style convention anywhere. Existing `data-*` attributes are real but inconsistent: function-level (`data-active-function`), panel-level (`data-rental-setup`), and a handful of item-level ids (`data-attention-item`, `data-metric-tile`). Phase GW-1's semantic target registry is genuinely new work, not a wrapper around something existing.
- **Roughly half of Rental Manager's "add" forms have no distinguishing `aria-label`** (add unit, add tenant, add lease all unlabeled; record payment, add contractor, add deposit are labeled). Any GW-2/GW-3 workflow targeting these forms needs labeling work first.
- **"Property Passport" is a product-glossary term (`docs/product/FORGE_PRODUCT_GLOSSARY.md`), not code.** Rental Manager's Maintenance panel (`RentalMaintenancePanel.jsx`) is lease/unit/tenant-scoped; the separate `/forge/property` application (condition, HVAC, valuations, operating costs) has no code path connecting a maintenance request to a property-level record. The design doc's instruction to attach maintenance to Property Passport describes a linkage that must be built, not one that's assumed already wired.
- **Reconciliation is self-declared partial** (`RentalReconciliationPanel.jsx`'s own on-page disclaimer: fees/payouts not yet ingested) and **rental activity does not appear on the cross-app `/financial-snapshot` dashboard** — only within Rental Manager's own summary panel. A "reconcile rent payments" guided workflow (listed in Section 12's initial workflow list) would currently have to guide toward a feature that documents its own incompleteness.
- **Rental Manager is a single-page app with 20 client-side panel swaps, not per-function routes.** A semantic target cannot be reached by URL/deep-link alone; the guidance session controller must drive `activeFunctionId` state directly, which has implications for how "open or direct the user to the correct section" (Section 12, interaction contract step 3) gets implemented.

### Where new code would belong

Guided Workflow Engine is UI-facing landlord product surface, unlike the Repair Controller — propose `src/domains/guided-workflow/` for the workflow/step/session schemas and state evaluators (matching this repo's existing `src/domains/*` convention, e.g. `src/domains/workspace-membership/`), plus `src/components/forge/rental/guided-workflow/` for the coach-overlay UI, kept inside Rental Manager's own component tree since GW-1's prototype workflow lives entirely inside Rental Manager.

---

## 4. Separation of permissions

Per Section 1's mandatory boundary ("knowledge must never imply permission"), concretely for this codebase:

- Both subsystems may depend on Forge Brain's read-only query engine and on `resolveEffectiveOwnerId`/`has_workspace_access` for identity resolution — these are read-only and carry no mutation authority themselves, so shared use does not create a permission leak.
- `scripts/repair-controller/` must never import anything from `src/domains/guided-workflow/` or vice versa. Neither subsystem's code should be reachable from the other's entry point.
- The Repair Controller's authority engine and the Guided Workflow Engine's workspace-state evaluators must remain two separate deterministic decision points with two separate policy files — no shared "confidence" or "authority" value should ever flow from one subsystem into the other.
- Guided Workflow's `requiresExplicitConfirmation` (landlord-facing) and the Repair Controller's owner-approval gate (engineering-facing) are analogous in shape but must stay implemented as two independent gates, not a shared confirmation component with a mode flag — the design doc's Section 4 protected-operations list (RLS, financial logic, migrations, secrets, tenant data) applies to the Repair Controller; it has no bearing on and must not be relaxed by anything the Guided Workflow Engine does.

---

## 6. GW-1 — Guided Workflow Engine foundation (complete)

Built on branch `explore/forge-brain-repair-and-guided-workflow-ar0-gw0`, uncommitted per the standing "do not commit, push, merge, deploy, or migrate" constraint for this thread.

**Contracts** — `src/domains/guided-workflow/guidedWorkflowContracts.js`: versioned (`GUIDED_WORKFLOW_SCHEMA_VERSION`), runtime-validated, fail-closed shapes for `WorkflowDefinition`, `WorkflowStep`, `GuidedWorkflowSession`, `EvaluatorResult`, and `SemanticTarget`, matching Section 12's TS types plus the two contracts it implies but doesn't name. A consequential step is rejected at validation time unless `requiresExplicitConfirmation` is also true — enforced at the contract layer, not left to each workflow author.

**Semantic target registry** — `src/domains/guided-workflow/semanticTargetRegistry.js`: `createSemanticTargetRegistry()` fails closed on a duplicate `targetId` (an authoring mistake, caught at construction/test time); `resolveSemanticTarget()` never throws on a missing target, returning a safe `{ found: false, reason: "missing_target" }` instead, so a coach overlay can stop guidance gracefully rather than crash. Matches Section 12.B exactly.

**The "Today's priorities" prototype** — `src/domains/guided-workflow/todaysPrioritiesWorkflow.js`: wraps the existing, real `buildRentalDashboardSummary()` → `needsAttention[]` computation (recommended in Section 5 above) in a static, versioned, 9-step workflow definition (one step per possible `needsAttention` id, in that function's own fixed severity order). Applicability is entirely state-driven — a step is `required` only if its id is present in a freshly recomputed `needsAttention` array from real fetched data, `not_applicable` otherwise. Every step is `informational`, needing no confirmation — fully non-mutating.

**Session controller** — `src/domains/guided-workflow/advanceGuidedWorkflowSession.js`: pure, framework-free `start`/`advance`/`goBack`/`pause`/`resume`/`exit` functions. `advance()` and `goBack()` both require a freshly supplied `evaluatorResults` snapshot and re-derive what's still relevant from it every time — a bare call can never mark a step complete without a real evaluation behind it, which is what makes "a click alone cannot complete a step" true regardless of what UI calls it. `resume()` rejects a workflow-version or workspace mismatch from when the session was paused.

**UI** — `src/components/forge/rental/guided-workflow/`: `useTodaysPrioritiesSession.js` (the fetch → evaluate → session-state hook, reusing the exact `/api/rental` + `/api/rental/reports` fetch pattern `RentalOverviewPanel.jsx` already uses), `RentalTodaysPrioritiesPanel.jsx` (one item at a time, severity-styled to match `ForgeNeedsAttentionQueue.jsx`, with Back/Pause/Resume/Exit guidance and a "Why does this matter?" toggle backed by `todaysPrioritiesExplanations.js`, the same plain-data-file pattern as `rentalHelpContent.js`). Wired into Rental Manager as a new "Today's Priorities" nav entry (`RentalApplicationShell.jsx`, function id `guide`) — reachable, not just built.

**Acting-user/canonical-owner preservation** — `src/app/api/rental/route.js`'s existing GET handler now also returns `actingUserId`/`canonicalOwnerId` (from `authenticated.user.id`/`authenticated.effectiveOwnerId`, both already computed by `createAuthenticatedRentalManagerApplication()` for every other purpose on that route) so the client-side session can be started with real identity without deriving its own scoping. No new authorization mechanism was introduced.

**Semantic targets added** — none new; the registry is populated from the 9 `needsAttention` ids, which already exist as `data-attention-item` values in `ForgeNeedsAttentionQueue.jsx`. New, scoped `data-guided-workflow-*` attributes were added only to the new panel's own controls (step card, Back/Pause/Resume/Exit/Why/Next). No sweep of Rental Manager's other forms was performed, per instruction.

**Gate**: 69 new tests (60 domain, 8 panel, 1 route, plus updated existing `RentalApplicationShell.test.jsx`/`route.test.js` assertions to match) — all passing. Full suite at the time GW-1 alone was complete: 4984/4984 passing. Clean production build. Clean lint on every new/changed file (one pre-existing, untouched lint finding remains in `RentalApplicationShell.jsx`, unrelated to this change).

**Deferred, not forgotten** (documented gaps per instruction, not repaired inside GW-1): the Property Passport ↔ maintenance linkage (§3) and reconciliation's self-declared incompleteness (§3) remain exactly as found — GW-1 guides toward the existing Maintenance/Reconciliation panels as they are today, making no claim that either gap is closed.

**Known local-dev-only limitation, found during smoke testing**: this worktree's `.env.local` has no `STRIPE_MODE`, so `/api/rental/reports` 500s locally — confirmed this is pre-existing and environmental, not a GW-1 regression, since the unmodified `RentalOverviewPanel` fails identically with the same error message against the same local server. This did surface a real design finding worth reviewing in a later phase, recorded here rather than fixed now (out of scope per "do not begin GW-2"): `useTodaysPrioritiesSession.js` currently treats `/api/rental/reports` as a hard dependency — both fetches must succeed or the whole session fails to start — even though only 2 of the 9 `needsAttention` categories (`overdue-forge`, `externally-managed`) actually read anything from the `report` argument `buildRentalDashboardSummary()` already handles as optional. Today's Priorities doesn't need Stripe/report availability to function for the other 7 categories; that coupling is an unnecessary reliability dependency, not a requirement of the design.

---

## 7. AR-1 — Repair Controller foundation (complete)

Built on the same branch, kept as a distinct, non-overlapping change set from GW-1 — confirmed no file under `scripts/repair-controller/` imports anything from `src/domains/guided-workflow/` or `src/components/forge/rental/guided-workflow/`, and vice versa.

**Contracts** — `scripts/repair-controller/repairContracts.mjs`: versioned (`REPAIR_CONTRACTS_SCHEMA_VERSION`), runtime-validated, fail-closed shapes for `RepairIncident`, `RepairManifest`, `RepairEvidence`, `RepairAuthorityPolicy`, plus `RepairApproval` and `RepairDecision` — the two contracts Sections 6.H and 10 describe in prose but the document's TS types don't literally name. `validateRepairManifest` rejects an `effectiveAuthority` exceeding `requestedAuthority` at the contract level. `validateRepairAuthorityPolicy` rejects any `defaultLevel` other than `1` outright — a policy file claiming a higher default is malformed input, not merely unusual, which is what makes "policy cannot promote itself" a structural fact rather than a convention. `validateRepairEvidence` rejects any command entry not already marked `redacted: true`. Also adds `computeManifestHash()` (reused from `scripts/engineering-brain/hashContent.mjs` rather than reimplemented), what an approval record binds to.

**Protected-operation classification** — `scripts/repair-controller/protectedOperationClassifier.mjs`: `classifyProtectedPath()` normalizes a path (lower-case, `..`-resolved, backslash-normalized) before matching against Section 4's categories (migrations, RLS/authorization, financial/Stripe logic, secrets/credentials, tenant/lease/insurance records, cron, dependency manifests, and — reflexively — the Repair Controller's and governance updater's own code). Verified directly against rename/case/traversal bypass attempts, per Section 14's explicit test requirement. `classifyTestIntegritySignals()` covers test deletion, newly-skipped tests, lowered coverage thresholds, and removed validation steps as a separate, independently testable signal (no diff-scanning executor exists yet to produce these signals automatically — this operates on stats a future phase would supply).

**Authority evaluator** — `scripts/repair-controller/evaluateRepairAuthority.mjs`: deterministic, deny-by-default, consumes manifest + policy + diff/test/validation/approval/circuit-breaker state, returns exactly one validated `RepairDecision` with non-empty reason codes. Gate order: protected paths and self-flagged protected domains always escalate first, unconditionally; then test-integrity signals; then file/line budgets; then the circuit breaker; then approval binding (manifest hash + base SHA + expiration, all three, per Section 10); then validation results, with an ambiguous/missing field escalating rather than being treated as passing, and a failed build overriding a passing focused-test result rather than the reverse. **`AUTHORITY_CEILING_THIS_VERSION = 2` is enforced inside the evaluator itself** — even a manifest/policy pair requesting level 4 with a valid approval can never produce `create_pr`, `merge`, `deploy`, or `rollback` in this version; the evaluator structurally cannot decide those regardless of input, which is the concrete mechanism behind "no code-editing executor, Git mutation, PR creation, credentials, deployment, migration, or production integration" rather than that capability simply not existing yet.

**Dry-run entry point** — `scripts/repair-controller/dryRunRepairAuthorityCli.mjs`: reads a single fixture-shaped scenario JSON file (manifest/policy/changedPaths/validationResults/approval/circuitBreakerState), validates it through the real contracts, prints the decision and reason codes as text or `--json`. Verified as a real subprocess (`node scripts/repair-controller/dryRunRepairAuthorityCli.mjs --scenario <file>`), not only through its exported function — confirmed it never mutates the scenario file or anything else on disk.

**Tests** — 78 tests across four files, organized around the user's requested categories: permitted (prepare-for-review on a clean pass, and confirmed the evaluator never outputs `create_pr`/`merge`/`deploy`/`rollback` even under a maximally permissive fixture policy), blocked (failed build overrides a passing focused test, new-vs-baseline failures distinguished, budget overrun, circuit breaker on both attempt count and open-repair count), protected (a protected path always escalates regardless of passing validation; cannot be bypassed by case/traversal; a manifest that self-flags a protected domain escalates even with no protected path touched; a prompt-injection-style string planted in the manifest's own free-text `objective`/`hypothesis` fields produces an identical decision and reason codes to a clean manifest, since the evaluator only ever reads structured/enum fields), ambiguous (a required validation field simply never supplied escalates rather than being assumed to pass; an unknown repair class defaults to diagnose-only, not reject or escalate), and malformed (a missing policy defaults to reject, not diagnose — "no mutation" per Section 14). Owner-approval binding got its own focused block: missing, expired, base-SHA-mismatched, and manifest-changed-after-approval all invalidate identically.

**Gate**: 78 new tests, all passing. Full suite (combined with GW-1): 5062/5062 passing. Clean production build. Clean lint on every file in `scripts/repair-controller/`.

**Explicitly not built in AR-1** (per instruction, and confirmed absent from this change set): no code-editing executor, no Git worktree/branch mutation, no PR creation, no external credentials, no deployment, no Supabase migration, no production integration. The manifest, evidence, and approval contracts exist and are fully validated, but nothing in this repository yet produces or consumes them outside the evaluator's own tests and the dry-run CLI — that wiring (collectors, the diagnostic orchestrator, the isolated executor) is Phase AR-2/AR-3, not this one.

---

## 8. Pre-commit verification (owner-requested checkpoint)

Performed after both foundations were complete, before any commit. Results below.

**Background-process check**: found one lingering `next start -p 3922` process (PID checked, `next-server v16.3.0`, running since Aug 20). Confirmed via `/proc/<pid>/cwd` it serves a completely different worktree (`impact-site-verification`), is production-mode `next start` (a static server, not a file-watcher or build process), and has no path back to this worktree. No risk to this branch's files or validation.

**Rental API security review** (`src/app/api/rental/route.js` and its auth chain):
- Authentication is required: `createAuthenticatedForgeApplication()` calls `supabaseClient.auth.getUser()` and returns a 401 (`response` field) on any auth error or missing user id; `createAuthenticatedRentalManagerApplication()` short-circuits on that `response` before any query runs, and before `actingUserId`/`canonicalOwnerId` are ever computed.
- `actingUserId`/`canonicalOwnerId` cannot expose another workspace: both derive exclusively from the server-verified session (`user.id` from `auth.getUser()`), never from any client-supplied parameter. `resolveEffectiveOwnerId()` queries `workspace_members` scoped to `member_user_id = actorUserId` (the authenticated user's own id, hardcoded at the call site) `AND status = 'active' AND role = 'co_owner'`, and is additionally covered by RLS (`workspace_members_self_select`, `member_user_id = auth.uid()`) as defense in depth.
- Primary-owner/co-owner resolution is correct: a caller with no active co-owner membership row gets `effectiveOwnerId = actorUserId` (primary owner, own data); an active co-owner gets the `owner_id` of the single workspace they belong to. Matches the SQL-side `resolve_effective_owner_id()` exactly, by design (same migration, same logic, never allowed to disagree).
- No tenant-facing route receives landlord identity unintentionally: confirmed no file under `src/app/forge/rental/portal/` or `src/app/api/rental/portal/` fetches `/api/rental` or imports `createAuthenticatedRentalManagerApplication` — the tenant portal uses its own separate `createAuthenticatedTenantPortalApplication()` factory throughout.

**Visual/manual smoke test** (local dev server, authenticated as the real landlord account):
- Nav entry opens correctly: "Today's Priorities" appears in the Overview group next to Summary, and clicking it renders the panel.
- Local dev server: blocked by the pre-existing `STRIPE_MODE` gap described above (confirmed environmental, not a GW-1 bug, since the unmodified `RentalOverviewPanel` fails identically). Per owner direction, this PR's Vercel Preview deployment (already-configured environment variables, no Stripe gap) was used for final authenticated visual verification instead, after the PR was opened.
- **Real priorities render, verified against the live Preview with a real authenticated landlord session**: "Priority 1 of 6", real severity icon and label ("Reconcile balances still authoritative in Rentec.", "9 charges still authoritative in Rentec."), matching real `needsAttention` data from `/api/rental` + `/api/rental/reports`.
- **"Why does this matter?" verified**: reveals the real explanation text for the current step on click.
- **Pause/Resume verified**: Pause shows a clean "Guidance paused." state with a Resume control; Resume returns to the exact same step, preserving session state.
- **One-step guidance / Next verified**: clicking Next shows a "Checking…" state (confirming a fresh fetch + re-evaluation, not a cached click), then advances to a genuinely different real item ("Priority 2 of 6", "Plan renewals or move-outs for leases expiring within 30 days.").
- **Back verified**: returns to the prior step exactly, and correctly disables itself again at the first step.
- **Exit guidance verified**: shows "Guidance exited." with a "Start again" control; Start again re-fetches and correctly resumes at Priority 1.
- **Open verified**: navigates to the exact correct destination panel for the current item (confirmed: the "reconcile Rentec balances" item's Open button landed precisely on Rentec Payment Import, with the nav sidebar reflecting the new active item) — a real navigation, no data mutated.
- **Light and dark mode both verified**: full re-render in both themes with correct contrast on every element (card, buttons, severity icon, explanation text); toggling mid-session preserved state.
- Missing semantic targets fail safely: covered by `semanticTargetRegistry.test.mjs`'s dedicated tests (`resolveSemanticTarget` never throws on a missing id) — not separately re-tested live, since it requires an artificial missing-target condition not present in real data.
- No guidance action mutates landlord records: structurally true for this workflow — every step is `informational`, `requiresExplicitConfirmation: false`, and the panel issues only `GET` requests (`/api/rental`, `/api/rental/reports`); confirmed by reading the panel/hook source and by observing only `GET`s during the live Preview session.
- Mobile viewport, zoom, and keyboard access: **not independently browser-verified** — the available browser-automation resize did not actually change the captured viewport in this environment (a tooling limitation, not an app behavior finding). The panel's markup uses semantic buttons/labels and the same responsive Tailwind conventions as every other Rental Manager panel, but this specific claim rests on that consistency, not a direct observation.

**AR-1 dry-run demonstrations** (real subprocess runs, `node scripts/repair-controller/dryRunRepairAuthorityCli.mjs`, scenario files deleted after use):
1. Permitted Level 2 preparation → `decision: prepare_for_review`, `reasonCodes: ["validation_passed_prepared_for_review"]`.
2. Protected RLS/migration/payment change (a fictional migration touching `rental_payments` RLS) → `decision: escalate`, `reasonCodes: ["protected_domain_touched", "database_migration", "authorization_or_rls", "financial_logic"]`.
3. Missing policy → `decision: reject`, `reasonCodes: ["missing_policy_no_mutation"]`.
4. Policy allowing Level 4 *and* a valid, correctly-bound owner approval explicitly granting Level 4 → still `decision: prepare_for_review` (Level 2), never `create_pr`/`merge`/`deploy` — the version cap held even against a real approval requesting more.

**Integration map accuracy check**: found and corrected one real error during this pass — §6's test count said "78" but its own parenthetical (60 domain + 8 panel + 1 route) summed to 69; fixed to state 69 correctly. §7's "78" for AR-1 and the "5062" combined full-suite figure were independently re-verified against fresh `npx vitest run` output and are accurate.

**Gate re-run**: no source files changed during this review (only `.env.local` was inspected, not modified, and the dev server was stopped afterward) — the full suite, build, and lint results already recorded in §6/§7 remain current. Re-ran the full suite once more directly before committing: 5062/5062 passing, clean build, clean `git diff --check`.

---

## 9. GW-2 — State-aware first-tenant readiness (complete)

Built on a fresh branch, `feat/gw2-first-tenant-readiness`, branched from `origin/main` at merge commit
`97d41db3e8657ac64a453187f2a27d9dff62b56c` (the merged GW-1 + AR-1 PR #54) — not on the stale
pre-merge branch, per instruction. AR-2 was explicitly not started in this slice. Three checkpoints,
each separately gated.

### Checkpoint 1 — Production reality and screening-language review

**Production verification**: confirmed `origin/main` contains merge commit
`97d41db3e8657ac64a453187f2a27d9dff62b56c`. Vercel production deployment confirmed healthy. Brief
authenticated smoke test of Today's Priorities performed as primary owner and, where practical,
co-owner, against the live deployment.

**TransUnion/SmartMove screening-language finding**: inspected every tenant-screening UI surface and
related documentation for any claim that TransUnion or SmartMove is a FORGE partner, affiliate, or
endorsed provider. **Zero mentions of TransUnion or SmartMove branding exist anywhere in the
repository.** `rental_tenants.screening_provider` is a free-text, neutral field with no hardcoded
provider name, no partner badge, no "powered by" language, and no endorsement claim anywhere in the
tenant-screening UI. "Use another screening provider" is preserved as-is (it was never removed or
narrowed). **No code change was made for this finding** — existing UI already complies with every
constraint the owner described (no implied partnership, SmartMove may remain as a neutral external
option, no SSN/DOB/credit-report/criminal-record collection claimed as a FORGE capability) and no
correction was needed.

**A separate, real gap found as a side effect of this same review, not assumed**: `rental_tenants` had
a `date_of_birth` column that the API's `update-tenant-profile` write path and
`RentalTenantPanel.jsx`'s profile-edit form both actively read from and wrote to, despite the owner's
"do not collect SSNs, birth dates, credit reports, or criminal-record data" instruction. Tenant
*creation* (`mapRentalTenantToRow` in `rental-tenant.mapper.ts`) already structurally could never write
a birth date (whitelist mapper, no spread of caller input) — the real, only gap was the *update* path
and the UI. **Fix, scoped exactly to owner-approved Option 1**: removed the date-of-birth `<Field>`
from `RentalTenantPanel.jsx`'s profile-edit form; removed `date_of_birth` from `route.js`'s GET
`.select(...)` column list; removed `date_of_birth: optional(profile.dateOfBirth)` from the
`update-tenant-profile` write object, replaced with a comment explaining that omitting the key (not
setting it to `null`) leaves any existing legacy value on a real row completely untouched. **No
migration was added or run** — the dormant `date_of_birth` column and any values already stored in it
are explicitly *not* touched, and are recorded here as a future privacy-review item, per instruction.
5 new regression tests added (1 in `rental-tenant.persistence.test.ts` proving `mapRentalTenantToRow`
never writes a birth date even given a runtime object carrying an extra `dateOfBirth` property; 2 in
`route.test.js` proving the GET query never selects `date_of_birth` and that `update-tenant-profile`
silently ignores a `dateOfBirth` payload field without erroring or writing it; 2 in
`RentalTenantPanel.test.jsx` proving the field never renders, even for a legacy tenant record that
still carries a stored `date_of_birth` value). The stored last-four-SSN field (`ssn_last_four`) was
independently reviewed and found already fully compliant (`/^\d{4}$/` validation rejects a full
9-digit SSN, and an existing test already asserts the update payload never contains
`social_security_number`) — left untouched, as explicitly instructed, pending a separate owner review
of that field specifically.

### Checkpoint 2 — Removing the Today's Priorities reliability bottleneck

**The bug** (found and documented in GW-1's own §6 "Known local-dev-only limitation" note, fixed here):
`useTodaysPrioritiesSession.js` fetched `/api/rental` and `/api/rental/reports` via a single
`Promise.all`, so a report-service failure failed the *entire* Today's Priorities session — even
though only 2 of the 9 `needsAttention` categories (`overdue-forge`, `externally-managed`) actually
derive anything from the reports endpoint; the other 7 are fully independent of it.

**Fix — a genuinely new evaluator status, not an overload of an existing one**:
`EVALUATOR_RESULT_STATUS.UNAVAILABLE` was added to `guidedWorkflowContracts.js`, distinct from
`NOT_APPLICABLE` — it means "this step's data source failed to load, so its real requiredness is
unknown," never "checked and fine." `skipReasonCodeForStatus()` in
`advanceGuidedWorkflowSession.js` gives it its own `"unavailable"` reason code (never reusing
`"not_applicable"` or `"already_complete"`), and a new generic, workflow-agnostic helper,
`sessionHasUnavailableSteps(session)`, lets a UI layer distinguish an honestly-clean COMPLETED session
from one that reached COMPLETED only by skipping past one or more unavailable steps.
`todaysPrioritiesWorkflow.js` gained `REPORT_DEPENDENT_STEP_IDS` (the exact, source-verified two-id set)
and `buildTodaysPrioritiesEvaluatorResults(..., { reportsAvailable })`, which forces exactly those two
steps to `UNAVAILABLE` when `reportsAvailable` is false, leaving the other seven evaluated normally
against real data.

**UI**: `useTodaysPrioritiesSession.js`'s `fetchSummaryAndIdentity()` now fetches `/api/rental` (still a
hard requirement) and `/api/rental/reports` independently — a reports failure is caught internally and
turned into `{ reportsAvailable: false, reportsError }` state, never a thrown error that blocks the
session. `RentalTodaysPrioritiesPanel.jsx` renders a calm, non-alarming partial-data notice with a
Retry control whenever `reportsAvailable` is false, and the panel's "Nothing urgent right now." message
is now gated behind `!hasUnavailablePriorities` (a COMPLETED session with an unavailable step instead
shows "No other priorities right now, but some categories couldn't be checked") — satisfying "never
display Nothing urgent while any required priority source is unavailable" structurally, not by
convention. Retry (`retryReports`) re-runs a full session restart when the session already reached
COMPLETED (nothing left to preserve), or refreshes `summary`/`reportsAvailable` in place without
disturbing the current step when the session is still ACTIVE (mid-review) — so clicking Retry can never
silently advance a landlord past a real priority they're currently looking at.

**Gate**: 12 new tests (4 in `todaysPrioritiesWorkflow.test.js`, 5 in
`advanceGuidedWorkflowSession.test.js`, 3 in `RentalTodaysPrioritiesPanel.test.jsx`) — domain suite
69/69, panel suite 11/11, all passing. Clean lint, clean `git diff --check`, clean production build.

### Checkpoint 3 — The GW-2 readiness-guidance workflow itself

**New workflow**: `src/domains/guided-workflow/firstTenantReadinessWorkflow.js` defines
`rental.first-tenant-readiness` — 8 static, versioned, informational (non-mutating,
`requiresExplicitConfirmation: false`) steps in the owner-specified order: unit readiness, tenant
assignment, lease readiness, recurring-rent setup, security deposit, renter's insurance, move-in
inspection, and a final ready-for-move-in review. Unlike Today's Priorities (portfolio-wide), this
workflow is scoped to one landlord-chosen vacant unit at a time.

**Evaluator logic reads only real, already-existing fields** (verified directly against
`src/app/api/rental/route.js` and its underlying migrations, not assumed): `rental_units.status`,
`rental_leases.status`, `rental_lease_tenants` membership, `rent_schedules.status`,
`rental_security_deposits.status`, `renters_insurance_policies.status`/`expiration_date`, and
`rental_inspections.status`/`inspection_type`. `selectVacantUnitsForReadiness()` reuses
`buildRentalDashboardSummary.js`'s own "no active lease references this unit" predicate verbatim, so
this workflow's unit picker can never disagree with Today's Priorities' own vacancy count. A unit can
accumulate more than one lease over time; `selectTargetLease()` picks an active lease first, else the
most recently created draft, else the most recent overall — never an arbitrary array-order pick.
Downstream steps that structurally depend on an earlier one not yet being true (e.g. rent can't be
scheduled before the lease is active) are marked `BLOCKED` with their own reason code and human-readable
explanation, rather than silently reordered or hidden, satisfying "clearly explain blockers."

**A real, related gap found and fixed as part of building this checkpoint honestly, not scope creep**:
`renters_insurance_requirements` (whether insurance is even *required* for a given lease, as opposed to
whether proof was *provided*) was never fetched by `/api/rental` at all — meaning a lease that
deliberately opted out of an insurance requirement would have been misread as "missing" insurance by
this workflow's evaluator. Added a new, read-only, additively-scoped `.select("lease_id, required,
minimum_liability_cents")` query to the existing GET handler (RLS on that table is already
`has_workspace_access()`-scoped from an earlier migration, so co-owner access needed no new work) and
used it: `renters-insurance` resolves to `NOT_APPLICABLE` when a requirement row explicitly marks
`required: false`, and otherwise applies the implicit-required default `buildRentalDashboardSummary.js`
itself already uses for the portfolio-wide view. Every existing GET-handler test file that constructs a
full `tables` mock (6 spots in `route.test.js`) was updated to supply this table; no other file in the
repository was affected (confirmed by grep — this is a wholly new field, additive to the response body).

**Never claims ready-for-move-in unless every required evaluator passes — structurally, not by
convention**: the final `ready-for-move-in` step's evaluator always returns `REQUIRED` when evaluated.
Combined with the session controller's own existing rule (the walk stops at the first step needing
attention, in definition order), this step can only ever become the *current* step once every step
before it has resolved to `COMPLETE` or `NOT_APPLICABLE` — there is no code path that reaches it
otherwise. `hasUnavailableSteps` (via the same generic `sessionHasUnavailableSteps()` helper Checkpoint
2 introduced) additionally gates the panel's congratulatory copy, even though this workflow's evaluator
does not currently produce any `UNAVAILABLE` result (it depends only on the single hard-required
`/api/rental` fetch) — kept as a defensive, zero-cost consistency measure, not a currently-reachable
path.

**UI**: `useFirstTenantReadinessSession.js` (fetch `/api/rental` once, derive the vacant-units list,
manage unit selection and the guided session) and `RentalFirstTenantReadinessPanel.jsx` (a unit picker
when no unit is chosen or the list is empty, then one step at a time with Back/Pause/Resume/Exit/Change
unit, a distinct visual treatment for the final ready-for-move-in review, and the same
`data-guided-workflow-*` semantic-target convention GW-1 established — no new attributes were added to
any *destination* panel, only to this new panel's own controls). Wired into
`RentalApplicationShell.jsx` as a new "Prepare a Tenant" entry in the Overview nav group, function id
`readiness` — reachable, not just built. Guidance only ever issues `GET /api/rental`; every destination
step's actual action (activating a lease, recording a deposit, etc.) happens through the existing,
unmodified Leases/Deposits/Insurance/Inspections panels and their existing server-side authorization, so
consequential actions remain explicitly landlord-confirmed through existing forms, exactly as required.

**Deferred, not forgotten, exactly as instructed**: the Property Passport ↔ maintenance linkage and
reconciliation's self-declared incompleteness (both documented in §3 and GW-1's §6) remain completely
untouched by GW-2 — this workflow guides toward the existing Deposits/Insurance/Inspections panels as
they are today, making no claim that either gap is closed, and does not attempt to repair the
Property Passport linkage or the reconciliation system in this slice.

**Gate**: 44 new tests (29 in `firstTenantReadinessWorkflow.test.js`, 14 in
`RentalFirstTenantReadinessPanel.test.jsx`, 1 new `RentalApplicationShell.test.jsx` assertion for the
new surface — its two existing generic reachability tests, which loop over every registered function
id, cover the new `readiness` surface automatically with no additional edits). Combined with Checkpoints
1 and 2, GW-2 in total adds 61 new tests across this branch. Full repository suite at the end of
Checkpoint 3: **795 test files, 5123 tests, all passing.** Clean lint on every new/changed file (the one
pre-existing `RentalApplicationShell.jsx` finding noted in GW-1's §6 remains, confirmed via `git diff`
to be on a line this branch never touches). Clean `git diff --check`. Clean production build.

**Validation performed**: primary-owner and co-owner behavior (via the same `resolveEffectiveOwnerId`/
`has_workspace_access` mechanism GW-1 already relies on — no new authorization code was written, so no
new cross-workspace risk was introduced); cross-workspace denial (session-level `assertWorkspaceMatch`,
already covered by `advanceGuidedWorkflowSession.test.js`'s existing suite, reused unmodified); complete,
incomplete, blocked, and skipped states (all 29 evaluator tests); partial-data and reports-endpoint
failure (Checkpoint 2's 12 tests); missing/duplicate semantic targets (the shared
`createSemanticTargetRegistry()` already fails closed on a duplicate `targetId`, exercised by this
workflow's own 8 unique step ids); refresh/pause/resume/Back/Exit/direct navigation (dedicated panel
tests for each); no false "Nothing urgent" or "ready for move-in" result (dedicated tests asserting the
exact opposite for a unit with one real outstanding gap); no POST/PATCH/DELETE issued by guidance
(a dedicated test inspects every `fetch` call guidance makes and asserts none carries a mutating
method). **Not independently browser-verified this checkpoint** (matching GW-1's own honest §8
disclosure of the same limitation): keyboard accessibility, pinch-zoom, and mobile-viewport rendering
rest on this panel reusing the exact same semantic-button/ARIA/responsive-Tailwind conventions already
used (and already visually verified live) by `RentalTodaysPrioritiesPanel.jsx`, not on a fresh direct
observation of this specific new panel in a real browser.

---

## 5. Recommendation / decision requested

AR-0 and GW-0 acceptance criteria are met: current repository reality is cited throughout this document, no duplicate subsystem exists, the existing deterministic governance updater remains untouched and authoritative, and protected domains plus Version 1 restrictions (Section 4) are identified above. GW-1 (Section 6) and AR-1 (Section 7) were committed and merged to `main` as PR #54. GW-2 (Section 9) is now complete on its own branch, as three separately-gated checkpoints, sharing only read-only reuse points (the acting-user/canonical-owner helpers, the generic guided-workflow session controller) with GW-1 and no code path into AR-1 or the Repair Controller at all.

Nothing on the GW-2 branch has been committed, pushed, merged, deployed, or migrated. Next-decision options for the owner:

1. **Commit and push this branch, open a PR** covering GW-2's three checkpoints (or split further, e.g. the Checkpoint 1 birth-date correction as its own small PR, if a cleaner review split is preferred) — no merge without a further explicit instruction, matching the standing pattern for every other phase this session.
2. **Continue toward GW-3 or AR-2** (further guided-workflow product surfaces; read-only incident diagnosis) before opening anything for review.
3. **Request changes** — in particular, the readiness workflow's exact 8-step order/copy, the choice to add a new `renters_insurance_requirements` fetch to `/api/rental` rather than deferring that gap, and the "unit picker returns to itself rather than resuming a specific unit on error/exit" UX decision are the most product-facing calls made without a separate check-in this checkpoint.
