# DXGI-2 Hardware Test Procedure — Two-Output Capture

**Status: NOT RUN.** This procedure is owed via the iBUYPOWER (or another
Windows machine with two attached outputs). Nothing in the DXGI-2 PR
claims hardware results until these steps have actually run and their
evidence is filed. The unit tests in `core/src/dxgi_duplication.rs`
(`dxgi2_tests`) prove the plan/rotation/composition/retry logic against
scripted mocks on any host; they do not prove real GPU behavior.

## 1. Prerequisites

- Windows 10/11 interactive desktop session (not RDP — duplication is
  unavailable over remote sessions by design).
- At least two attached outputs. Ideal arrangement for full coverage:
  - A secondary monitor positioned to the LEFT of the primary, so its
    desktop origin is negative (e.g. `(-1920, 0)`).
  - One output rotated 90° (Display Settings → Orientation → Portrait),
    if a rotatable monitor is available. If no rotated output is
    available, record that explicitly — the rotation-direction check in
    §4 is then still owed, not waived.
- Rust toolchain with the `x86_64-pc-windows-msvc` target.
- The repo checked out at the exact reviewed DXGI-2 tree (record the
  commit SHA in the evidence).

## 2. Full core suite on Windows

```powershell
cd <repo>\forge-capture-app
cargo test -p forge-capture-core
```

Required: all tests pass, including the 31 `dxgi2_tests` tests. Record
the full transcript.

## 3. Two-output hardware test (ignored by default)

```powershell
cd <repo>\forge-capture-app
cargo test -p forge-capture-core --lib dxgi2_two_output_hardware_capture -- --ignored --nocapture
```

What the test does (see `win_backend` in
`core/src/dxgi_duplication.rs`):

1. Enumerates attached outputs and logs each device name, desktop rect,
   rotation, and adapter LUID.
2. Asserts at least two attached outputs (a single-output machine fails
   loudly here — that is the test working, not a code failure).
3. Captures the whole virtual desktop through `DxgiMultiOutputSession`
   and asserts the composite dimensions equal the virtual bounds.
4. Logs every output's acquisition metadata (`LastPresentTime`,
   `AccumulatedFrames`) and the present-time tick skew, if computable.
5. Writes `dxgi2-two-output.png` (or the path in
   `DXGI2_HARDWARE_PNG_PATH`) for the visual checks in §4.

Record: the `--nocapture` log, the PNG, and the display arrangement
(screenshot of Display Settings showing monitor positions).

## 4. Visual checks on the PNG (do not skip)

Open `dxgi2-two-output.png` in an image viewer and confirm:

1. **Negative-origin side:** the left monitor's content appears on the
   left of the image, with no shift, mirror, or black bar. A black
   region on one side, or content from the wrong monitor, is a failure.
2. **Rotation direction (only if a rotated output was available):**
   put asymmetric, recognizable content on the rotated monitor before
   running the test (e.g. a window with text, or an arrow wallpaper).
   The rotated monitor's region in the PNG must show that content
   UPRIGHT and on the correct side. Dimensions alone cannot distinguish
   clockwise from counter-clockwise rotation (both swap width/height),
   so this visual check is the only thing that confirms the
   `Rotate90 = clockwise` mapping assumed by `rotate_frame`. If the
   content appears rotated 180° from upright, or mirrored, STOP and file
   the finding: the rotation mapping — not the test — is wrong.
3. **No partial image:** the PNG covers the full virtual desktop; no
   monitor's region is black, stale, or missing.

## 5. Topology-change live check (arrangement move, no unplug needed)

1. Run the §3 test with the secondary on the left; save the PNG as
   `dxgi2-before.png`.
2. In Display Settings, drag the secondary to the RIGHT of the primary
   and apply.
3. Re-run the §3 test; save the PNG as `dxgi2-after.png`.
4. Confirm the after-PNG shows the secondary's content on the right and
   dimensions equal to the new virtual bounds.

This exercises a real topology change between runs. The
within-request discard-and-retry-on-reconfiguration behavior itself is
proven by the unplug/mode-change simulations in `dxgi2_tests`
(`unplug_simulation_discards_partial_and_retries_once`,
`mode_change_simulation_retries_from_the_fresh_snapshot`,
`unplug_removing_an_output_is_unavailable_not_partial`); a live
mid-request unplug is not scripted here because it cannot be timed
deterministically from the test seat.

## 6. Skew measurement (ticks, not milliseconds)

The §3 log reports a present-time skew in QueryPerformanceCounter
ticks, or "unknown" when any output reports a present time of 0 (no
present since the last acquire). Ticks convert to time only with the
machine's QueryPerformanceFrequency — never label the tick delta as
milliseconds. The documented bound is the total request deadline
(default 2000 ms) on the wait dimension: all output acquires in one
request run under one deadline. File the measured tick delta, the
counter frequency if obtained, and the converted value with its method.

## 7. Evidence to file

- `cargo test` transcript at the reviewed tree.
- `--nocapture` log of the §3 run.
- `dxgi2-two-output.png` (plus before/after PNGs from §5).
- Display Settings arrangement screenshot.
- Machine/OS build/GPU driver/session details.
- Explicit notes: rotated output available or not; negative-origin
  arrangement achieved or not; skew ticks measured or unknown.

## 8. What this procedure does NOT prove

- Rotation direction, until the §4 marker check passes on a real
  rotated output.
- Real device-removal recovery (a mode-switch `ACCESS_LOST` is not
  `DEVICE_REMOVED`); DXGI-1 carries the same standing caveat.
- GPU-resource flatness over a soak run (DXGI-4's scope, not DXGI-2's).
- Any production behavior: DXGI-2 is dispatch-inert. `native.rs`
  dispatch is untouched; DXGI-3 owns wiring.
