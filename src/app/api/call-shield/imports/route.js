// GET /api/call-shield/imports — staged call-log imports, unmatched first.
// POST /api/call-shield/imports — stage records from the Android shell.
// The server recomputes every dedupe hash from canonical fields and upserts
// on (owner_id, dedupe_hash): repeat imports of the same window are
// idempotent and can never fork the timeline (staging never writes events).
import { NextResponse } from "next/server";
import { buildImportDedupeHash, normalizePhoneNumber } from "@/domains/callShield/callShieldImport";
import { guardCallShieldRequest } from "../_lib/auth.js";

const ROW_COLUMNS = "id, device_id, phone_number, normalized_phone, started_at, duration_seconds, call_type, caller_name, imported_at, matched_case_id, dismissed";
const PAGE_LIMIT = 200;
const CALL_TYPES = new Set(["incoming", "outgoing", "missed", "rejected", "blocked", "other"]);

export async function GET(request) {
  const auth = await guardCallShieldRequest(request);
  if (auth.response) return auth.response;
  const { user, supabaseClient } = auth;

  try {
    const { data: rows, error } = await supabaseClient
      .from("android_call_imports")
      .select(ROW_COLUMNS)
      .eq("owner_id", user.id)
      .eq("dismissed", false)
      .order("matched_case_id", { ascending: true, nullsFirst: true })
      .order("started_at", { ascending: false })
      .limit(PAGE_LIMIT);
    if (error) throw error;
    return NextResponse.json({ success: true, items: rows || [] });
  } catch (error) {
    console.error("Call Shield imports error", error);
    return NextResponse.json({ error: "Unable to load imports." }, { status: 500 });
  }
}

function toStagedRow(ownerId, record) {
  const phoneNumber = typeof record?.phoneNumber === "string" ? record.phoneNumber.slice(0, 64) : "";
  const normalizedPhone = normalizePhoneNumber(phoneNumber);
  const startedAt = record?.startedAt ? new Date(record.startedAt) : null;
  const durationSeconds = Number(record?.durationSeconds);
  const callType = typeof record?.callType === "string" ? record.callType : "";
  if (!normalizedPhone) throw new TypeError("record needs a phone number");
  if (!startedAt || Number.isNaN(startedAt.getTime())) throw new TypeError("record needs a valid startedAt");
  if (!Number.isInteger(durationSeconds) || durationSeconds < 0) throw new TypeError("record needs a valid durationSeconds");
  if (!CALL_TYPES.has(callType)) throw new TypeError("record needs a valid callType");

  const startedAtISO = startedAt.toISOString();
  return {
    id: crypto.randomUUID(),
    owner_id: ownerId,
    device_id: typeof record?.deviceId === "string" ? record.deviceId.slice(0, 128) : "unknown",
    android_call_id: typeof record?.androidCallId === "string" ? record.androidCallId.slice(0, 64) : null,
    phone_number: phoneNumber,
    normalized_phone: normalizedPhone,
    dedupe_hash: buildImportDedupeHash({ normalizedPhone, startedAtISO, durationSeconds, callType }),
    started_at: startedAtISO,
    duration_seconds: durationSeconds,
    call_type: callType,
    caller_name: typeof record?.callerName === "string" ? record.callerName.slice(0, 200) : null,
  };
}

export async function POST(request) {
  const auth = await guardCallShieldRequest(request);
  if (auth.response) return auth.response;
  const { user, supabaseClient } = auth;

  let body = null;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }
  if (!Array.isArray(body?.records) || body.records.length === 0 || body.records.length > 500) {
    return NextResponse.json({ error: "records must be a non-empty array of at most 500." }, { status: 400 });
  }

  let rows = null;
  try {
    rows = body.records.map((record) => toStagedRow(user.id, record));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid record." }, { status: 400 });
  }

  try {
    const { error } = await supabaseClient
      .from("android_call_imports")
      .upsert(rows, { onConflict: "owner_id,dedupe_hash", ignoreDuplicates: true });
    if (error) throw error;
    return NextResponse.json({ success: true, received: rows.length }, { status: 201 });
  } catch (error) {
    console.error("Call Shield stage imports error", error);
    return NextResponse.json({ error: "Unable to stage the imports." }, { status: 500 });
  }
}
