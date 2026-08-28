# FORGE Brain Autonomous Repair and Guided Workflow — Integration Map

## Status

Phase AR-0 + GW-0 read-only repository inspection, complete. **Phase GW-1 (Guided Workflow Engine
foundation), complete** -- see Section 6. **Phase AR-1 (Repair Controller foundation), complete** -- see
Section 7. Both foundations are separately built, separately tested, and stop here for owner review --
no commit, push, merge, deploy, or migration has occurred for either.

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
- Real priorities render / "Nothing urgent" / pause-resume-exit / explanation behavior: **not directly observed in the browser** — blocked by a pre-existing local-only gap (`STRIPE_MODE` missing from this worktree's `.env.local`), confirmed environmental because the unmodified `RentalOverviewPanel` fails identically against the same local server (see §6's "Known local-dev-only limitation"). Per owner direction, this is accepted as a known limitation rather than worked around with real Stripe credentials. Evidence for this functionality instead comes from `RentalTodaysPrioritiesPanel.test.jsx`'s 8 tests, which exercise the identical rendering logic against realistic data shapes (real needsAttention item, "Nothing urgent" state, Why-does-this-matter reveal, pause/resume, exit, Next re-evaluation, onNavigate) using a real jsdom mount, not a shallow render.
- Missing semantic targets fail safely: covered by `semanticTargetRegistry.test.mjs`'s dedicated tests (`resolveSemanticTarget` never throws on a missing id).
- No guidance action mutates landlord records: structurally true for this workflow — every step is `informational`, `requiresExplicitConfirmation: false`, and the panel issues only `GET` requests (`/api/rental`, `/api/rental/reports`); confirmed by reading the panel/hook source, not merely assumed.
- Mobile/desktop, zoom, keyboard, light/dark mode: not independently browser-verified this pass (same Stripe-env blocker prevented reaching the rendered panel); the panel's markup uses semantic buttons/labels and the same `dark:` Tailwind convention as every other Rental Manager panel, consistent with the rest of the app's already-verified responsive/dark-mode behavior.

**AR-1 dry-run demonstrations** (real subprocess runs, `node scripts/repair-controller/dryRunRepairAuthorityCli.mjs`, scenario files deleted after use):
1. Permitted Level 2 preparation → `decision: prepare_for_review`, `reasonCodes: ["validation_passed_prepared_for_review"]`.
2. Protected RLS/migration/payment change (a fictional migration touching `rental_payments` RLS) → `decision: escalate`, `reasonCodes: ["protected_domain_touched", "database_migration", "authorization_or_rls", "financial_logic"]`.
3. Missing policy → `decision: reject`, `reasonCodes: ["missing_policy_no_mutation"]`.
4. Policy allowing Level 4 *and* a valid, correctly-bound owner approval explicitly granting Level 4 → still `decision: prepare_for_review` (Level 2), never `create_pr`/`merge`/`deploy` — the version cap held even against a real approval requesting more.

**Integration map accuracy check**: found and corrected one real error during this pass — §6's test count said "78" but its own parenthetical (60 domain + 8 panel + 1 route) summed to 69; fixed to state 69 correctly. §7's "78" for AR-1 and the "5062" combined full-suite figure were independently re-verified against fresh `npx vitest run` output and are accurate.

**Gate re-run**: no source files changed during this review (only `.env.local` was inspected, not modified, and the dev server was stopped afterward) — the full suite, build, and lint results already recorded in §6/§7 remain current. Re-ran the full suite once more directly before committing: 5062/5062 passing, clean build, clean `git diff --check`.

---

## 5. Recommendation / decision requested

AR-0 and GW-0 acceptance criteria are met: current repository reality is cited throughout this document, no duplicate subsystem exists, the existing deterministic governance updater remains untouched and authoritative, and protected domains plus Version 1 restrictions (Section 4) are identified above. GW-1 (Section 6) and AR-1 (Section 7) are both complete, as two distinct, separately-tested change sets on the same branch, sharing only read-only reuse points (Forge Brain's query engine, the acting-user/canonical-owner helpers) and no code path between them.

Nothing has been committed, pushed, merged, deployed, or migrated. Next-decision options for the owner:

1. **Commit and push this branch, open a PR** covering both GW-1 and AR-1 (or two separate PRs, if a cleaner review split is preferred) — no merge without a further explicit instruction, matching the standing pattern for every other phase this session.
2. **Continue toward GW-2 or AR-2** (state-aware first-tenant readiness workflows; read-only incident diagnosis) before opening anything for review.
3. **Request changes** to either foundation — in particular, `AUTHORITY_CEILING_THIS_VERSION` (hard-capped at 2 in code, not just policy) and the "Today's priorities" step-order/explanations are the two most product-facing decisions made without a separate check-in.
