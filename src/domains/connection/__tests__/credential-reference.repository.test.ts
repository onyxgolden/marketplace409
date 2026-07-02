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
  it("saves and retrieves a credential reference by id", () => {
    const repository = new InMemoryCredentialReferenceRepository();
    const savedReference = credentialReference();

    repository.save(savedReference);

    expect(repository.getById(savedReference.id)).toEqual(savedReference);
  });

  it("returns null when a credential reference does not exist", () => {
    const repository = new InMemoryCredentialReferenceRepository();

    expect(repository.getById("missing")).toBeNull();
  });

  it("returns all credential references in insertion order", () => {
    const repository = new InMemoryCredentialReferenceRepository();
    const first = credentialReference({ id: "credential_1" });
    const second = credentialReference({ id: "credential_2" });

    repository.save(first);
    repository.save(second);

    expect(repository.getAll()).toEqual([first, second]);
  });

  it("returns a copy of all credential references", () => {
    const repository = new InMemoryCredentialReferenceRepository();
    const savedReference = credentialReference();

    repository.save(savedReference);

    const allReferences = repository.getAll();
    allReferences.push(credentialReference({ id: "credential_2" }));

    expect(repository.getAll()).toEqual([savedReference]);
  });

  it("replaces a credential reference with the same id", () => {
    const repository = new InMemoryCredentialReferenceRepository();
    const original = credentialReference({ status: "pending_validation" });
    const replacement = credentialReference({ status: "active" });

    repository.save(original);
    repository.save(replacement);

    expect(repository.getById(original.id)).toEqual(replacement);
    expect(repository.getAll()).toEqual([replacement]);
  });
});
