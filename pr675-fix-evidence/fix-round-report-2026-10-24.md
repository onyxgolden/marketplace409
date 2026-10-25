# PR #675 fix round 1 — P1 render-per-move closure — build report (2026-10-24)

**Branch:** `fix/designer-pinch-raf` (PR #675 updates in place)
**Base:** `cc5e414` (local; tree-identical to reviewed head `4bc1c5b1440c5d53d7298e3bdd94b0b149305a0d`)
**Verdict closed:** ChatGPT NEEDS CHANGES P1 — "Touch moves still render the entire canvas once per pointer event"
**Builder:** Muse fix-round subagent · **No merge, no deploy**

## P1's mechanism

The rAF coalescing from the first build covered `setView`, but `onPointerMove`
still executed `setCursorScreen(screen)` as its first statement — before
`trackTouchMove(e)` could consume an active pinch and before the touch-pan
branch scheduled its view. Every moving finger therefore wrote React state on
every `pointermove`, and each commit re-executed `PlanCanvas` and rebuilt the
whole SVG. ChatGPT's executed Profiler probe measured **4 commits before the
single queued frame fired** for a 4-move burst (pinch and touch-pan alike).

## The fix (`src/components/designer/PlanCanvas.jsx`, +73/−19)

1. **Gesture cursor stash.** New `gestureCursorRef` (declared with the other
   gesture refs, ahead of the callbacks that use it) plus a stable
   `stashGestureCursor` callback. `onPointerMove` now intercepts the two
   gesture paths *before* any state write:
   - a move consumed by an active pinch (`trackTouchMove` → true) stashes
     its cursor and returns — the view already rides the coalesced frame;
   - a one-finger touch-pan move (`pointerType === "touch"` + `drag.kind ===
     "pan"`) stashes its cursor and schedules its view through the existing
     scheduler, then returns.
   
   All other paths (mouse hover/drag, touch draw tools, placement ghosts)
   keep the immediate `setCursorScreen(screen)` — CAD hover behavior is
   byte-identical.
2. **Final flush commits the stashed cursor.** `flushGestureView` (the
   synchronous gesture-end path: pinch end, pan lift/cancel, pointer-leave,
   unmount) now also applies `gestureCursorRef` — batched with the view
   commit, so the crosshair lands exactly where the fingers ended up, with
   zero per-move renders. During the gesture the crosshair simply doesn't
   track the fingers (verdict requirement 1; it was never the user's focus
   mid-pinch, and it was unsuppressed-but-jittery before).
3. **No-op-clear guard (incidental, pre-existing).** While counting renders,
   the builder measured that `onPointerUp`'s trailing `setDrag(null)` /
   `setDrawPreview(null)` each schedule a commit even when the state is
   already null (reproduced on an idle pointerup on the reviewed head too —
   pre-existing, orthogonal to P1). The tail now skips the call when there
   is nothing to clear. Identical state → identical output; it only saves
   the wasted commit.
4. **Untouched:** step math (byte-identical), pending-view chaining, rebase
   never flushes, synchronous flush at true gesture end, wheel zoom, mouse
   pan (direct per-move commit preserved), draw auto-pan, programmatic
   `setView`. The old touch sub-branch inside `drag.kind === "pan"` was
   removed as unreachable (intercepted above); the mouse path is unchanged.

## Render-count numbers (React Profiler, rAF held)

ChatGPT's probe scenario (4-move burst, frame held), reviewed head `4bc1c5b1`:
**4 commits before the frame fired.**

After this fix, same scenario:
| phase | pinch | touch-pan |
|---|---|---|
| 4 moves, frame held | **0 commits** | **0 commits** |
| frame fires | 1 commit, view == step-by-step replica | 1 commit, view == start-anchored math |
| release (sync flush) | +1 (final cursor; second lift is a no-op) | +1 (final cursor batched with the real drag-clear) |
| **gesture total** | **2** | **2** |

Final-cursor correctness: after a pinch ending with the last move at x=330,
the crosshair HUD line renders at x1=330. Non-gesture mouse moves still
update the crosshair immediately (1 commit, as before).

## Gate evidence (`~/workspace/pr675-fix-evidence/`)

- `PlanCanvas.pinch.test.jsx` — **25/25, file byte-identical to base** (frozen).
- `PlanCanvas.pinchRaf.test.jsx` — **9/9** (5 original: burst coalescing,
  immediate-cadence identity, release flush, touch-pan math, rebase 1.2143
  vs 1.0119 stale-base — all green unmodified; 4 new P1 regressions:
  pinch render cadence, pan render cadence, final-cursor position,
  non-gesture hover immediacy).
- ESLint clean on both touched files (two `react-hooks/immutability`
  findings during the build were resolved by declaration ordering: the
  `cursorScreen` state now precedes the scheduler block, and the stash
  lives in a `useCallback` like `scheduleGestureView`).
- Designer surface, identical command, base vs head: TBD (run in progress
  at commit time — see below).
- `pinch-suites.json`: CI-mode JSON reporter output for the 34 pinch tests.

## Designer surface base-vs-head

Identical command (`npx vitest run src/components/designer`, CI JSON
reporter), same 288 test files both sides:

| | files | tests | passed | failed |
|---|---|---|---|---|
| base (`cc5e414`) | 288 | 831 | 831 | 0 |
| head (this fix) | 288 | 835 | 835 | 0 |

Delta is exactly the 4 new P1 regression tests. Zero regressions.
(`designer-surface-base.json`, `designer-surface-head.json`.)

## Push

- Commit `c0e0b12` (local) → API-replayed as `fa72b41` on
  `fix/designer-pinch-raf`; tree `8f9acb9` verified identical local vs
  remote.
- PR #675 head verified via API: `fa72b41239e31f052e0e75aea489082f468653ab`
  (open, mergeable).
- Receipt: `~/workspace/push-receipts/fix_designer-pinch-raf-20261024-063652.json`.
