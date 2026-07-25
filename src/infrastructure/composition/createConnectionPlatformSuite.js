import {
AccountImportService,
ConnectionImportOrchestrator,
ConnectionPersistenceService,
ConnectionProvisioningService,
CredentialVaultService,
InMemoryConnectionRepository,
InMemoryCredentialReferenceRepository,
InMemoryCredentialVaultRepository,
InMemoryInstitutionReferenceRepository,
createConnectionProviderRegistry,
} from "../../domains/connection";

import {
FinancialAccountImportService,
FinancialAccountService,
InMemoryFinancialAccountRepository,
} from "../../domains/financial-account";

import {
AccountBalanceImportService,
InMemoryAccountBalanceRepository,
} from "../../domains/account-balance";

import {
ConnectionRepositoryStorage,
createLazyConnectionRepository,
} from "./createConnectionRepository.js";

import {
CredentialReferenceRepositoryStorage,
createLazyCredentialReferenceRepository,
} from "./createCredentialReferenceRepository.js";

import {
InstitutionReferenceRepositoryStorage,
createLazyInstitutionReferenceRepository,
} from "./createInstitutionReferenceRepository.js";

import {
createLazyFinancialAccountRepository,
FinancialAccountRepositoryStorage,
} from "./createFinancialAccountRepository.js";

import {
AccountBalanceRepositoryStorage,
createLazyAccountBalanceRepository,
} from "./createAccountBalanceRepository.js";

import {
ConnectionExecutionHistoryRepositoryStorage,
createLazyConnectionExecutionHistoryRepository,
} from "./createConnectionExecutionHistoryRepository.js";

import {
InMemoryTransactionRepository,
TransactionImportService,
} from "../../domains/transaction";

import {
PlaidAccountBalanceMapper,
PlaidFinancialAccountMapper,
PlaidTransactionMapper,
createPlaidAdapter,
} from "../../domains/plaid-adapter";

import {
ConnectionQueryService,
ConnectionSummaryQueryService,
ConnectionReadModelAdapter,
ConnectionReadModelApplication,
ConnectionOperationsApplication,
ConnectionImportExecutionCoordinator,
ConnectionReviewExecutionCoordinator,
ConnectionRepairExecutionCoordinator,
} from "../../application/connection/index.js";

export function createConnectionPlatformSuite(deps = {}) {
const plaidProvider =
deps.plaidProvider || createPlaidAdapter();

const providers =
deps.providers || [plaidProvider];

const providerRegistry =
deps.providerRegistry ||
createConnectionProviderRegistry(providers);

const connectionRepositoryStorage =
deps.connectionRepositoryStorage ||
process.env.CONNECTION_REPOSITORY ||
ConnectionRepositoryStorage.MEMORY;

const connectionRepository =
deps.connectionRepository ||
(
connectionRepositoryStorage ===
ConnectionRepositoryStorage.SUPABASE
  ? createLazyConnectionRepository({
      storage:
        ConnectionRepositoryStorage.SUPABASE,
      supabaseClient: deps.supabaseClient,
    })
  : new InMemoryConnectionRepository()
);

const credentialReferenceRepositoryStorage =
deps.credentialReferenceRepositoryStorage ||
process.env.CREDENTIAL_REFERENCE_REPOSITORY ||
CredentialReferenceRepositoryStorage.MEMORY;

const credentialReferenceRepository =
deps.credentialReferenceRepository ||
(
credentialReferenceRepositoryStorage ===
CredentialReferenceRepositoryStorage.SUPABASE
  ? createLazyCredentialReferenceRepository({
      storage:
        CredentialReferenceRepositoryStorage.SUPABASE,
      supabaseClient: deps.supabaseClient,
    })
  : new InMemoryCredentialReferenceRepository()
);

const credentialVault =
deps.credentialVault ||
new InMemoryCredentialVaultRepository();

const credentialVaultService =
deps.credentialVaultService ||
new CredentialVaultService(credentialVault);

const institutionReferenceRepositoryStorage =
deps.institutionReferenceRepositoryStorage ||
process.env.INSTITUTION_REFERENCE_REPOSITORY ||
InstitutionReferenceRepositoryStorage.MEMORY;

const institutionReferenceRepository =
deps.institutionReferenceRepository ||
(
institutionReferenceRepositoryStorage ===
InstitutionReferenceRepositoryStorage.SUPABASE
  ? createLazyInstitutionReferenceRepository({
      storage:
        InstitutionReferenceRepositoryStorage.SUPABASE,
      supabaseClient: deps.supabaseClient,
    })
  : new InMemoryInstitutionReferenceRepository()
);

const financialAccountRepositoryStorage =
deps.financialAccountRepositoryStorage ||
process.env.FINANCIAL_ACCOUNT_REPOSITORY ||
FinancialAccountRepositoryStorage.MEMORY;

const financialAccountRepository =
deps.financialAccountRepository ||
(
financialAccountRepositoryStorage ===
FinancialAccountRepositoryStorage.SUPABASE
  ? createLazyFinancialAccountRepository({
      storage:
        FinancialAccountRepositoryStorage.SUPABASE,
    })
  : new InMemoryFinancialAccountRepository()
);

const accountBalanceRepositoryStorage =
deps.accountBalanceRepositoryStorage ||
process.env.ACCOUNT_BALANCE_REPOSITORY ||
AccountBalanceRepositoryStorage.MEMORY;

const accountBalanceRepository =
deps.accountBalanceRepository ||
(
accountBalanceRepositoryStorage ===
AccountBalanceRepositoryStorage.SUPABASE
  ? createLazyAccountBalanceRepository({
      storage:
        AccountBalanceRepositoryStorage.SUPABASE,
    })
  : new InMemoryAccountBalanceRepository()
);

const connectionExecutionHistoryRepositoryStorage =
deps.connectionExecutionHistoryRepositoryStorage ||
process.env.CONNECTION_EXECUTION_HISTORY_REPOSITORY ||
ConnectionExecutionHistoryRepositoryStorage.MEMORY;

const connectionExecutionHistoryRepository =
deps.connectionExecutionHistoryRepository ||
createLazyConnectionExecutionHistoryRepository({
storage:
  connectionExecutionHistoryRepositoryStorage,
supabaseClient:
  deps.supabaseClient,
});

const transactionRepository =
deps.transactionRepository ||
new InMemoryTransactionRepository();

const financialAccountMapper =
deps.financialAccountMapper ||
new PlaidFinancialAccountMapper();

const accountBalanceMapper =
deps.accountBalanceMapper ||
new PlaidAccountBalanceMapper();

const transactionMapper =
deps.transactionMapper ||
new PlaidTransactionMapper();

const provisioningService =
deps.provisioningService ||
new ConnectionProvisioningService();

const persistenceService =
deps.persistenceService ||
new ConnectionPersistenceService(
connectionRepository,
credentialReferenceRepository,
institutionReferenceRepository,
);

const connectionImportOrchestrator =
deps.connectionImportOrchestrator ||
new ConnectionImportOrchestrator({
provider: plaidProvider,
});

const accountImportService =
deps.accountImportService ||
new AccountImportService(providerRegistry);

const financialAccountImportService =
deps.financialAccountImportService ||
new FinancialAccountImportService(
financialAccountRepository,
financialAccountMapper,
);

const financialAccountService =
deps.financialAccountService ||
new FinancialAccountService(
financialAccountRepository,
);

const accountBalanceImportService =
deps.accountBalanceImportService ||
new AccountBalanceImportService(
accountBalanceRepository,
accountBalanceMapper,
);

const transactionImportService =
deps.transactionImportService ||
new TransactionImportService(
transactionRepository,
transactionMapper,
);

const connectionImportExecutionCoordinator =
deps.connectionImportExecutionCoordinator ||
new ConnectionImportExecutionCoordinator({
connectionRepository,
credentialReferenceRepository,
institutionReferenceRepository,
accountImportService,
financialAccountImportService,
accountBalanceImportService,
transactionImportService,
});

const connectionReviewExecutionCoordinator =
deps.connectionReviewExecutionCoordinator ||
new ConnectionReviewExecutionCoordinator({
connectionRepository,
credentialReferenceRepository,
institutionReferenceRepository,
});

const connectionRepairExecutionCoordinator =
deps.connectionRepairExecutionCoordinator ||
new ConnectionRepairExecutionCoordinator({
connectionRepository,
credentialReferenceRepository,
institutionReferenceRepository,
providerRegistry,
});

const connectionQueryService =
deps.connectionQueryService ||
new ConnectionQueryService({
connectionRepository,
});

const connectionSummaryQueryService =
deps.connectionSummaryQueryService ||
new ConnectionSummaryQueryService({
connectionQueryService,
institutionReferenceRepository,
providerRegistry,
});

const connectionReadModelAdapter =
deps.connectionReadModelAdapter ||
new ConnectionReadModelAdapter();

const connectionReadModelApplication =
deps.connectionReadModelApplication ||
new ConnectionReadModelApplication({
connectionSummaryQueryService,
readModelAdapter:
connectionReadModelAdapter,
currentOwnerId: deps.currentOwnerId,
});

const connectionOperationsApplication =
deps.connectionOperationsApplication ||
new ConnectionOperationsApplication({
connectionReadModelApplication,
connectionReviewExecutionCoordinator,
connectionRepairExecutionCoordinator,
connectionImportExecutionCoordinator,
});

return Object.freeze({
providers,
plaidProvider,
providerRegistry,
connectionRepository,
credentialReferenceRepository,
credentialVault,
credentialVaultService,
institutionReferenceRepository,
financialAccountRepository,
accountBalanceRepository,
connectionExecutionHistoryRepository,
transactionRepository,
financialAccountMapper,
accountBalanceMapper,
transactionMapper,
provisioningService,
persistenceService,
connectionImportOrchestrator,
accountImportService,
financialAccountImportService,
financialAccountService,
accountBalanceImportService,
transactionImportService,
connectionImportExecutionCoordinator,
connectionReviewExecutionCoordinator,
connectionRepairExecutionCoordinator,
connectionQueryService,
connectionSummaryQueryService,
connectionReadModelAdapter,
connectionReadModelApplication,
connectionOperationsApplication,
});
}
