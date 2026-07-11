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
InMemoryAccountBalanceRepository,
} from "../../domains/account-balance";

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

export function createConnectionPlatformSuite(deps = {}) {
const plaidProvider =
deps.plaidProvider || createPlaidAdapter();

const providers =
deps.providers || [plaidProvider];

const providerRegistry =
deps.providerRegistry ||
createConnectionProviderRegistry(providers);

const connectionRepository =
deps.connectionRepository ||
new InMemoryConnectionRepository();

const credentialReferenceRepository =
deps.credentialReferenceRepository ||
new InMemoryCredentialReferenceRepository();

const institutionReferenceRepository =
deps.institutionReferenceRepository ||
new InMemoryInstitutionReferenceRepository();

const financialAccountRepository =
deps.financialAccountRepository ||
new InMemoryFinancialAccountRepository();

const accountBalanceRepository =
deps.accountBalanceRepository ||
new InMemoryAccountBalanceRepository();

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

const transactionImportService =
deps.transactionImportService ||
new TransactionImportService(
transactionRepository,
transactionMapper,
);

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
transactionImportService,
});
}
