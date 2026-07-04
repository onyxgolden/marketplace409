import {
  createFinancialSnapshotRepository,
  FinancialSnapshotRepositoryStorage,
} from "../createFinancialSnapshotRepository.js";
import { FinancialSnapshotRepository } from "../../../domains/ledger/snapshots/FinancialSnapshotRepository.js";

describe("createFinancialSnapshotRepository", () => {
  const originalStorage = process.env.FINANCIAL_SNAPSHOT_REPOSITORY;

  afterEach(() => {
    if (originalStorage === undefined) {
      delete process.env.FINANCIAL_SNAPSHOT_REPOSITORY;
    } else {
      process.env.FINANCIAL_SNAPSHOT_REPOSITORY = originalStorage;
    }
  });

  it("creates an in-memory repository by default", async () => {
    delete process.env.FINANCIAL_SNAPSHOT_REPOSITORY;

    const repository = await createFinancialSnapshotRepository();

    expect(repository).toBeInstanceOf(FinancialSnapshotRepository);
  });

  it("creates an in-memory repository when explicitly selected", async () => {
    const repository = await createFinancialSnapshotRepository({
      storage: FinancialSnapshotRepositoryStorage.MEMORY,
    });

    expect(repository).toBeInstanceOf(FinancialSnapshotRepository);
  });

  it("creates an in-memory repository from environment selection", async () => {
    process.env.FINANCIAL_SNAPSHOT_REPOSITORY =
      FinancialSnapshotRepositoryStorage.MEMORY;

    const repository = await createFinancialSnapshotRepository();

    expect(repository).toBeInstanceOf(FinancialSnapshotRepository);
  });

  it("rejects unsupported repository storage selections", async () => {
    await expect(
      createFinancialSnapshotRepository({ storage: "unsupported" })
    ).rejects.toThrow(
      "Unsupported financial snapshot repository storage: unsupported"
    );
  });
});
