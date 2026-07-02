import { describe, expect, it } from "vitest";
import { InMemoryInstitutionReferenceRepository } from "../in-memory-institution-reference.repository";
import type { InstitutionReference } from "../institution-reference.types";

const institutionReference = (
  overrides: Partial<InstitutionReference> = {},
): InstitutionReference => ({
  id: "institution_1",
  connectionId: "connection_1",
  name: "Sandbox Bank",
  type: "bank",
  provider: "test_provider",
  externalInstitutionId: "external_institution_1",
  createdAt: "2026-07-02T00:00:00.000Z",
  updatedAt: "2026-07-02T00:00:00.000Z",
  ...overrides,
});

describe("InMemoryInstitutionReferenceRepository", () => {
  it("saves and retrieves an institution reference by id", () => {
    const repository = new InMemoryInstitutionReferenceRepository();
    const savedReference = institutionReference();

    repository.save(savedReference);

    expect(repository.getById(savedReference.id)).toEqual(savedReference);
  });

  it("returns null when an institution reference does not exist", () => {
    const repository = new InMemoryInstitutionReferenceRepository();

    expect(repository.getById("missing")).toBeNull();
  });

  it("returns all institution references in insertion order", () => {
    const repository = new InMemoryInstitutionReferenceRepository();
    const first = institutionReference({ id: "institution_1" });
    const second = institutionReference({ id: "institution_2" });

    repository.save(first);
    repository.save(second);

    expect(repository.getAll()).toEqual([first, second]);
  });

  it("returns a copy of all institution references", () => {
    const repository = new InMemoryInstitutionReferenceRepository();
    const savedReference = institutionReference();

    repository.save(savedReference);

    const allReferences = repository.getAll();
    allReferences.push(institutionReference({ id: "institution_2" }));

    expect(repository.getAll()).toEqual([savedReference]);
  });

  it("replaces an institution reference with the same id", () => {
    const repository = new InMemoryInstitutionReferenceRepository();
    const original = institutionReference({ name: "Original Bank" });
    const replacement = institutionReference({ name: "Replacement Bank" });

    repository.save(original);
    repository.save(replacement);

    expect(repository.getById(original.id)).toEqual(replacement);
    expect(repository.getAll()).toEqual([replacement]);
  });
});
