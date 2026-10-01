#!/bin/sh
# DST-aware schedule guard for the nightly doc-drift workflow.
#
# The workflow's cron entry ('0 6,7 * * *') fires at 06:00 and 07:00 UTC
# every day because GitHub Actions cron is UTC-only, and 1:00 AM
# America/Chicago is 06:00 UTC in CDT (UTC-5) and 07:00 UTC in CST (UTC-6).
# Exactly one of the two daily slots should run the pass.
#
# should_run_pass([epoch_seconds]) echoes exactly "true" or "false".
# Logic:
#   1. If the America/Chicago local hour of the given instant is not 01,
#      the slot is the off-season one -> false.
#   2. On the autumn DST fall-back day (e.g. 2026-11-01) Chicago has TWO
#      1:00 AMs: 01:00 CDT at 06:00 UTC and 01:00 CST at 07:00 UTC. Both
#      slots pass check 1, so disambiguate: if the local hour one hour
#      later is still 01, this instant is the FIRST of the two 1:00 AMs
#      (the repeated hour) -> false, letting the second/07:00-UTC slot
#      run. The second occurrence has 02 as the next hour -> true.
#   3. Normal CDT days, normal CST days, and the spring-forward day
#      (when 02:00-02:59 does not exist but 01:00 does, exactly once)
#      are unaffected: only the one true 1:00 AM slot returns true.
#
# POSIX sh, no bashisms, no external dependencies beyond GNU/BSD date.
# Intended to be sourced:  . scripts/engineering-brain/docs/dstScheduleGuard.sh

should_run_pass() {
  now_epoch="${1:-$(date +%s)}"

  chicago_hour="$(TZ=America/Chicago date -d "@$now_epoch" +%H 2>/dev/null \
    || TZ=America/Chicago date -r "$now_epoch" +%H)"
  if [ "$chicago_hour" != "01" ]; then
    echo "false"
    return 0
  fi

  # Fall-back disambiguation: a second consecutive 1:00 AM hour means this
  # instant is the first of the two occurrences -> no-op here, run the
  # later (07:00 UTC, CST) slot instead.
  next_epoch=$((now_epoch + 3600))
  next_hour="$(TZ=America/Chicago date -d "@$next_epoch" +%H 2>/dev/null \
    || TZ=America/Chicago date -r "$next_epoch" +%H)"
  if [ "$next_hour" = "01" ]; then
    echo "false"
    return 0
  fi

  echo "true"
}
