import {
describe,
expect,
it,
} from "vitest";

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
} from "../../../domains/connection";

import {
FinancialAccountImportService,
FinancialAccountService,
InMemoryFinancialAccountRepository,
} from "../../../domains/financial-account";

import {
AccountBalanceImportService,
InMemoryAccountBalanceRepository,
} from "../../../domains/account-balance";

import {
InMemoryTransactionRepository,
TransactionImportService,
} from "../../../domains/transaction";

import {
PlaidAccountBalanceMapper,
PlaidFinancialAccountMapper,
PlaidTransactionMapper,
} from "../../../domains/plaid-adapter";

import {
createConnectionPlatformSuite,
} from "../createConnectionPlatformSuite.js";

describe("createConnectionPlatformSuite", () => {
it("builds the default connection platform suite", () => {
const suite = createConnectionPlatformSuite();


expect(suite.plaidProvider.provider).toBe("plaid");
expect(suite.providers).toEqual([
  suite.plaidProvider,
]);
expect(suite.providerRegistry.totalProviders).toBe(1);
expect(suite.providerRegistry.providerNames).toEqual([
  "plaid",
]);

expect(suite.connectionRepository).toBeInstanceOf(
  InMemoryConnectionRepository,
);
expect(suite.credentialReferenceRepository).toBeInstanceOf(
  InMemoryCredentialReferenceRepository,
);
expect(suite.credentialVault).toBeInstanceOf(
  InMemoryCredentialVaultRepository,
);
expect(suite.credentialVaultService).toBeInstanceOf(
  CredentialVaultService,
);
expect(suite.credentialVaultService.repository).toBe(
  suite.credentialVault,
);
expect(suite.institutionReferenceRepository).toBeInstanceOf(
  InMemoryInstitutionReferenceRepository,
);
expect(suite.financialAccountRepository).toBeInstanceOf(
  InMemoryFinancialAccountRepository,
);
expect(suite.accountBalanceRepository).toBeInstanceOf(
  InMemoryAccountBalanceRepository,
);
expect(suite.transactionRepository).toBeInstanceOf(
  InMemoryTransactionRepository,
);

expect(suite.financialAccountMapper).toBeInstanceOf(
  PlaidFinancialAccountMapper,
);
expect(suite.accountBalanceMapper).toBeInstanceOf(
  PlaidAccountBalanceMapper,
);
expect(suite.transactionMapper).toBeInstanceOf(
  PlaidTransactionMapper,
);

expect(suite.provisioningService).toBeInstanceOf(
  ConnectionProvisioningService,
);
expect(suite.persistenceService).toBeInstanceOf(
  ConnectionPersistenceService,
);
expect(suite.connectionImportOrchestrator).toBeInstanceOf(
  ConnectionImportOrchestrator,
);
expect(suite.accountImportService).toBeInstanceOf(
  AccountImportService,
);
expect(suite.financialAccountImportService).toBeInstanceOf(
  FinancialAccountImportService,
);
expect(suite.accountBalanceImportService).toBeInstanceOf(
  AccountBalanceImportService,
);
expect(suite.financialAccountService).toBeInstanceOf(
  FinancialAccountService,
);
expect(suite.transactionImportService).toBeInstanceOf(
  TransactionImportService,
);

expect(Object.isFrozen(suite)).toBe(true);


});

it("injects repositories and mappers through the service graph", () => {
const connectionRepository = {
getAll: vi.fn(),
};
const credentialReferenceRepository = {};
const credentialVault = {};
const institutionReferenceRepository = {
getAll: vi.fn(),
};
const financialAccountRepository = {};
const accountBalanceRepository = {};
const transactionRepository = {};
const financialAccountMapper = {};
const accountBalanceMapper = {};
const transactionMapper = {};


const suite = createConnectionPlatformSuite({
  connectionRepository,
  credentialReferenceRepository,
  credentialVault,
  institutionReferenceRepository,
  financialAccountRepository,
  accountBalanceRepository,
  transactionRepository,
  financialAccountMapper,
  accountBalanceMapper,
  transactionMapper,
});

expect(suite.connectionRepository).toBe(
  connectionRepository,
);
expect(suite.credentialReferenceRepository).toBe(
  credentialReferenceRepository,
);
expect(suite.credentialVault).toBe(
  credentialVault,
);
expect(suite.credentialVaultService.repository).toBe(
  credentialVault,
);
expect(suite.institutionReferenceRepository).toBe(
  institutionReferenceRepository,
);
expect(suite.financialAccountRepository).toBe(
  financialAccountRepository,
);
expect(suite.accountBalanceRepository).toBe(
  accountBalanceRepository,
);
expect(suite.transactionRepository).toBe(
  transactionRepository,
);
expect(suite.financialAccountMapper).toBe(
  financialAccountMapper,
);
expect(suite.accountBalanceMapper).toBe(
  accountBalanceMapper,
);
expect(suite.transactionMapper).toBe(
  transactionMapper,
);

expect(suite.persistenceService.connectionRepository).toBe(
  connectionRepository,
);
expect(
  suite.persistenceService.credentialReferenceRepository,
).toBe(
  credentialReferenceRepository,
);
expect(
  suite.persistenceService.institutionReferenceRepository,
).toBe(
  institutionReferenceRepository,
);

expect(
  suite.financialAccountImportService.repository,
).toBe(
  financialAccountRepository,
);
expect(
  suite.financialAccountImportService.mapper,
).toBe(
  financialAccountMapper,
);
expect(suite.financialAccountService.repository).toBe(
  financialAccountRepository,
);
expect(suite.transactionImportService.repository).toBe(
  transactionRepository,
);
expect(suite.transactionImportService.mapper).toBe(
  transactionMapper,
);


});

it("allows providers, registry, and services to be injected", () => {
const plaidProvider = {
provider: "plaid",
};
const providers = [
plaidProvider,
];
const providerRegistry = {};
const provisioningService = {};
const persistenceService = {};
const credentialVaultService = {};
const connectionImportOrchestrator = {};
const accountImportService = {};
const financialAccountImportService = {};
const financialAccountService = {};
const transactionImportService = {};
const connectionQueryService = {};
const connectionSummaryQueryService = {};
const connectionReadModelAdapter = {};
const connectionReadModelApplication = {};


const suite = createConnectionPlatformSuite({
  plaidProvider,
  providers,
  providerRegistry,
  provisioningService,
  persistenceService,
  credentialVaultService,
  connectionImportOrchestrator,
  accountImportService,
  financialAccountImportService,
  financialAccountService,
  transactionImportService,
  connectionQueryService,
  connectionSummaryQueryService,
  connectionReadModelAdapter,
  connectionReadModelApplication,
});

expect(suite.plaidProvider).toBe(plaidProvider);
expect(suite.providers).toBe(providers);
expect(suite.providerRegistry).toBe(
  providerRegistry,
);
expect(suite.provisioningService).toBe(
  provisioningService,
);
expect(suite.persistenceService).toBe(
  persistenceService,
);
expect(suite.credentialVaultService).toBe(
  credentialVaultService,
);
expect(suite.connectionImportOrchestrator).toBe(
  connectionImportOrchestrator,
);
expect(suite.accountImportService).toBe(
  accountImportService,
);
expect(suite.financialAccountImportService).toBe(
  financialAccountImportService,
);
expect(suite.financialAccountService).toBe(
  financialAccountService,
);
expect(suite.transactionImportService).toBe(
  transactionImportService,
);

expect(suite.connectionQueryService).toBe(
  connectionQueryService,
);

expect(suite.connectionSummaryQueryService).toBe(
  connectionSummaryQueryService,
);

expect(suite.connectionReadModelAdapter).toBe(
  connectionReadModelAdapter,
);

expect(suite.connectionReadModelApplication).toBe(
  connectionReadModelApplication,
);


});

it("lazily composes the Supabase financial account repository without making the suite asynchronous", () => {
const suite = createConnectionPlatformSuite({
  financialAccountRepositoryStorage: "supabase",
});

expect(suite.financialAccountRepository).not.toBeInstanceOf(
  InMemoryFinancialAccountRepository,
);

expect(
  typeof suite.financialAccountRepository.save,
).toBe("function");

expect(
  typeof suite.financialAccountRepository.saveMany,
).toBe("function");

expect(
  typeof suite.financialAccountRepository.findById,
).toBe("function");

expect(
  typeof suite.financialAccountRepository.findByConnection,
).toBe("function");

expect(
  typeof suite.financialAccountRepository
    .findByProviderAccountId,
).toBe("function");

expect(
  suite.financialAccountImportService.repository,
).toBe(suite.financialAccountRepository);

expect(
  suite.financialAccountService.repository,
).toBe(suite.financialAccountRepository);

expect(Object.isFrozen(suite)).toBe(true);
expect(
  Object.isFrozen(suite.financialAccountRepository),
).toBe(true);
});

it("lazily composes the Supabase account balance repository without making the suite asynchronous", () => {
const suite = createConnectionPlatformSuite({
  accountBalanceRepositoryStorage: "supabase",
});

expect(suite.accountBalanceRepository).not.toBeInstanceOf(
  InMemoryAccountBalanceRepository,
);

expect(
  typeof suite.accountBalanceRepository.save,
).toBe("function");

expect(
  typeof suite.accountBalanceRepository.saveMany,
).toBe("function");

expect(
  typeof suite.accountBalanceRepository
    .findByFinancialAccount,
).toBe("function");

expect(
  typeof suite.accountBalanceRepository
    .findLatestByFinancialAccount,
).toBe("function");

expect(
  typeof suite.accountBalanceRepository
    .findByConnection,
).toBe("function");

expect(Object.isFrozen(suite)).toBe(true);

expect(
  Object.isFrozen(suite.accountBalanceRepository),
).toBe(true);
});


it("propagates the supplied Supabase client into lazy connection repositories", async () => {
const injectedError =
  new Error("Injected Supabase client reached.");

const single = vi.fn().mockResolvedValue({
  data: null,
  error: injectedError,
});

const select = vi.fn(() => ({
  single,
}));

const upsert = vi.fn(() => ({
  select,
}));

const from = vi.fn(() => ({
  upsert,
}));

const supabaseClient = {
  from,
};

const suite = createConnectionPlatformSuite({
  supabaseClient,
  connectionRepositoryStorage: "supabase",
  credentialReferenceRepositoryStorage:
    "supabase",
  institutionReferenceRepositoryStorage:
    "supabase",
});

await expect(
  suite.connectionRepository.save(
    {
      id: "connection-123",
    },
    {
      ownerId: "owner-123",
    },
  ),
).rejects.toThrow(
  "Injected Supabase client reached.",
);

await expect(
  suite.credentialReferenceRepository.save(
    {
      id: "credential-123",
    },
    {
      ownerId: "owner-123",
    },
  ),
).rejects.toThrow(
  "Injected Supabase client reached.",
);

await expect(
  suite.institutionReferenceRepository.save(
    {
      id: "institution-123",
    },
    {
      ownerId: "owner-123",
    },
  ),
).rejects.toThrow(
  "Injected Supabase client reached.",
);

expect(from).toHaveBeenNthCalledWith(
  1,
  "connections",
);

expect(from).toHaveBeenNthCalledWith(
  2,
  "credential_references",
);

expect(from).toHaveBeenNthCalledWith(
  3,
  "institution_references",
);
});

it("lazily composes the Supabase connection repository without making the suite asynchronous", () => {
const suite = createConnectionPlatformSuite({
  connectionRepositoryStorage: "supabase",
});

expect(suite.connectionRepository).not.toBeInstanceOf(
  InMemoryConnectionRepository,
);

expect(
  typeof suite.connectionRepository.save,
).toBe("function");

expect(
  typeof suite.connectionRepository.getById,
).toBe("function");

expect(
  typeof suite.connectionRepository.getAll,
).toBe("function");

expect(
  suite.persistenceService.connectionRepository,
).toBe(suite.connectionRepository);

expect(Object.isFrozen(suite)).toBe(true);

expect(
  Object.isFrozen(suite.connectionRepository),
).toBe(true);
});

it("lazily composes the Supabase credential reference repository without making the suite asynchronous", () => {
const suite = createConnectionPlatformSuite({
  credentialReferenceRepositoryStorage: "supabase",
});

expect(
  suite.credentialReferenceRepository,
).not.toBeInstanceOf(
  InMemoryCredentialReferenceRepository,
);

expect(
  typeof suite.credentialReferenceRepository.save,
).toBe("function");

expect(
  typeof suite.credentialReferenceRepository.getById,
).toBe("function");

expect(
  typeof suite.credentialReferenceRepository.getAll,
).toBe("function");

expect(
  suite.persistenceService.credentialReferenceRepository,
).toBe(suite.credentialReferenceRepository);

expect(Object.isFrozen(suite)).toBe(true);

expect(
  Object.isFrozen(
    suite.credentialReferenceRepository,
  ),
).toBe(true);
});

it("lazily composes the Supabase institution reference repository without making the suite asynchronous", () => {
const suite = createConnectionPlatformSuite({
  institutionReferenceRepositoryStorage: "supabase",
});

expect(
  suite.institutionReferenceRepository,
).not.toBeInstanceOf(
  InMemoryInstitutionReferenceRepository,
);

expect(
  typeof suite.institutionReferenceRepository.save,
).toBe("function");

expect(
  typeof suite.institutionReferenceRepository.getById,
).toBe("function");

expect(
  typeof suite.institutionReferenceRepository.getAll,
).toBe("function");

expect(
  suite.persistenceService.institutionReferenceRepository,
).toBe(suite.institutionReferenceRepository);

expect(Object.isFrozen(suite)).toBe(true);

expect(
  Object.isFrozen(
    suite.institutionReferenceRepository,
  ),
).toBe(true);
});



it("composes connection operations with the connection read model application", () => {
const connectionReadModelApplication = {
  buildConnectionDashboard: vi.fn(),
};

const suite = createConnectionPlatformSuite({
  connectionReadModelApplication,
});

expect(
  typeof suite.connectionOperationsApplication
    .buildConnectionOperations,
).toBe("function");

expect(
  suite.connectionOperationsApplication
    .connectionReadModelApplication,
).toBe(connectionReadModelApplication);

expect(Object.isFrozen(suite)).toBe(true);
});

});
