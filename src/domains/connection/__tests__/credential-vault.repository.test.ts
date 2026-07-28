import {
  describe,
  expect,
  it,
} from "vitest";

import {
  InMemoryCredentialVaultRepository,
} from "../in-memory-credential-vault.repository";

describe(
  "InMemoryCredentialVaultRepository",
  () => {
    it(
      "stores and retrieves a secret by vault reference",
      async () => {
        const repository =
          new InMemoryCredentialVaultRepository();

        await repository.store(
          "owner-1",
          "vault://plaid/items/item_1/access-token",
          "access-token-1",
        );

        await expect(
          repository.retrieve(
            "owner-1",
            "vault://plaid/items/item_1/access-token",
          ),
        ).resolves.toBe("access-token-1");
      },
    );

    it(
      "returns null when a secret does not exist",
      async () => {
        const repository =
          new InMemoryCredentialVaultRepository();

        await expect(
          repository.retrieve(
            "owner-1",
            "vault://missing",
          ),
        ).resolves.toBeNull();
      },
    );

    it(
      "reports whether a secret exists",
      async () => {
        const repository =
          new InMemoryCredentialVaultRepository();

        await repository.store(
          "owner-1",
          "vault://credential-1",
          "secret-1",
        );

        await expect(
          repository.exists(
            "owner-1",
            "vault://credential-1",
          ),
        ).resolves.toBe(true);

        await expect(
          repository.exists(
            "owner-1",
            "vault://credential-2",
          ),
        ).resolves.toBe(false);
      },
    );

    it(
      "replaces a secret stored under the same vault reference",
      async () => {
        const repository =
          new InMemoryCredentialVaultRepository();

        await repository.store(
          "owner-1",
          "vault://credential-1",
          "original-secret",
        );

        await repository.store(
          "owner-1",
          "vault://credential-1",
          "replacement-secret",
        );

        await expect(
          repository.retrieve(
            "owner-1",
            "vault://credential-1",
          ),
        ).resolves.toBe(
          "replacement-secret",
        );
      },
    );

    it(
      "deletes an existing secret",
      async () => {
        const repository =
          new InMemoryCredentialVaultRepository();

        await repository.store(
          "owner-1",
          "vault://credential-1",
          "secret-1",
        );

        await expect(
          repository.delete(
            "owner-1",
            "vault://credential-1",
          ),
        ).resolves.toBe(true);

        await expect(
          repository.retrieve(
            "owner-1",
            "vault://credential-1",
          ),
        ).resolves.toBeNull();
      },
    );

    it(
      "returns false when deleting a missing secret",
      async () => {
        const repository =
          new InMemoryCredentialVaultRepository();

        await expect(
          repository.delete(
            "owner-1",
            "vault://missing",
          ),
        ).resolves.toBe(false);
      },
    );

    it.each([
      ["store reference", "store"],
      ["retrieve reference", "retrieve"],
      ["delete reference", "delete"],
      ["exists reference", "exists"],
    ])(
      "rejects an empty %s",
      async (_label, operation) => {
        const repository =
          new InMemoryCredentialVaultRepository();

        if (operation === "store") {
          await expect(
            repository.store(
              "owner-1",
              " ",
              "secret",
            ),
          ).rejects.toThrow(
            "vaultReference must be a non-empty string.",
          );

          return;
        }

        await expect(
          repository[
            operation as
              | "retrieve"
              | "delete"
              | "exists"
          ]("owner-1", " "),
        ).rejects.toThrow(
          "vaultReference must be a non-empty string.",
        );
      },
    );

    it(
      "rejects an empty secret",
      async () => {
        const repository =
          new InMemoryCredentialVaultRepository();

        await expect(
          repository.store(
            "owner-1",
            "vault://credential-1",
            " ",
          ),
        ).rejects.toThrow(
          "secret must be a non-empty string.",
        );
      },
    );
  },
);
