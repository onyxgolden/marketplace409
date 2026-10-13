#!/bin/bash
# Simulates the "Trigger sweep endpoint" step of rental-cron-sweeps.yml
# (minus the real curl) to prove the shell exit-code routing works:
#   helper exit 0 -> step passes
#   helper exit 1 -> step fails
#   helper exit 3 -> legacy generic check runs
set -e
cd "$(dirname "$0")/../.."

PASS=0; FAIL=0
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

# Emulates the workflow step body with a canned response file + HTTP code.
# Args: <endpoint> <http-code> <response-json-file>
run_step() {
  local ENDPOINT="$1" HTTP_CODE="$2" RESP="$3"
  cp "$RESP" /tmp/sweep-response.json
  set +e
  node scripts/cron/assertSweepOutcome.mjs \
    --endpoint "$ENDPOINT" \
    --response-file /tmp/sweep-response.json \
    --http-status "$HTTP_CODE" > "$tmp/out.txt" 2>&1
  ASSERT_CODE=$?
  set -e
  if [ "$ASSERT_CODE" -eq 0 ]; then
    echo "STEP_RESULT=PASS"
    return 0
  fi
  if [ "$ASSERT_CODE" -ne 3 ]; then
    echo "STEP_RESULT=FAIL($ASSERT_CODE)"
    return 1
  fi
  # legacy generic check
  FAILED=$(python3 -c "
import json, sys
try:
    body = json.load(open('/tmp/sweep-response.json'))
except Exception:
    print('JSON_PARSE_ERROR'); sys.exit(0)
if body.get('success') is False:
    print('SUCCESS_FALSE'); sys.exit(0)
print(int(body.get('failed') or 0))
")
  if [ "$FAILED" = "JSON_PARSE_ERROR" ] || [ "$FAILED" = "SUCCESS_FALSE" ]; then
    echo "STEP_RESULT=FAIL(legacy)"
    return 1
  fi
  if [ "$FAILED" -gt 0 ]; then
    echo "STEP_RESULT=FAIL(legacy)"
    return 1
  fi
  echo "STEP_RESULT=PASS(legacy)"
  return 0
}

check() { # <desc> <expected> <endpoint> <http> <jsonfile>
  local desc="$1" expected="$2"; shift 2
  echo -n "  $desc ... "
  set +e; out=$(run_step "$@"); code=$?; set -e
  if [ "$code" -eq "$expected" ]; then echo "OK ($out)"; PASS=$((PASS+1));
  else echo "MISMATCH: want exit $expected got $code ($out)"; FAIL=$((FAIL+1)); fi
}

mkjson() { # <name> <json>
  local f="$tmp/$1.json"; printf '%s' "$2" > "$f"; echo "$f";
}

RECEIPT_OK=$(mkjson ok '{"success":true,"dryRun":false,"sendingEnabled":true,"reconciled":0,"skippedAtDetection":0,"reconcileSkipped":false,"sent":2,"failed":0,"skippedDisabled":0,"skippedNotAllowlisted":0,"ledgerErrors":0,"deferredQuietHours":0,"wouldSend":[]}')
RECEIPT_FAIL=$(mkjson fail '{"success":true,"dryRun":false,"sendingEnabled":true,"reconciled":0,"skippedAtDetection":0,"reconcileSkipped":false,"sent":1,"failed":1,"skippedDisabled":0,"skippedNotAllowlisted":0,"ledgerErrors":0,"deferredQuietHours":0,"wouldSend":[]}')
RECEIPT_EVID=$(mkjson evid '{"success":true,"dryRun":false,"sendingEnabled":true,"reconciled":0,"skippedAtDetection":0,"reconcileSkipped":false,"sent":1,"failed":0,"skippedDisabled":0,"skippedNotAllowlisted":0,"ledgerErrors":2,"deferredQuietHours":0,"wouldSend":[]}')
RECEIPT_DEFER=$(mkjson defer '{"success":true,"dryRun":false,"sendingEnabled":true,"reconciled":0,"skippedAtDetection":0,"reconcileSkipped":false,"sent":0,"failed":0,"skippedDisabled":0,"skippedNotAllowlisted":0,"ledgerErrors":0,"deferredQuietHours":"whole_run_deferred","wouldSend":[]}')
CHARGES_OK=$(mkjson charges '{"success":true,"failed":0}')
CHARGES_FAIL=$(mkjson chargesfail '{"success":true,"failed":3}')

echo "workflow step routing:"
check "registered endpoint, clean delivery -> pass" 0 "/api/rental/cron/tenant-payment-receipts" 200 "$RECEIPT_OK"
check "registered endpoint, failed items -> fail" 1 "/api/rental/cron/tenant-payment-receipts" 200 "$RECEIPT_FAIL"
check "registered endpoint, ledger errors -> fail" 1 "/api/private-financing/cron/payment-receipt-notifications" 200 "$RECEIPT_EVID"
check "registered endpoint, quiet-hours deferral -> pass" 0 "/api/rental/cron/tenant-payment-receipts" 200 "$RECEIPT_DEFER"
check "unregistered endpoint, legacy pass -> pass" 0 "/api/rental/cron/generate-charges" 200 "$CHARGES_OK"
check "unregistered endpoint, legacy failed>0 -> fail" 1 "/api/rental/cron/generate-charges" 200 "$CHARGES_FAIL"
check "manual dispatch query string stripped -> pass" 0 "/api/rental/cron/tenant-payment-receipts?trigger=manual" 200 "$RECEIPT_OK"

echo ""
echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
