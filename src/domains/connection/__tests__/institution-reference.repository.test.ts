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
  it("saves and retrieves an institution reference by id", async () => {
    const repository = new InMemoryInstitutionReferenceRepository();
    const savedReference = institutionReference();

    await repository.save(savedReference);

    expect(await repository.getById(savedReference.id)).toEqual(savedReference);
  });

  it("returns null when an institution reference does not exist", async () => {
    const repository = new InMemoryInstitutionReferenceRepository();

    expect(await repository.getById("missing")).toBeNull();
  });

  it("returns all institution references in insertion order", async () => {
    const repository = new InMemoryInstitutionReferenceRepository();
    const first = institutionReference({ id: "institution_1" });
    const second = institutionReference({ id: "institution_2" });

    await repository.save(first);
    await repository.save(second);

    expect(await repository.getAll()).toEqual([first, second]);
  });

  it("returns a copy of all institution references", async () => {
    const repository = new InMemoryInstitutionReferenceRepository();
    const savedReference = institutionReference();

    await repository.save(savedReference);

    const allReferences =
      (await repository.getAll()) as InstitutionReference[];
    allReferences.push(institutionReference({ id: "institution_2" }));

    expect(await repository.getAll()).toEqual([savedReference]);
  });

  it("replaces an institution reference with the same id", async () => {
    const repository = new InMemoryInstitutionReferenceRepository();
    const original = institutionReference({ name: "Original Bank" });
    const replacement = institutionReference({ name: "Replacement Bank" });

    await repository.save(original);
    await repository.save(replacement);

    expect(await repository.getById(original.id)).toEqual(replacement);
    expect(await repository.getAll()).toEqual([replacement]);
  });
});
