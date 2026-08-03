function transactionBelongsToAccount(
  providerTransaction,
  providerAccountId,
) {
  return (
    providerTransaction !== null &&
    typeof providerTransaction === "object" &&
    providerTransaction.accountId ===
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

    const financialAccountImportResult =
      await this.financialAccountImportService.importAccounts(
        accountImportResult,
        payload.accounts,
        payload.occurredAt,
      );

    const accountBalanceImportResult =
      await this.accountBalanceImportService.importBalances(
        financialAccountImportResult,
        payload.balances,
        payload.occurredAt,
      );

    const transactionImportResults = [];

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
          .importTransactionsForAccount(
            financialAccountImportResult,
            financialAccount,
            providerTransactions,
            payload.occurredAt,
          );

      transactionImportResults.push(
        transactionImportResult,
      );
    }

    const financialEventImportResults =
      await Promise.all(
        transactionImportResults.map(
          (transactionImportResult) =>
            this.financialEventImportService.import(
              transactionImportResult,
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
