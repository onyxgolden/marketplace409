import {
  describe,
  expect,
  it,
} from "vitest";

import {
  InMemoryFinancialAccountRepository,
} from "../in-memory-financial-account.repository";

import {
  createFinancialAccount,
} from "../financial-account.types";

describe("InMemoryFinancialAccountRepository", () => {
  it("saves and retrieves an account by id", async () => {
    const repository = new InMemoryFinancialAccountRepository();

    const account = createFinancialAccount({
      id: "financial_account_1",
      connectionId: "connection_1",
      provider: "plaid",
      providerAccountId: "plaid_account_1",
      institutionId: "institution_1",
      name: "Operating Checking",
      officialName: "Business Operating Checking",
      mask: "1234",
      type: "depository",
      subtype: "checking",
      currencyCode: "USD",
      active: true,
      createdAt: "2026-07-02T00:00:00.000Z",
      updatedAt: "2026-07-02T00:00:00.000Z",
    });

    await repository.save(account);

    expect(await repository.findById(account.id)).toEqual(account);
  });

  it("finds accounts by connection", async () => {
    const repository = new InMemoryFinancialAccountRepository();

    const account = createFinancialAccount({
      id: "financial_account_1",
      connectionId: "connection_1",
      provider: "plaid",
      providerAccountId: "plaid_account_1",
      institutionId: "institution_1",
      name: "Operating Checking",
      officialName: null,
      mask: "1234",
      type: "depository",
      subtype: "checking",
      currencyCode: "USD",
      active: true,
      createdAt: "2026-07-02T00:00:00.000Z",
      updatedAt: "2026-07-02T00:00:00.000Z",
    });

    await repository.save(account);

    const results = await repository.findByConnection("connection_1");

    expect(results).toHaveLength(1);
    expect(results[0]).toEqual(account);
  });

  it("finds an account by provider account id", async () => {
    const repository = new InMemoryFinancialAccountRepository();

    const account = createFinancialAccount({
      id: "financial_account_1",
      connectionId: "connection_1",
      provider: "plaid",
      providerAccountId: "plaid_account_1",
      institutionId: "institution_1",
      name: "Operating Checking",
      officialName: null,
      mask: "1234",
      type: "depository",
      subtype: "checking",
      currencyCode: "USD",
      active: true,
      createdAt: "2026-07-02T00:00:00.000Z",
      updatedAt: "2026-07-02T00:00:00.000Z",
    });

    await repository.save(account);

    expect(
      await repository.findByProviderAccountId(
        "plaid",
        "plaid_account_1",
      ),
    ).toEqual(account);
  });
});
