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
    const [accounts, balances] = await Promise.all([
      suite.financialAccountRepository.findByOwnerId(authenticated.user.id),
      suite.accountBalanceRepository.findLatestByOwnerId(authenticated.user.id),
    ]);

    const balanceByAccountId = new Map(balances.map((balance) => [balance.financialAccountId, balance]));

    const eligible = accounts
      .filter((account) => account.active !== false && RECOGNIZED_TYPES.has(account.type))
      .map((account) => {
        const balance = balanceByAccountId.get(account.id) || null;
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
        };
      });

    return NextResponse.json({ success: true, accounts: eligible });
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
