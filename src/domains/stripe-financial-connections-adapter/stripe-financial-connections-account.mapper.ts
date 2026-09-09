import {
  createFinancialAccount,
} from "../financial-account";

import type {
  FinancialAccount,
  FinancialAccountMapper,
  FinancialAccountType,
} from "../financial-account";

import type {
  StripeFinancialConnectionsAccount,
} from "./stripe-financial-connections-account.types";

import type Stripe from "stripe";

export class StripeFinancialConnectionsAccountMapper
  implements FinancialAccountMapper<StripeFinancialConnectionsAccount> {
  map(
    account: StripeFinancialConnectionsAccount,
    connectionId: string,
    provider: string,
    institutionId: string,
  ): FinancialAccount {
    const now = new Date().toISOString();

    return createFinancialAccount({
      id: `financial_account_${provider}_${account.accountId}`,
      connectionId,
      provider,
      providerAccountId: account.accountId,
      institutionId,
      name: account.displayName ?? account.institutionName ?? "Stripe Financial Connections account",
      officialName: account.institutionName,
      mask: account.last4,
      type: toFinancialAccountType(account.category),
      subtype: account.subcategory,
      currencyCode: (account.currency ?? "usd").toUpperCase(),
      active: account.status === "active",
      createdAt: now,
      updatedAt: now,
    });
  }

  mapMany(
    accounts: readonly StripeFinancialConnectionsAccount[],
    connectionId: string,
    provider: string,
    institutionId: string,
  ): readonly FinancialAccount[] {
    return accounts.map((account) =>
      this.map(account, connectionId, provider, institutionId),
    );
  }
}

// Stripe's own account.category (Accounts.d.ts: Account.Category = 'cash' | 'credit' |
// 'investment' | 'other' | OtherString). No "loan" category exists on Stripe's side (a
// mortgage/line_of_credit shows up as category "credit", subcategory "mortgage"/"line_of_credit")
// -- mapped to canonical "loan" only via subcategory, category alone only distinguishes
// cash/credit/investment/other.
function toFinancialAccountType(
  category: Stripe.FinancialConnections.Account.Category,
): FinancialAccountType {
  if (category === "cash") return "depository";
  if (category === "credit") return "credit";
  if (category === "investment") return "investment";
  return "other";
}
