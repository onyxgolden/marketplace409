import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type {
  CredentialVaultRepository,
} from "../credential-vault.repository";

import {
  CredentialVaultService,
} from "../credential-vault.service";

describe("CredentialVaultService", () => {
  it("stores a credential through the injected repository", async () => {
    const repository = createRepository();
    const service = new CredentialVaultService(repository);

    await service.storeCredential({
      ownerId: "owner-1",
      vaultReference: "vault://credential-1",
      secret: "secret-1",
      storedAt: "2026-07-25T02:00:00.000Z",
    });

    expect(repository.store).toHaveBeenCalledTimes(1);
  });

  it("passes the exact vault reference and secret to the repository", async () => {
    const repository = createRepository();
    const service = new CredentialVaultService(repository);

    await service.storeCredential({
      ownerId: "owner-1",
      vaultReference: "vault://credential-1",
      secret: "secret-1",
      storedAt: "2026-07-25T02:00:00.000Z",
    });

    expect(repository.store).toHaveBeenCalledWith(
      "owner-1",
      "vault://credential-1",
      "secret-1",
    );
  });

  it("returns the canonical storage result", async () => {
    const repository = createRepository();
    const service = new CredentialVaultService(repository);

    await expect(
      service.storeCredential({
        ownerId: "owner-1",
        vaultReference: "vault://credential-1",
        secret: "secret-1",
        storedAt: "2026-07-25T02:00:00.000Z",
      }),
    ).resolves.toEqual({
      vaultReference: "vault://credential-1",
      storedAt: "2026-07-25T02:00:00.000Z",
      stored: true,
    });
  });

  it("does not expose the stored secret in the result", async () => {
    const repository = createRepository();
    const service = new CredentialVaultService(repository);

    const result = await service.storeCredential({
      ownerId: "owner-1",
      vaultReference: "vault://credential-1",
      secret: "secret-1",
      storedAt: "2026-07-25T02:00:00.000Z",
    });

    expect(result).not.toHaveProperty("secret");
    expect(result).not.toHaveProperty("accessToken");
    expect(JSON.stringify(result)).not.toContain("secret-1");
  });

  it("rejects an empty vault reference without calling the repository", async () => {
    const repository = createRepository();
    const service = new CredentialVaultService(repository);

    await expect(
      service.storeCredential({
        ownerId: "owner-1",
        vaultReference: " ",
        secret: "secret-1",
      }),
    ).rejects.toThrow(
      "vaultReference must be a non-empty string.",
    );

    expect(repository.store).not.toHaveBeenCalled();
  });

  it("rejects an empty secret without calling the repository", async () => {
    const repository = createRepository();
    const service = new CredentialVaultService(repository);

    await expect(
      service.storeCredential({
        ownerId: "owner-1",
        vaultReference: "vault://credential-1",
        secret: " ",
      }),
    ).rejects.toThrow(
      "secret must be a non-empty string.",
    );

    expect(repository.store).not.toHaveBeenCalled();
  });

  it("propagates repository storage failures", async () => {
    const repository = createRepository();
    const error = new Error("Credential storage failed.");

    vi.mocked(repository.store).mockRejectedValue(error);

    const service = new CredentialVaultService(repository);

    await expect(
      service.storeCredential({
        ownerId: "owner-1",
        vaultReference: "vault://credential-1",
        secret: "secret-1",
      }),
    ).rejects.toBe(error);
  });

  it("generates a timestamp when one is not supplied", async () => {
    const repository = createRepository();
    const service = new CredentialVaultService(repository);

    const result = await service.storeCredential({
      ownerId: "owner-1",
      vaultReference: "vault://credential-1",
      secret: "secret-1",
    });

    expect(Number.isNaN(Date.parse(result.storedAt))).toBe(false);
  });


  it("retrieves a credential through the injected repository", async () => {
    const repository = createRepository();

    vi.mocked(repository.retrieve).mockResolvedValue(
      "secret-1",
    );

    const service = new CredentialVaultService(repository);

    await expect(
      service.retrieveCredential(
        "owner-1",
        "vault://credential-1",
      ),
    ).resolves.toBe("secret-1");

    expect(repository.retrieve).toHaveBeenCalledWith(
      "owner-1",
      "vault://credential-1",
    );
  });

  it("returns null when a credential does not exist", async () => {
    const repository = createRepository();
    const service = new CredentialVaultService(repository);

    await expect(
      service.retrieveCredential(
        "owner-1",
        "vault://missing",
      ),
    ).resolves.toBeNull();
  });

  it("deletes a credential through the injected repository", async () => {
    const repository = createRepository();

    vi.mocked(repository.delete).mockResolvedValue(
      true,
    );

    const service = new CredentialVaultService(repository);

    await expect(
      service.deleteCredential(
        "owner-1",
        "vault://credential-1",
      ),
    ).resolves.toBe(true);

    expect(repository.delete).toHaveBeenCalledWith(
      "owner-1",
      "vault://credential-1",
    );
  });

  it("checks credential existence through the injected repository", async () => {
    const repository = createRepository();

    vi.mocked(repository.exists).mockResolvedValue(
      true,
    );

    const service = new CredentialVaultService(repository);

    await expect(
      service.credentialExists(
        "owner-1",
        "vault://credential-1",
      ),
    ).resolves.toBe(true);

    expect(repository.exists).toHaveBeenCalledWith(
      "owner-1",
      "vault://credential-1",
    );
  });

  it.each([
    ["retrieveCredential", "retrieve"],
    ["deleteCredential", "delete"],
    ["credentialExists", "exists"],
  ])(
    "rejects an empty vault reference for %s",
    async (serviceMethod, repositoryMethod) => {
      const repository = createRepository();
      const service = new CredentialVaultService(repository);

      await expect(
        service[
          serviceMethod as
            | "retrieveCredential"
            | "deleteCredential"
            | "credentialExists"
        ]("owner-1", " "),
      ).rejects.toThrow(
        "vaultReference must be a non-empty string.",
      );

      expect(
        repository[
          repositoryMethod as
            | "retrieve"
            | "delete"
            | "exists"
        ],
      ).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["retrieveCredential", "retrieve"],
    ["deleteCredential", "delete"],
    ["credentialExists", "exists"],
  ])(
    "propagates repository failures from %s",
    async (serviceMethod, repositoryMethod) => {
      const repository = createRepository();
      const error = new Error(
        "Credential vault operation failed.",
      );

      vi.mocked(
        repository[
          repositoryMethod as
            | "retrieve"
            | "delete"
            | "exists"
        ],
      ).mockRejectedValue(error);

      const service = new CredentialVaultService(repository);

      await expect(
        service[
          serviceMethod as
            | "retrieveCredential"
            | "deleteCredential"
            | "credentialExists"
        ]("owner-1", "vault://credential-1"),
      ).rejects.toBe(error);
    },
  );

  it("exposes the injected repository for composition verification", () => {
    const repository = createRepository();
    const service = new CredentialVaultService(repository);

    expect(service.repository).toBe(repository);
  });
});

function createRepository(): CredentialVaultRepository {
  return {
    store: vi.fn().mockResolvedValue(undefined),
    retrieve: vi.fn().mockResolvedValue(null),
    delete: vi.fn().mockResolvedValue(false),
    exists: vi.fn().mockResolvedValue(false),
  };
}
