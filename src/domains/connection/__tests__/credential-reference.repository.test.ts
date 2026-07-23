import { describe, expect, it } from "vitest";
import { InMemoryCredentialReferenceRepository } from "../in-memory-credential-reference.repository";
import type { CredentialReference } from "../credential-reference.types";

const credentialReference = (
  overrides: Partial<CredentialReference> = {},
): CredentialReference => ({
  id: "credential_1",
  provider: "test_provider",
  externalCredentialId: "external_credential_1",
  vaultReference: "vault://credential_1",
  status: "active",
  createdAt: "2026-07-02T00:00:00.000Z",
  updatedAt: "2026-07-02T00:00:00.000Z",
  ...overrides,
});

describe("InMemoryCredentialReferenceRepository", () => {
  it("saves and retrieves a credential reference by id", async () => {
    const repository = new InMemoryCredentialReferenceRepository();
    const savedReference = credentialReference();

    await repository.save(savedReference);

    expect(await repository.getById(savedReference.id)).toEqual(savedReference);
  });

  it("returns null when a credential reference does not exist", async () => {
    const repository = new InMemoryCredentialReferenceRepository();

    expect(await repository.getById("missing")).toBeNull();
  });

  it("returns all credential references in insertion order", async () => {
    const repository = new InMemoryCredentialReferenceRepository();
    const first = credentialReference({ id: "credential_1" });
    const second = credentialReference({ id: "credential_2" });

    await repository.save(first);
    await repository.save(second);

    expect(await repository.getAll()).toEqual([first, second]);
  });

  it("returns a copy of all credential references", async () => {
    const repository = new InMemoryCredentialReferenceRepository();
    const savedReference = credentialReference();

    await repository.save(savedReference);

    const allReferences =
      (await repository.getAll()) as CredentialReference[];
    allReferences.push(credentialReference({ id: "credential_2" }));

    expect(await repository.getAll()).toEqual([savedReference]);
  });

  it("replaces a credential reference with the same id", async () => {
    const repository = new InMemoryCredentialReferenceRepository();
    const original = credentialReference({ status: "pending_validation" });
    const replacement = credentialReference({ status: "active" });

    await repository.save(original);
    await repository.save(replacement);

    expect(await repository.getById(original.id)).toEqual(replacement);
    expect(await repository.getAll()).toEqual([replacement]);
  });
});
