// providerTransaction here is a canonical Transaction (see
// src/domains/connection/connection-import-payload.types.ts) -- its own account reference field
// is providerAccountId, not accountId. Checking .accountId (a raw-provider-shaped field that
// doesn't exist on the canonical object) silently matched nothing, for every transaction, for
// every provider, always -- found and fixed alongside the double-mapping bug this same canonical
// payload change was made to guard against.
function transactionBelongsToAccount(
  providerTransaction,
  providerAccountId,
) {
  return (
    providerTransaction !== null &&
    typeof providerTransaction === "object" &&
    providerTransaction.providerAccountId ===
      providerAccountId
  );
}

export class ConnectionImportExecutionCoordinator {
  constructor({
    connectionRepository,
    credentialReferenceRepository,
    institutionReferenceRepository,
    accountImportService,
    financialAccountImportService,
    accountBalanceImportService,
    transactionImportService,
    financialEventImportService,
  }) {
    this.connectionRepository =
      connectionRepository;

    this.credentialReferenceRepository =
      credentialReferenceRepository;

    this.institutionReferenceRepository =
      institutionReferenceRepository;

    this.accountImportService =
      accountImportService;

    this.financialAccountImportService =
      financialAccountImportService;

    this.accountBalanceImportService =
      accountBalanceImportService;

    this.transactionImportService =
      transactionImportService;

    this.financialEventImportService =
      financialEventImportService;
  }

  async executeImport({
    connectionId,
    ownerId,
  }) {
    const context = Object.freeze({
      ownerId,
    });

    const connection =
      await this.connectionRepository.getById(
        connectionId,
        context,
      );

    if (connection === null) {
      throw new Error(
        "Connection not found for import execution.",
      );
    }

    if (!connection.credentialReferenceId) {
      throw new Error(
        "Connection credential reference is required for import execution.",
      );
    }

    const credentialReference =
      await this.credentialReferenceRepository.getById(
        connection.credentialReferenceId,
        context,
      );

    if (credentialReference === null) {
      throw new Error(
        "Credential reference not found for import execution.",
      );
    }

    const institutionReferences =
      await this.institutionReferenceRepository.getAll(
        context,
      );

    const institutionReference =
      institutionReferences.find(
        (candidate) =>
          candidate.connectionId ===
          connection.id,
      ) ?? null;

    if (institutionReference === null) {
      throw new Error(
        "Institution reference not found for import execution.",
      );
    }

    const connectionPersistenceResult =
      Object.freeze({
        ownerId,
        connection,
        credentialReference,
        institutionReference,
        provisionedAt: connection.createdAt,
        persistedAt: connection.updatedAt,
        readyForImport: true,
      });

    const accountImportResult =
      await this.accountImportService.importAccounts(
        connectionPersistenceResult,
      );

    const payload =
      accountImportResult.payload;

    // payload (from provider.importDataPayload()) is already canonical -- see
    // src/domains/connection/connection-import-payload.types.ts for the authoritative contract.
    // importCanonicalAccounts/importCanonicalBalances/importCanonicalTransactionsForAccount
    // persist it as-is; they do NOT map it again the way importAccounts/importBalances/
    // importTransactionsForAccount do for a caller that still has raw provider data.
    const financialAccountImportResult =
      await this.financialAccountImportService.importCanonicalAccounts(
        accountImportResult,
        payload.accounts,
        payload.occurredAt,
      );

    const accountBalanceImportResult =
      await this.accountBalanceImportService.importCanonicalBalances(
        financialAccountImportResult,
        payload.balances,
        payload.occurredAt,
      );

    const transactionImportResults = [];
    // Paired 1:1 with transactionImportResults, in the same per-account loop iteration, rather than
    // zipped back together afterward by array index -- avoids depending on both arrays staying in
    // matching order.
    const businessScopeByResultIndex = [];

    for (
      const financialAccount of
      financialAccountImportResult.financialAccounts
    ) {
      const providerTransactions =
        payload.transactions.filter(
          (providerTransaction) =>
            transactionBelongsToAccount(
              providerTransaction,
              financialAccount.providerAccountId,
            ),
        );

      const transactionImportResult =
        await this.transactionImportService
          .importCanonicalTransactionsForAccount(
            financialAccountImportResult,
            financialAccount,
            providerTransactions,
            payload.occurredAt,
          );

      transactionImportResults.push(
        transactionImportResult,
      );
      // The account this batch of transactions was persisted under is already classified (see
      // FinancialAccountImportService.persistFinancialAccounts) -- reused here rather than
      // reclassified, so a future manual override on the account is honored automatically.
      businessScopeByResultIndex.push(
        financialAccount.businessScope ?? null,
      );
    }

    const financialEventImportResults =
      await Promise.all(
        transactionImportResults.map(
          (transactionImportResult, index) =>
            this.financialEventImportService.import(
              transactionImportResult,
              { businessScope: businessScopeByResultIndex[index] },
            ),
        ),
      );

    const financialEventsImported =
      financialEventImportResults.reduce(
        (total, result) =>
          total +
          result.importedFinancialEventCount,
        0,
      );

    const failedFinancialEventCount =
      financialEventImportResults.reduce(
        (total, result) =>
          total +
          result.failedFinancialEventCount,
        0,
      );

    const transactionsImported =
      transactionImportResults.reduce(
        (total, result) =>
          total +
          result.importedTransactionCount,
        0,
      );

    const failedTransactionCount =
      transactionImportResults.reduce(
        (total, result) =>
          total +
          result.failedTransactionCount,
        0,
      );

    const failedRecordCount =
      financialAccountImportResult
        .failedFinancialAccountCount +
      accountBalanceImportResult
        .failedAccountBalanceCount +
      failedTransactionCount +
      failedFinancialEventCount;

    const success =
      accountImportResult.success &&
      financialAccountImportResult.success &&
      accountBalanceImportResult.success &&
      transactionImportResults.every(
        (result) => result.success,
      ) &&
      financialEventImportResults.every(
        (result) => result.success,
      ) &&
      failedRecordCount === 0;

    // A successful import is the only thing that moves the "last imported"
    // marker -- failed or errored executions leave it untouched so the
    // connections page never claims an import happened that did not.
    if (success) {
      await this.connectionRepository.save(
        {
          ...connection,
          lastImportedAt:
            new Date().toISOString(),
          updatedAt:
            new Date().toISOString(),
        },
        context,
      );
    }

    return Object.freeze({
      provider: payload.provider,
      connectionId: payload.connectionId,
      success,
      financialAccountsImported:
        financialAccountImportResult
          .importedFinancialAccountCount,
      accountBalancesImported:
        accountBalanceImportResult
          .importedAccountBalanceCount,
      transactionsImported,
      financialEventsImported,
      failedRecordCount,
      occurredAt: payload.occurredAt,
    });
  }
}
