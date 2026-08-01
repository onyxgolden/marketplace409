import {
  afterEach,
  describe,
  expect,
  it,
} from "vitest";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createRequire } from "module";

const require = createRequire(import.meta.url);

const PatchEngine = require(
  "../patch-engine/PatchEngine.js",
);

describe("PatchEngine", () => {
  const temporaryDirectories = [];

  function createTemporaryDirectory(prefix) {
    const directory = mkdtempSync(
      join(tmpdir(), prefix),
    );

    temporaryDirectories.push(directory);

    return directory;
  }

  afterEach(() => {
    while (temporaryDirectories.length > 0) {
      rmSync(temporaryDirectories.pop(), {
        recursive: true,
        force: true,
      });
    }
  });

  it("loads a patch from JSON", () => {
    const repositoryRoot =
      createTemporaryDirectory("forge-patch-repo-");

    const patchFile = join(
      repositoryRoot,
      "patch.json",
    );

    writeFileSync(
      patchFile,
      JSON.stringify({
        operations: [],
      }),
      "utf8",
    );

    const engine = new PatchEngine(repositoryRoot);

    expect(engine.loadPatch(patchFile)).toEqual({
      operations: [],
    });
  });

  it("rejects patches without an operations array", () => {
    const repositoryRoot =
      createTemporaryDirectory("forge-patch-repo-");

    const engine = new PatchEngine(repositoryRoot);

    expect(() => engine.validate({})).toThrow(
      "Patch must contain an operations array.",
    );
  });

  it("rejects unsupported operation types", () => {
    const repositoryRoot =
      createTemporaryDirectory("forge-patch-repo-");

    const engine = new PatchEngine(repositoryRoot);

    expect(() =>
      engine.validate({
        operations: [
          {
            type: "delete_file",
            path: "example.txt",
          },
        ],
      }),
    ).toThrow("Unsupported operation: delete_file");
  });

  it("rejects direct traversal outside the repository", () => {
    const repositoryRoot =
      createTemporaryDirectory("forge-patch-repo-");

    const engine = new PatchEngine(repositoryRoot);

    expect(() =>
      engine.validate({
        operations: [
          {
            type: "replace_file",
            path: "../outside.txt",
            content: "blocked",
          },
        ],
      }),
    ).toThrow(
      "Refusing to write outside repository: ../outside.txt",
    );
  });

  it("writes and verifies repository files", () => {
    const repositoryRoot =
      createTemporaryDirectory("forge-patch-repo-");

    const engine = new PatchEngine(repositoryRoot);

    const result = engine.apply({
      operations: [
        {
          type: "replace_file",
          path: "nested/example.txt",
          content: "FORGE",
          verify: true,
        },
      ],
    });

    expect(
      readFileSync(
        join(repositoryRoot, "nested/example.txt"),
        "utf8",
      ),
    ).toBe("FORGE");

    expect(result).toEqual([
      {
        path: "nested/example.txt",
        status: "written",
        verified: true,
      },
    ]);
  });

  it("refuses writes through symlinks that escape the repository", () => {
    const repositoryRoot =
      createTemporaryDirectory("forge-patch-repo-");

    const outsideRoot =
      createTemporaryDirectory("forge-patch-outside-");

    symlinkSync(
      outsideRoot,
      join(repositoryRoot, "escaped"),
      "dir",
    );

    const engine = new PatchEngine(repositoryRoot);

    expect(() =>
      engine.apply({
        operations: [
          {
            type: "replace_file",
            path: "escaped/owned.txt",
            content: "must not escape",
            verify: true,
          },
        ],
      }),
    ).toThrow(
      "Refusing to write outside repository: escaped/owned.txt",
    );

    expect(
      existsSync(join(outsideRoot, "owned.txt")),
    ).toBe(false);
  });
});
