from pathlib import Path

ROOT = Path.home() / "USMarketplace" / "marketplace409"
CONTRACTS_V1 = ROOT / "src" / "forge-os" / "contracts" / "v1"
CORE = CONTRACTS_V1 / "core"
TESTS = CORE / "__tests__"

FILES = {
    CORE / "ContractVersion.js": '''\
export function createContractVersion({
  major,
  minor,
  patch,
}) {
  return Object.freeze({
    major,
    minor,
    patch,
    identifier: `${major}.${minor}.${patch}`,
  });
}
''',

    CORE / "ContractMetadata.js": '''\
export function createContractMetadata({
  contractId,
  contractType,
  version,
  description,
}) {
  return Object.freeze({
    contractId,
    contractType,
    version,
    description,
  });
}
''',

    CORE / "BaseContract.js": '''\
export function createBaseContract({
  metadata,
}) {
  return Object.freeze({
    metadata,
  });
}
''',

    CORE / "index.js": '''\
export {
  createContractVersion,
} from "./ContractVersion.js";

export {
  createContractMetadata,
} from "./ContractMetadata.js";

export {
  createBaseContract,
} from "./BaseContract.js";
''',

    TESTS / "ContractVersion.test.js": '''\
import {
  describe,
  expect,
  it,
} from "vitest";

import {
  createContractVersion,
} from "../ContractVersion.js";

describe("ContractVersion", () => {
  it("creates immutable semantic-version metadata", () => {
    const version = createContractVersion({
      major: 1,
      minor: 0,
      patch: 0,
    });

    expect(version).toEqual({
      major: 1,
      minor: 0,
      patch: 0,
      identifier: "1.0.0",
    });

    expect(Object.isFrozen(version)).toBe(true);
  });
});
''',

    TESTS / "ContractMetadata.test.js": '''\
import {
  describe,
  expect,
  it,
} from "vitest";

import {
  createContractMetadata,
} from "../ContractMetadata.js";

import {
  createContractVersion,
} from "../ContractVersion.js";

describe("ContractMetadata", () => {
  it("creates immutable contract metadata", () => {
    const version = createContractVersion({
      major: 1,
      minor: 0,
      patch: 0,
    });

    const metadata = createContractMetadata({
      contractId: "forge.request.repository-inspection",
      contractType: "request",
      version,
      description:
        "Requests repository inspection.",
    });

    expect(metadata).toEqual({
      contractId:
        "forge.request.repository-inspection",
      contractType: "request",
      version,
      description:
        "Requests repository inspection.",
    });

    expect(Object.isFrozen(metadata)).toBe(true);
    expect(Object.isFrozen(metadata.version)).toBe(
      true,
    );
  });
});
''',

    TESTS / "BaseContract.test.js": '''\
import {
  describe,
  expect,
  it,
} from "vitest";

import {
  createBaseContract,
} from "../BaseContract.js";

import {
  createContractMetadata,
} from "../ContractMetadata.js";

import {
  createContractVersion,
} from "../ContractVersion.js";

describe("BaseContract", () => {
  it("creates an immutable contract foundation", () => {
    const version = createContractVersion({
      major: 1,
      minor: 0,
      patch: 0,
    });

    const metadata = createContractMetadata({
      contractId: "forge.contract.example",
      contractType: "example",
      version,
      description: "Example platform contract.",
    });

    const contract = createBaseContract({
      metadata,
    });

    expect(contract).toEqual({
      metadata,
    });

    expect(Object.isFrozen(contract)).toBe(true);
    expect(Object.isFrozen(contract.metadata)).toBe(
      true,
    );
  });
});
''',
}


def write_new_file(path: Path, content: str) -> None:
    if path.exists():
        raise RuntimeError(
            f"Refusing to overwrite existing file: {path}"
        )

    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    print(f"CREATED: {path.relative_to(ROOT)}")


def update_version_index() -> None:
    index_path = CONTRACTS_V1 / "index.js"

    if not index_path.exists():
        raise RuntimeError(
            f"Missing expected file: {index_path}"
        )

    current = index_path.read_text(encoding="utf-8")
    export_line = 'export * from "./core/index.js";'

    if export_line in current:
        print(
            "UNCHANGED: "
            "src/forge-os/contracts/v1/index.js"
        )
        return

    updated = current.rstrip() + "\n\n" + export_line + "\n"
    index_path.write_text(updated, encoding="utf-8")

    print(
        "UPDATED: "
        "src/forge-os/contracts/v1/index.js"
    )


def main() -> None:
    if not CONTRACTS_V1.exists():
        raise RuntimeError(
            "Phase 3A.1A contract package is missing."
        )

    for path, content in FILES.items():
        write_new_file(path, content)

    update_version_index()

    print()
    print(
        "PHASE 3A.1B CORE CONTRACT TYPES CREATED"
    )
    print("No runtime integrations were modified.")


if __name__ == "__main__":
    main()
