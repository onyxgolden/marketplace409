// GET /api/call-shield/labels — the owner's contact labels (paginated).
// POST /api/call-shield/labels — upsert a label for a phone number.
// DELETE /api/call-shield/labels?phoneNumber=… — remove a number's label.
// Labels are keyed on the normalized phone number and are owner-only.
import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { isValidLabel, normalizeLabelKey, sanitizeSymbol } from "@/domains/callShield/callShieldLabels";
import { guardCallShieldRequest } from "../_lib/auth.js";

const ROW_COLUMNS = "id, phone_number, normalized_phone, label, symbol, note, created_at, updated_at";
const DEFAULT_PAGE_SIZE = 500;
const MAX_PAGE_SIZE = 1000;

// UUIDv5 namespace (the RFC 4122 URL namespace) for deterministic label ids.
const LABEL_ID_NAMESPACE = "6ba7b811-9dad-11d1-80b4-00c04fd430c8";

/**
 * Deterministic row id for a label: the same (owner, number) always maps to
 * the same UUID, so the atomic upsert below never churns the primary key —
 * on conflict the UPDATE writes back the identical id it would have inserted.
 */
export function labelRowId(ownerId, normalizedPhone) {
  const namespace = Buffer.from(LABEL_ID_NAMESPACE.replace(/-/g, ""), "hex");
  const hash = createHash("sha1")
    .update(namespace)
    .update(`${ownerId}:${normalizedPhone}`)
    .digest();
  hash[6] = (hash[6] & 0x0f) | 0x50; // version 5
  hash[8] = (hash[8] & 0x3f) | 0x80; // variant RFC 4122
  const hex = hash.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function pageParams(url) {
  const page = Math.max(1, Number.parseInt(url.searchParams.get("page") || "1", 10) || 1);
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, Number.parseInt(url.searchParams.get("pageSize") || String(DEFAULT_PAGE_SIZE), 10) || DEFAULT_PAGE_SIZE),
  );
  return { page, pageSize };
}

export async function GET(request) {
  const auth = await guardCallShieldRequest(request);
  if (auth.response) return auth.response;
  const { user, supabaseClient } = auth;

  const { page, pageSize } = pageParams(new URL(request.url));
  const from = (page - 1) * pageSize;
  try {
    // Paginated: the client pages through the full set (see fetchAllLabels)
    // so labels past the old 500-row cap are never silently dropped.
    const { data: rows, count, error } = await supabaseClient
      .from("call_contact_labels")
      .select(ROW_COLUMNS, { count: "exact" })
      .eq("owner_id", user.id)
      .order("created_at", { ascending: false })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const items = rows || [];
    return NextResponse.json({
      success: true,
      items,
      page,
      pageSize,
      total: typeof count === "number" ? count : items.length,
    });
  } catch (error) {
    console.error("Call Shield labels error", error);
    return NextResponse.json({ error: "Unable to load contact labels." }, { status: 500 });
  }
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

  const phoneNumber = typeof body?.phoneNumber === "string" ? body.phoneNumber.slice(0, 64) : "";
  const normalizedPhone = normalizeLabelKey(phoneNumber);
  const label = typeof body?.label === "string" ? body.label : "";
  if (!normalizedPhone) return NextResponse.json({ error: "phoneNumber is required." }, { status: 400 });
  if (!isValidLabel(label)) return NextResponse.json({ error: "label must be personal or offender." }, { status: 400 });
  const symbol = label === "offender" ? sanitizeSymbol(body?.symbol) : "⚠";
  const note = typeof body?.note === "string" ? body.note.slice(0, 500) : null;

  try {
    // Atomic upsert in a single statement: two concurrent requests for the
    // same unlabeled number can no longer interleave an UPDATE-miss +
    // INSERT-miss pair into a unique-violation HTTP 500. The id is
    // deterministic per (owner, number), so the ON CONFLICT update preserves
    // the existing row's primary key instead of churning it.
    const now = new Date().toISOString();
    const { data: item, error } = await supabaseClient
      .from("call_contact_labels")
      .upsert(
        {
          id: labelRowId(user.id, normalizedPhone),
          owner_id: user.id,
          phone_number: phoneNumber,
          normalized_phone: normalizedPhone,
          label,
          symbol,
          note,
          updated_at: now,
        },
        { onConflict: "owner_id,normalized_phone" },
      )
      .select(ROW_COLUMNS)
      .single();
    if (error) throw error;
    return NextResponse.json({ success: true, item });
  } catch (error) {
    console.error("Call Shield label upsert error", error);
    return NextResponse.json({ error: "Unable to save the contact label." }, { status: 500 });
  }
}

export async function DELETE(request) {
  const auth = await guardCallShieldRequest(request);
  if (auth.response) return auth.response;
  const { user, supabaseClient } = auth;

  const phoneNumber = new URL(request.url).searchParams.get("phoneNumber") || "";
  const normalizedPhone = normalizeLabelKey(phoneNumber);
  if (!normalizedPhone) return NextResponse.json({ error: "phoneNumber is required." }, { status: 400 });

  try {
    const { error } = await supabaseClient
      .from("call_contact_labels")
      .delete()
      .eq("owner_id", user.id)
      .eq("normalized_phone", normalizedPhone);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Call Shield label delete error", error);
    return NextResponse.json({ error: "Unable to remove the contact label." }, { status: 500 });
  }
}
