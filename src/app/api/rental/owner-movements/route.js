import { NextResponse } from "next/server";
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { getActiveWorkspaceRole } from "@/lib/supabase/getActiveWorkspaceRole";
import { fetchAllOwnerFinancialEvents } from "@/domains/rentec-financial-history-import/fetchAllOwnerFinancialEvents";
import {
  buildOwnerBalance,
  validateNewContribution,
  validateNewDisbursement,
} from "@/application/rental/ownerStatements";

// Owner cash movements (Rentec-parity R9): disbursements (owner draws) and
// contributions (owner pays INTO the operating account). Equity movements —
// never income, never expenses — recorded in owner_cash_movements so they can
// never leak into income/expense reports.
//
// GET /api/rental/owner-movements — list movements + the current owner balance.
//   ?kind=disbursement|contribution  ?status=active|voided  ?propertyId=  ?from=YYYY-MM-DD  ?to=YYYY-MM-DD
// POST — record a movement. Body: { kind, amount, movementDate, method?, memo?, propertyId? }.
//   A disbursement may not exceed the available owner balance (422 otherwise).
// PATCH — void a movement. Body: { id }. Voids restore the balance; a voided
//   movement is never un-voided and never hard-deleted.
//
// Authorization: read for everyone; writes are owner/co-owner only —
// read-only members get a 403 (the getActiveWorkspaceRole pattern).

const VALID_KINDS = new Set(["disbursement", "contribution"]);
const VALID_METHODS = new Set(["check", "ach", "wire", "cash", "other"]);
const VALID_STATUSES = new Set(["active", "voided"]);
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

async function requireOwner(authenticated) {
  if ((await getActiveWorkspaceRole({ supabaseClient: authenticated.supabaseClient, actorUserId: authenticated.user.id })) === "read_only") {
    return NextResponse.json({ error: "Read-only members cannot record or void owner movements." }, { status: 403 });
  }
  return null;
}

function serialize(row) {
  return {
    id: row.id,
    propertyId: row.property_id || null,
    kind: row.kind,
    amount: Number(row.amount),
    movementDate: row.movement_date,
    method: row.method,
    memo: row.memo || "",
    status: row.status,
    voidedAt: row.voided_at || null,
    createdBy: row.created_by || null,
    createdAt: row.created_at || null,
  };
}

async function listMovements(supabaseClient, ownerId, { kind, status, propertyId, from, to }) {
  let query = supabaseClient
    .from("owner_cash_movements")
    .select("id, property_id, kind, amount, movement_date, method, memo, status, voided_at, created_by, created_at")
    .eq("owner_id", ownerId)
    .order("movement_date", { ascending: false })
    .order("id", { ascending: false });
  if (kind) query = query.eq("kind", kind);
  if (status) query = query.eq("status", status);
  // Known limitation (deferred, deliberately NOT addressed here): this list
  // filter matches the raw stored slug, so movements recorded under a variant
  // slug of the same house (see src/domains/property/propertyAliases.js) are
  // not shown when filtering by the canonical slug. Canonicalized display
  // filtering is a separately scoped follow-up (PR #589 review, 2026-10-08).
  if (propertyId) query = query.eq("property_id", propertyId);
  if (from) query = query.gte("movement_date", from);
  if (to) query = query.lte("movement_date", to);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function GET(request) {
  try {
    const authenticated = await createAuthenticatedRentalManagerApplication();
    if (authenticated.response) return authenticated.response;
    const { supabaseClient, effectiveOwnerId } = authenticated;

    const params = new URL(request.url).searchParams;
    const kind = params.get("kind");
    const status = params.get("status");
    const propertyId = params.get("propertyId");
    const from = params.get("from");
    const to = params.get("to");
    if (kind && !VALID_KINDS.has(kind)) return NextResponse.json({ error: "kind must be disbursement or contribution." }, { status: 400 });
    if (status && !VALID_STATUSES.has(status)) return NextResponse.json({ error: "status must be active or voided." }, { status: 400 });
    if ((from && !DATE_PATTERN.test(from)) || (to && !DATE_PATTERN.test(to))) {
      return NextResponse.json({ error: "from/to must be YYYY-MM-DD." }, { status: 400 });
    }

    const [movements, allMovements, financialEvents] = await Promise.all([
      listMovements(supabaseClient, effectiveOwnerId, { kind, status, propertyId, from, to }),
      // The balance always reflects every ACTIVE movement — a filter never
      // narrows the balance, or a voided row could hide money due.
      listMovements(supabaseClient, effectiveOwnerId, { status: "active" }),
      fetchAllOwnerFinancialEvents(supabaseClient, effectiveOwnerId, {
        columns: "id, event_date, description, amount, transaction_kind, normalized_category, property_id, status, is_deleted",
      }),
    ]);

    const balance = buildOwnerBalance({ financialEvents, cashMovements: allMovements });

    return NextResponse.json({
      success: true,
      movements: movements.map(serialize),
      balance,
    });
  } catch (error) {
    console.error("Owner movements load error", error);
    return NextResponse.json({ error: "Unable to load owner movements." }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const authenticated = await createAuthenticatedRentalManagerApplication();
    if (authenticated.response) return authenticated.response;
    const forbidden = await requireOwner(authenticated);
    if (forbidden) return forbidden;
    const { supabaseClient, effectiveOwnerId, user } = authenticated;

    const body = await request.json();
    const kind = String(body.kind || "").trim();
    const amount = Number(body.amount);
    const movementDate = String(body.movementDate || "").trim();
    const method = String(body.method || "check").trim();
    const memo = String(body.memo || "").trim();
    const propertyId = body.propertyId ? String(body.propertyId).trim() : null;

    if (!VALID_KINDS.has(kind)) {
      return NextResponse.json({ error: "kind must be disbursement or contribution." }, { status: 400 });
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ error: "Enter an amount greater than zero." }, { status: 400 });
    }
    if (!DATE_PATTERN.test(movementDate) || Number.isNaN(new Date(`${movementDate}T12:00:00`).getTime())) {
      return NextResponse.json({ error: "movementDate must be a valid YYYY-MM-DD date." }, { status: 400 });
    }
    if (!VALID_METHODS.has(method)) {
      return NextResponse.json({ error: "method must be check, ach, wire, cash, or other." }, { status: 400 });
    }
    if (memo.length > 500) {
      return NextResponse.json({ error: "Memo is limited to 500 characters." }, { status: 400 });
    }

    const amountCents = Math.round(amount * 100);
    if (kind === "disbursement") {
      // Fast UX precheck against the live balance: the balance reflects
      // voided movements, so a voided draw frees the amount. The database
      // enforces the invariant — see record_owner_disbursement — so a
      // concurrent disbursement that lands between this read and the insert
      // cannot overdraw.
      const [events, movements] = await Promise.all([
        fetchAllOwnerFinancialEvents(supabaseClient, effectiveOwnerId, {
          columns: "id, event_date, amount, transaction_kind, property_id, status, is_deleted",
        }),
        listMovements(supabaseClient, effectiveOwnerId, {}),
      ]);
      const balance = buildOwnerBalance({ financialEvents: events, cashMovements: movements });
      const violation = validateNewDisbursement({ amountCents, balanceCents: balance.balanceCents });
      if (violation) return NextResponse.json({ error: violation, balanceCents: balance.balanceCents }, { status: 422 });

      // Atomic path: one transaction takes a per-owner advisory lock,
      // recomputes the live balance under the lock, enforces
      // amount <= balance, and inserts. Competing disbursements for the same
      // owner are mutually exclusive — the loser recomputes after the
      // winner's insert and fails the invariant itself.
      const { data: rpcData, error: rpcError } = await supabaseClient.rpc("record_owner_disbursement", {
        p_owner_id: effectiveOwnerId,
        p_property_id: propertyId,
        p_amount: Math.round(amount * 100) / 100,
        p_movement_date: movementDate,
        p_method: method,
        p_memo: memo,
        p_created_by: user.id,
      });
      if (rpcError) {
        const message = String(rpcError.message || "");
        if (message.includes("OVER_DISBURSEMENT")) {
          const available = /Available balance: (-?\d+) cents/.exec(message)?.[1];
          const body = { error: "The disbursement exceeds the amount due to the owner." };
          if (available !== undefined) body.balanceCents = Number(available);
          return NextResponse.json(body, { status: 422 });
        }
        throw rpcError;
      }
      const movementRow = rpcData && rpcData.movement;
      if (!movementRow || !movementRow.id) {
        throw new Error("record_owner_disbursement returned no movement row.");
      }
      return NextResponse.json({ success: true, movement: serialize(movementRow) }, { status: 201 });
    }

    const contributionViolation = validateNewContribution({ amountCents });
    if (contributionViolation) return NextResponse.json({ error: contributionViolation }, { status: 400 });

    const { data, error } = await supabaseClient
      .from("owner_cash_movements")
      .insert({
        owner_id: effectiveOwnerId,
        property_id: propertyId,
        kind,
        amount: Math.round(amount * 100) / 100,
        movement_date: movementDate,
        method,
        memo,
        status: "active",
        created_by: user.id,
      })
      .select("id, property_id, kind, amount, movement_date, method, memo, status, voided_at, created_by, created_at")
      .single();
    if (error) throw error;

    return NextResponse.json({ success: true, movement: serialize(data) }, { status: 201 });
  } catch (error) {
    console.error("Owner movement create error", error);
    return NextResponse.json({ error: "Unable to record the owner movement." }, { status: 500 });
  }
}

export async function PATCH(request) {
  try {
    const authenticated = await createAuthenticatedRentalManagerApplication();
    if (authenticated.response) return authenticated.response;
    const forbidden = await requireOwner(authenticated);
    if (forbidden) return forbidden;
    const { supabaseClient, effectiveOwnerId, user } = authenticated;

    const body = await request.json();
    const id = String(body.id || "").trim();
    if (!id) return NextResponse.json({ error: "id is required." }, { status: 400 });

    // Look the row up inside the workspace first: a cross-workspace id 404s
    // instead of leaking existence, and only active rows can be voided.
    const { data: existing, error: lookupError } = await supabaseClient
      .from("owner_cash_movements")
      .select("id, status")
      .eq("owner_id", effectiveOwnerId)
      .eq("id", id)
      .single();
    if (lookupError || !existing) {
      return NextResponse.json({ error: "Owner movement not found." }, { status: 404 });
    }
    if (existing.status !== "active") {
      return NextResponse.json({ error: "Only an active movement can be voided." }, { status: 409 });
    }

    const { data, error } = await supabaseClient
      .from("owner_cash_movements")
      .update({
        status: "voided",
        voided_at: new Date().toISOString(),
        voided_by: user.id,
        updated_at: new Date().toISOString(),
      })
      .eq("owner_id", effectiveOwnerId)
      .eq("id", id)
      .eq("status", "active")
      .select("id, property_id, kind, amount, movement_date, method, memo, status, voided_at, created_by, created_at")
      .single();
    if (error) throw error;

    return NextResponse.json({ success: true, movement: serialize(data) });
  } catch (error) {
    console.error("Owner movement void error", error);
    return NextResponse.json({ error: "Unable to void the owner movement." }, { status: 500 });
  }
}
