import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  afterEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";

import {
  runGovernancePipeline,
} from "../runGovernancePipeline.mjs";

const temporaryDirectories = new Set();

function createTemporaryDirectory() {
  const directory =
    fs.mkdtempSync(
      path.join(
        os.tmpdir(),
        "forge-governance-dispatch-",
      ),
    );

  temporaryDirectories.add(directory);

  return directory;
}

afterEach(() => {
  vi.restoreAllMocks();

  for (
    const directory
    of temporaryDirectories
  ) {
    fs.rmSync(
      directory,
      {
        recursive: true,
        force: true,
      },
    );
  }

  temporaryDirectories.clear();
});

describe(
  "runGovernancePipeline",
  () => {
    test(
      "locked mode exits without writing files",
      () => {
        const workingDirectory =
          createTemporaryDirectory();

        const filesBefore =
          fs.readdirSync(
            workingDirectory,
          );

        const logSpy =
          vi.spyOn(
            console,
            "log",
          ).mockImplementation(
            () => {},
          );

        runGovernancePipeline({
          mode: "locked",
        });

        expect(
          fs.readdirSync(
            workingDirectory,
          ),
        ).toEqual(filesBefore);

        expect(
          logSpy,
        ).toHaveBeenCalledWith(
          "FORGE governance mode: locked",
        );

        expect(
          logSpy,
        ).toHaveBeenCalledWith(
          "Governance pipeline is locked. No snapshots, state, or governance documents were written.",
        );
      },
    );

    test(
      "hybrid mode dispatches through the hybrid pipeline",
      () => {
        const logSpy =
          vi.spyOn(
            console,
            "log",
          ).mockImplementation(
            () => {},
          );

        expect(() =>
          runGovernancePipeline({
            mode: "hybrid",
          }),
        ).toThrow(
          'Governance mode "hybrid" is recognized but delegated synchronization has not been implemented yet.',
        );

        expect(
          logSpy,
        ).toHaveBeenCalledWith(
          "FORGE governance mode: hybrid",
        );

        expect(
          logSpy,
        ).toHaveBeenCalledWith(
          "Hybrid governance pipeline initialized. Delegated synchronization is not implemented yet.",
        );
      },
    );

    test(
      "authoritative mode remains explicitly unsupported",
      () => {
        const logSpy =
          vi.spyOn(
            console,
            "log",
          ).mockImplementation(
            () => {},
          );

        expect(() =>
          runGovernancePipeline({
            mode: "authoritative",
          }),
        ).toThrow(
          'Governance mode "authoritative" is recognized but not implemented by the pipeline yet.',
        );

        expect(
          logSpy,
        ).toHaveBeenCalledWith(
          "FORGE governance mode: authoritative",
        );
      },
    );

    test(
      "rejects unsupported modes",
      () => {
        vi.spyOn(
          console,
          "log",
        ).mockImplementation(
          () => {},
        );

        expect(() =>
          runGovernancePipeline({
            mode: "unsafe",
          }),
        ).toThrow(
          "Unsupported governance mode: unsafe",
        );
      },
    );
  },
);
