import { NextResponse } from "next/server";
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { getActiveWorkspaceRole } from "@/lib/supabase/getActiveWorkspaceRole";
import {
  getChartAccounts,
  getAccountUsageCount,
  SEED_CODES,
} from "@/application/rental/chartOfAccounts";

const CODE_PATTERN = /^[a-z0-9_]+$/;
const MAX_CODE = 60;
const MAX_LABEL = 120;
const VALID_TYPES = new Set(["income", "expense"]);

async function requireWriter(authenticated) {
  if ((await getActiveWorkspaceRole({ supabaseClient: authenticated.supabaseClient, actorUserId: authenticated.user.id })) === "read_only") {
    return NextResponse.json({ error: "Read-only members cannot change the chart of accounts." }, { status: 403 });
  }
  return null;
}

function serialize(account, usageCount) {
  return {
    id: account.id,
    code: account.code,
    label: account.label,
    account_type: account.account_type,
    is_active: account.is_active,
    is_system: account.is_system,
    usage_count: usageCount,
  };
}

// GET /api/rental/chart-of-accounts — the owner's chart, grouped client-side.
// ?transactionsFor=<code> also returns the 50 most recent ledger rows posting
// to that account (for the account detail drawer).
export async function GET(request) {
  try {
    const authenticated = await createAuthenticatedRentalManagerApplication();
    if (authenticated.response) return authenticated.response;
    const { supabaseClient, effectiveOwnerId } = authenticated;

    const accounts = await getChartAccounts(supabaseClient, effectiveOwnerId);
    const withUsage = [];
    for (const account of accounts) {
      withUsage.push(serialize(account, await getAccountUsageCount(supabaseClient, effectiveOwnerId, account.code)));
    }

    const transactionsFor = new URL(request.url).searchParams.get("transactionsFor");
    let transactions = null;
    if (transactionsFor) {
      const code = String(transactionsFor).trim();
      const known = accounts.some((account) => account.code === code);
      if (!known) return NextResponse.json({ error: "Unknown account code." }, { status: 404 });
      const { data, error } = await supabaseClient
        .from("financial_events")
        .select("id, event_date, description, amount, transaction_kind, property_id")
        .eq("owner_id", effectiveOwnerId)
        .eq("normalized_category", code)
        // Soft-deleted transactions are excluded: the drawer is a live view
        // of the account, not the audit trail (PR #420 retrospective finding 2).
        .eq("is_deleted", false)
        .order("event_date", { ascending: false })
        .limit(50);
      if (error) throw error;
      transactions = data || [];
    }

    return NextResponse.json({ success: true, accounts: withUsage, transactions });
  } catch (error) {
    console.error("Chart of accounts load error", error);
    return NextResponse.json({ error: "Unable to load the chart of accounts." }, { status: 500 });
  }
}

// POST /api/rental/chart-of-accounts — add a custom account.
// Body: { code, label, account_type }.
export async function POST(request) {
  try {
    const authenticated = await createAuthenticatedRentalManagerApplication();
    if (authenticated.response) return authenticated.response;
    const forbidden = await requireWriter(authenticated);
    if (forbidden) return forbidden;
    const { supabaseClient, effectiveOwnerId, user } = authenticated;

    const body = await request.json();
    const code = String(body.code || "").trim().toLowerCase();
    const label = String(body.label || "").trim();
    const accountType = String(body.account_type || "").trim();

    if (!CODE_PATTERN.test(code) || code.length > MAX_CODE) {
      return NextResponse.json({ error: "Code must be lowercase letters, numbers, and underscores (max 60)." }, { status: 400 });
    }
    if (!label || label.length > MAX_LABEL) {
      return NextResponse.json({ error: "A label is required (max 120 characters)." }, { status: 400 });
    }
    if (!VALID_TYPES.has(accountType)) {
      return NextResponse.json({ error: "Account type must be income or expense." }, { status: 400 });
    }
    if (SEED_CODES.has(code)) {
      return NextResponse.json({ error: "That code is already a built-in account." }, { status: 409 });
    }

    const { data: existing } = await supabaseClient
      .from("chart_of_accounts")
      .select("id")
      .eq("owner_id", effectiveOwnerId)
      .eq("code", code)
      .limit(1);
    if (existing && existing.length > 0) {
      return NextResponse.json({ error: "An account with that code already exists." }, { status: 409 });
    }

    const { data, error } = await supabaseClient
      .from("chart_of_accounts")
      .insert({
        owner_id: effectiveOwnerId,
        code,
        label,
        account_type: accountType,
        is_active: true,
        is_system: false,
      })
      .select("id, code, label, account_type, is_active, is_system")
      .single();
    if (error) throw error;

    return NextResponse.json({ success: true, account: serialize(data, 0) }, { status: 201 });
  } catch (error) {
    console.error("Chart of accounts create error", error);
    return NextResponse.json({ error: "Unable to add the account." }, { status: 500 });
  }
}

// PATCH /api/rental/chart-of-accounts — rename or (de)activate.
// Body: { id, label?, is_active? }. Deactivating an account with posted
// transactions is blocked: reassign those transactions first.
export async function PATCH(request) {
  try {
    const authenticated = await createAuthenticatedRentalManagerApplication();
    if (authenticated.response) return authenticated.response;
    const forbidden = await requireWriter(authenticated);
    if (forbidden) return forbidden;
    const { supabaseClient, effectiveOwnerId } = authenticated;

    const body = await request.json();
    const id = String(body.id || "").trim();
    if (!id) return NextResponse.json({ error: "id is required." }, { status: 400 });

    const { data: account, error: lookupError } = await supabaseClient
      .from("chart_of_accounts")
      .select("id, code, label, account_type, is_active, is_system")
      .eq("owner_id", effectiveOwnerId)
      .eq("id", id)
      .single();
    if (lookupError || !account) {
      return NextResponse.json({ error: "Account not found." }, { status: 404 });
    }

    const updates = {};
    if (body.label !== undefined) {
      const label = String(body.label).trim();
      if (!label || label.length > MAX_LABEL) {
        return NextResponse.json({ error: "A label is required (max 120 characters)." }, { status: 400 });
      }
      updates.label = label;
    }
    let deactivating = false;
    if (body.is_active !== undefined) {
      if (typeof body.is_active !== "boolean") {
        return NextResponse.json({ error: "is_active must be true or false." }, { status: 400 });
      }
      // Deactivation is the racy half of the deactivation/posting pair; it
      // goes through the RPC below. Reactivation has no race and stays a
      // plain update.
      if (body.is_active === false) deactivating = true;
      else updates.is_active = true;
    }
    if (Object.keys(updates).length === 0 && !deactivating) {
      return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
    }

    // The row lock, the usage check, and the write happen atomically inside
    // the RPC, coordinated with concurrent postings via the chart row lock
    // (PR #420 retrospective finding 1). It runs before any label update so
    // a blocked deactivation leaves the label untouched, as before.
    if (deactivating) {
      const { error: deactivateError } = await supabaseClient.rpc("deactivate_chart_account", {
        p_owner_id: effectiveOwnerId,
        p_account_id: id,
      });
      if (deactivateError) {
        const message = deactivateError.message || "";
        if (/has \d+ transactions? posted to it/i.test(message)) {
          return NextResponse.json({ error: message }, { status: 409 });
        }
        if (deactivateError.code === "P0002") {
          return NextResponse.json({ error: "Account not found." }, { status: 404 });
        }
        throw deactivateError;
      }
    }

    let updated = account;
    if (Object.keys(updates).length > 0) {
      const labelUpdates = { ...updates, updated_at: new Date().toISOString() };
      const { data, error: updateError } = await supabaseClient
        .from("chart_of_accounts")
        .update(labelUpdates)
        .eq("owner_id", effectiveOwnerId)
        .eq("id", id)
        .select("id, code, label, account_type, is_active, is_system")
        .single();
      if (updateError) throw updateError;
      updated = data;
    } else if (deactivating) {
      // Deactivation-only: the RPC already wrote the row; reflect it here so
      // the response carries the new state.
      updated = { ...account, is_active: false };
    }

    const usage = await getAccountUsageCount(supabaseClient, effectiveOwnerId, updated.code);
    return NextResponse.json({ success: true, account: serialize(updated, usage) });
  } catch (error) {
    console.error("Chart of accounts update error", error);
    return NextResponse.json({ error: "Unable to update the account." }, { status: 500 });
  }
}
