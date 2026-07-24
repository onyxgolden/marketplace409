import {
AccountImportService,
ConnectionImportOrchestrator,
ConnectionPersistenceService,
ConnectionProvisioningService,
InMemoryConnectionRepository,
InMemoryCredentialReferenceRepository,
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
connectionImportOrchestrator,
transactionImportService,
financialAccountImportService,
accountBalanceImportService,
});

return Object.freeze({
providers,
plaidProvider,
providerRegistry,
connectionRepository,
credentialReferenceRepository,
institutionReferenceRepository,
financialAccountRepository,
accountBalanceRepository,
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
connectionQueryService,
connectionSummaryQueryService,
connectionReadModelAdapter,
connectionReadModelApplication,
connectionOperationsApplication,
});
}
