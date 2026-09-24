# CLAUDE.md — marketplace409 / FORGE

Read this file FIRST, before exploring. It exists so you don't burn tokens re-discovering settled facts. If something you need isn't here, check `FORGE_CONSTITUTION.md`, then `docs/adr/`, then `git log --oneline -20` — in that order — before asking the user.

## What this is

FORGE: Jason Morgan's real-estate fintech marketplace (409Marketplace.online). Next.js App Router + Supabase (Postgres/RLS) + Vercel. Public repo `onyxgolden/marketplace409`. Jason is the primary customer — build for his own use first.

Big modules: Rental Manager (`/forge/rentals`), Financial Forge (ledger/accounting), Scheduling (`/forge/scheduling`), Home Designer (`/forge/designer`), FORGE Capture (desktop app, separate repo dir), Call Shield (`src/domains/callShield`).

## Commands

- `npm run dev` / `npm run build` / `npm run lint` (`eslint`)
- `npx vitest run <path>` — single test file. Full suite: `npm test`
- Always: tests green + `npm run build` green before committing. Lint touched files.
- Supabase prod checks: `npx supabase link --project-ref bzqvenxjlstinmgbuvvg`, then read-only SQL wrapped in `begin; ... rollback;` via `npx supabase db query --linked`.

## Architecture (don't re-derive)

- Domain-Driven Design. Pure domain logic lives in `src/domains/<name>/` — framework-free, unit-tested, no imports from `app/` or components.
- Constitution rules (see `FORGE_CONSTITUTION.md`): one responsibility per commit; red → green → commit; stop after green; never redesign a stable module to add a feature — build new layers above; immutable core objects.
- Migrations: timestamp-prefixed SQL in `supabase/migrations/`, after the latest existing timestamp. Never apply to prod without Jason's explicit word.

## Workflow (standing rules — follow them, don't re-negotiate)

- One slice = one branch = one PR, independently revertible. Fresh worktree per slice: `git worktree add ../<name> -b <branch> origin/main`. Never share a worktree or `node_modules` between active slices.
- Status labels, in order: planned → implemented → tested → reviewed → merged → deployed → production-verified. Tests passing ≠ production-verified. Say which one you mean.
- Architecture decisions need review; visual details, small fixes, and implementation choices are your own judgment — don't gate on them.
- Push with normal git. Open PRs with `gh pr create` when available.

## Hard boundaries (violations are bugs, not judgment calls)

- NEVER invent: balances, APRs, prices, fees, damages, lease terms, amenities, availability, tenant/borrower data. Missing values come from Jason or stay `[placeholder]`.
- No production data writes, migrations, payments/Stripe changes, credential/config changes, or real outbound messages without Jason's explicit approval. Read-only by default.
- No secrets, tokens, keys, or customer/tenant/ledger data in chat, files, or commits. Ever.
- Generated content from `~/workspace/reference/` uses industry-standard terms only — no company/program/refinery names or proprietary codes.
- RV/cabin live payments stay hard-blocked in both code paths. Do not touch the guards.
- PostHog stays disabled until Jason approves the config.

## Token discipline (why this file exists)

- Be concise. Short answers, no preamble ("Great question!"), no narrating your plan. Jason talks in one-word orders — match the tempo: act, then report status + test counts + the single next step.
- Don't re-read files this document already summarizes. Don't re-explore the repo layout each session — it's above.
- Prefer targeted reads (`sed -n`, `grep`) over opening whole files. Prefer `git log`/`git show` over re-deriving history.
- When a task is done, stop. Don't add "one more thing."
- Record durable new facts (decisions, preferences, gotchas) in the appropriate memory/doc file once, then trust it — that's what keeps the next session cheap too.
