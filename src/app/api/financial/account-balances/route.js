import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { createAuthenticatedFinancialApplication } from "@/lib/supabase/createAuthenticatedFinancialApplication";
import { ASSET_ACCOUNT_TYPES, LIABILITY_ACCOUNT_TYPES } from "@/domains/financial-position";

const RECOGNIZED_TYPES = new Set([...ASSET_ACCOUNT_TYPES, ...LIABILITY_ACCOUNT_TYPES]);
const MANUAL_PROVIDER = "manual";
const MANUAL_CONNECTION_ID = "manual";

export async function GET() {
  const authenticated = await createAuthenticatedFinancialApplication();
  if (authenticated.response) return authenticated.response;

  try {
    const suite = await authenticated.getFinancialApplicationSuite();

    // The position service is the single authority on which account balances count
    // toward net worth: it resolves duplicate-group membership (same_real_account)
    // and drops accounts with no balance at all. The panel must never guess that
    // itself -- and must never silently fall back to counting every row if the
    // projection fails, so a missing/failing service is a loud 500, not a quiet
    // double-count.
    const positionService = suite.financialPositionQueryService;
    if (!positionService || typeof positionService.buildPosition !== "function") {
      throw new Error("Financial position service is unavailable.");
    }

    const [accounts, balances, position] = await Promise.all([
      suite.financialAccountRepository.findByOwnerId(authenticated.user.id),
      suite.accountBalanceRepository.findLatestByOwnerId(authenticated.user.id),
      positionService.buildPosition(authenticated.user.id),
    ]);

    const balanceByAccountId = new Map(balances.map((balance) => [balance.financialAccountId, balance]));

    // Projected IDs are the position's own verdicts, reused verbatim -- never
    // re-derived here from group membership or balance freshness.
    const positionById = new Map();
    for (const asset of position.assets) {
      positionById.set(asset.id, { kind: "asset", degraded: asset.degraded ?? null, sourceLabel: asset.source_label ?? null });
    }
    for (const liability of position.liabilities) {
      positionById.set(liability.id, { kind: "liability", degraded: liability.degraded ?? null, sourceLabel: liability.source_label ?? null });
    }

    const eligible = accounts
      .filter((account) => account.active !== false && RECOGNIZED_TYPES.has(account.type))
      .map((account) => {
        const balance = balanceByAccountId.get(account.id) || null;
        const positionEntry = positionById.get(account.id) || null;
        return {
          id: account.id,
          name: account.name,
          type: account.type,
          kind: ASSET_ACCOUNT_TYPES.has(account.type) ? "asset" : "liability",
          latestBalance: balance ? {
            currentBalanceCents: balance.currentBalanceCents,
            asOf: balance.asOf,
            provider: balance.provider,
            editable: balance.provider === MANUAL_PROVIDER,
          } : null,
          // False exactly when the position excludes this account (superseded group
          // member, or no balance row at all). The panel counts only included rows.
          includedInPosition: positionEntry !== null,
          degraded: positionEntry?.degraded ?? null,
          sourceLabel: positionEntry?.sourceLabel ?? null,
        };
      });

    return NextResponse.json({
      success: true,
      accounts: eligible,
      position: {
        supersededBalances: position.supersededBalances,
        missingBalances: position.missingBalances,
      },
    });
  } catch (error) {
    console.error("Account balances list error", error);
    const message = error?.message || "Unable to load account balances.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request) {
  const authenticated = await createAuthenticatedFinancialApplication();
  if (authenticated.response) return authenticated.response;

  try {
    const body = await request.json();
    const financialAccountId = String(body?.financialAccountId || "").trim();
    const currentBalanceCents = Number(body?.currentBalanceCents);
    const asOf = String(body?.asOf || "").trim() || new Date().toISOString().slice(0, 10);

    if (!financialAccountId) return NextResponse.json({ error: "A financial account is required." }, { status: 400 });
    if (!Number.isFinite(currentBalanceCents) || !Number.isInteger(currentBalanceCents)) {
      return NextResponse.json({ error: "Balance must be a whole number of cents." }, { status: 400 });
    }
    if (!/^\d{4}-\d{2}-\d{2}/.test(asOf)) return NextResponse.json({ error: "As-of date is invalid." }, { status: 400 });

    const suite = await authenticated.getFinancialApplicationSuite();

    const accounts = await suite.financialAccountRepository.findByOwnerId(authenticated.user.id);
    const account = accounts.find((candidate) => candidate.id === financialAccountId && candidate.active !== false);
    if (!account) return NextResponse.json({ error: "This account does not exist for this owner." }, { status: 400 });
    if (!RECOGNIZED_TYPES.has(account.type)) {
      return NextResponse.json({ error: "This account type is not tracked in net worth." }, { status: 400 });
    }

    const existing = await suite.accountBalanceRepository.findLatestByFinancialAccount(financialAccountId);
    if (existing && existing.provider !== MANUAL_PROVIDER) {
      return NextResponse.json({
        error: `This account is synced automatically from ${existing.provider} and can't be edited manually.`,
      }, { status: 409 });
    }

    const saved = await suite.accountBalanceRepository.save({
      id: `account_balance_${randomUUID()}`,
      financialAccountId,
      connectionId: MANUAL_CONNECTION_ID,
      provider: MANUAL_PROVIDER,
      providerAccountId: financialAccountId,
      currencyCode: "USD",
      currentBalanceCents,
      availableBalanceCents: null,
      asOf,
      createdAt: new Date().toISOString(),
    }, { ownerId: authenticated.user.id });

    return NextResponse.json({ success: true, balance: saved });
  } catch (error) {
    console.error("Account balance save error", error);
    const message = error?.message || "Unable to save the account balance.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
