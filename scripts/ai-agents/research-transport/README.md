# AI Lab P1-B — Research transport adapter

P1-B is the second of three separately reviewed P1 slices (brief:
`results/chatgpt/ai-lab-p1-research-job-definition-scope-2026-11-04.md`
in forge-ai-drop). It moves a validated Research job definition +
synthetic preview into the existing private Workbench store, and
moves operator decisions back through the store's append-only
decision chain. It is an adapter, not a service.

## What this slice contains

- `src/serializer.js` — `serializeResearchItem()`: maps a P1-A
  receipt + items + validated definition onto a private-store item
  in the P2a shape (`research-private-item@1`, kind
  `research-preview`, agent `research`, synthetic, report digest,
  row ids as the decision address space, pinned versions,
  `execution_authorized: false`, `job_status: DISABLED`,
  `mode: SYNTHETIC_PREVIEW`). It re-validates the definition and
  requires the receipt to prove it belongs to that definition
  (mode, status, definition-hash match, run id recomputed from
  hash + invocation, job id/version match, item count match,
  every item PENDING, every item key unique). A stale, forged, or
  half-built preview refuses before it can reach the store. The
  item embeds the validated definition and the next due instant
  from the definition's declarative recurrence rule (preview math
  only — the rule is stored, never registered).
- `src/decisionValidator.js` — `decisionFromBody()` +
  `validateResearchDecision()`: the Research decision gate, mirroring
  the existing private decision adapter's binding contract (item +
  report digest + row + actor + decision + time). The enum is
  binary — accept | reject — per the brief; send-back is not a
  Research decision. The actor is always the server-derived
  session identity, never a body field.
- `src/transport.js` — `createResearchTransport({ store, principal,
  clock })`: `publishPreview()` (principal binding → P1-A
  buildPreview → serialize → store.putItem),
  `decide()` (fetch item → decisionFromBody → store.appendDecision
  with the Research validator), read delegates (`getItem`,
  `listItems`, `getDecisions`), and `closedLoop()` (CLOSED iff
  every row has at least one decision revision).
- `src/errors.js`, `src/canonical.js` — the slice's refusal type
  and deterministic hashing. Store errors (REPUBLISH_CONFLICT,
  DECISION_CONFLICT, store-side STALE_DIGEST) propagate unchanged.

## Decision semantics — read this before wiring a UI

ACCEPT means **accepted for human consideration** — never approval
to write production data, activate an agent, contact anyone, spend,
or enqueue execution. A decision record is review metadata only;
no external action executes from it. A closed loop is review
completion only — never activation. Activation remains a distinct
Jason-only decision, not granted by merge, publish, or decision.

## Fail-closed rules

- No store → refuse (`STORE_REQUIRED`). There is no fallback to
  Git, to a public path, or to any second store, and this module
  touches no filesystem itself: the store is an injected capability.
- Definition operator scope must equal the host-registered
  principal, or the publish refuses (`PRINCIPAL_MISMATCH`) before
  any preview is built. Cross-workspace and cross-operator
  publishes are denied.
- Every item read or mutation is authorized against the stored
  item's embedded job scope BEFORE any item bytes or decisions are
  returned: `getItem`, `getDecisions`, `decide`, and `closedLoop`
  refuse a foreign item (`PRINCIPAL_MISMATCH`, with a generic
  detail that discloses no item contents), and `listItems`
  silently shows only the caller's own rows. The private store's
  namespace is flat and enforces no caller principal itself, so
  this adapter is the enforcement point. Items with no embedded
  Research scope (foreign items sharing the store) are likewise
  denied, never treated as readable. The store's list projection
  carries no scope, so `listItems` retrieves each candidate item
  and authorizes it (one extra read per listed row).
- The decision actor is the server-derived session identity the
  host passes as `actor` — never a body field (`decisionFromBody`
  rejects a body `actor`). Host routes MUST bind `actor` to the
  authenticated session identity at the route boundary; this
  adapter has no session capability and cannot do that binding
  itself, so a route that forwards a request-supplied actor breaks
  the gate.
- Duplicate invocation with identical inputs is idempotent in the
  store (same run id + same bytes → no-op). A changed retry under
  the same invocation conflicts (`REPUBLISH_CONFLICT`) instead of
  overwriting; the caller re-reads the stored item. An idempotent
  retry must replay identical inputs, including the receipt
  instant — `published_at` is the receipt's own `created_at`, so
  identical inputs are byte-identical.
- A decision on a refreshed preview refuses (`STALE_DIGEST`); a
  decision naming a foreign row refuses (`UNKNOWN_ROW`); a
  decision_id replayed with different material refuses
  (`DECISION_CONFLICT`); a decision_id replayed identically
  returns the prior revision.

## Host wiring (P1-C and the host harness)

The host opens the real private store and injects it; this module
never opens a state directory itself:

```js
import { openPrivateStore } from "<drop>/tools/agent-workbench/private-store.mjs";
import { createResearchTransport } from "./src/transport.js";

const store = await openPrivateStore({ stateDir: process.env.FORGE_PRIVATE_STATE_DIR, dropRoot: DROP_ROOT });
const transport = createResearchTransport({
  store,
  principal: { operator_ref: HOST_OPERATOR_REF, workspace_ref: HOST_WORKSPACE_REF },
});
```

Without `FORGE_PRIVATE_STATE_DIR` the store itself refuses
(`PRIVATE_STORE_UNCONFIGURED`) — again, no fallback.

## What this slice deliberately does NOT contain

- No scheduler, cron, timer, queue, or background run of any kind.
  Recurrence stays a stored declarative rule + preview math.
- No routes, no UI (P1-C), no migration, no activation path, no
  live network call, no production read/write, no tenant/financial/
  enrollment data, no second store or transport.
- No separate snapshot record: the item embeds the full preview
  bundle as its report, so the private store is the single source
  of truth for the run card.
- No P1-A contract change: P1-B imports P1-A's documented exports
  only (`buildPreview`, `validateJobDefinition`,
  `DELIVERABLE_SCHEMA_VERSION`, `definitionHash`, `deriveRunId`,
  `nextDueAfter`) and modifies none of its files.

## Run the tests

```sh
node tests/run-tests.js   # or: npm test (in this directory)
```

Pure Node 24, zero dependencies. Tests use `node:test` directly
against an in-memory double of the private store's publish/decision
contract (`tests/storeDouble.js`) — no filesystem, no network.
Suites: serializer (7), decision (6), transport (14, including the
8-item Generac synthetic replay with eight distinct decisions and
a closed loop, a static guard against scheduler/timer/network/
filesystem surface in the adapter sources, and cross-principal
isolation: two principals attempting to read, list, decide, and
close each other's items, plus single-ref scope mismatches and
scopeless foreign items).
