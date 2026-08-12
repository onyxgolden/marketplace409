import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  afterEach,
  describe,
  expect,
  test,
} from "vitest";

import {
  writeSnapshotWithCollisionSafety,
} from "../writeSnapshotWithCollisionSafety.mjs";

const temporaryDirectories = new Set();

function createTemporaryDirectory() {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "forge-snapshot-collision-"),
  );

  temporaryDirectories.add(directory);

  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories) {
    fs.rmSync(directory, { recursive: true, force: true });
  }

  temporaryDirectories.clear();
});

describe("writeSnapshotWithCollisionSafety", () => {
  test("allocates the base session ID when no collision exists", () => {
    const snapshotDirectory = createTemporaryDirectory();

    const result = writeSnapshotWithCollisionSafety({
      snapshotDirectory,
      baseSessionId: "forge-session-20260811-153000123",
      buildContent: (id) => `{"sessionId":"${id}"}`,
    });

    expect(result.sessionId).toBe(
      "forge-session-20260811-153000123",
    );
    expect(result.snapshotPath).toBe(
      path.join(
        snapshotDirectory,
        "forge-session-20260811-153000123.json",
      ),
    );
  });

  test("repeated creation at a fixed clock value (identical baseSessionId) produces unique, sortable paths and preserves each snapshot's own content", () => {
    const snapshotDirectory = createTemporaryDirectory();
    const fixedClockSessionId = "forge-session-20260811-153000123";

    const results = [];

    for (let attempt = 0; attempt < 5; attempt += 1) {
      results.push(
        writeSnapshotWithCollisionSafety({
          snapshotDirectory,
          baseSessionId: fixedClockSessionId,
          buildContent: (id) =>
            JSON.stringify({
              sessionId: id,
              attempt,
            }),
        }),
      );
    }

    const sessionIds = results.map((result) => result.sessionId);

    expect(sessionIds).toEqual([
      "forge-session-20260811-153000123",
      "forge-session-20260811-153000123-01",
      "forge-session-20260811-153000123-02",
      "forge-session-20260811-153000123-03",
      "forge-session-20260811-153000123-04",
    ]);

    // Unique paths.
    expect(new Set(sessionIds).size).toBe(5);

    // Sortable: the natural creation order matches a plain string sort.
    expect([...sessionIds].sort()).toEqual(sessionIds);

    // Every file exists, was never overwritten, and holds its own
    // attempt's content (not clobbered by a later collision).
    results.forEach((result, attempt) => {
      const content = JSON.parse(
        fs.readFileSync(result.snapshotPath, "utf8"),
      );

      expect(content).toEqual({
        sessionId: result.sessionId,
        attempt,
      });
    });

    expect(
      fs.readdirSync(snapshotDirectory).sort(),
    ).toEqual(
      sessionIds.map((id) => `${id}.json`).sort(),
    );
  });

  test("never overwrites an existing snapshot, even under a forced collision", () => {
    const snapshotDirectory = createTemporaryDirectory();
    const baseSessionId = "forge-session-20260811-153000999";

    const first = writeSnapshotWithCollisionSafety({
      snapshotDirectory,
      baseSessionId,
      buildContent: () => "first-content",
    });

    const second = writeSnapshotWithCollisionSafety({
      snapshotDirectory,
      baseSessionId,
      buildContent: () => "second-content",
    });

    expect(first.snapshotPath).not.toBe(second.snapshotPath);

    expect(
      fs.readFileSync(first.snapshotPath, "utf8"),
    ).toBe("first-content");

    expect(
      fs.readFileSync(second.snapshotPath, "utf8"),
    ).toBe("second-content");
  });

  test("creates the snapshot directory when it does not yet exist", () => {
    const parentDirectory = createTemporaryDirectory();
    const snapshotDirectory = path.join(
      parentDirectory,
      "nested",
      "snapshots",
    );

    expect(fs.existsSync(snapshotDirectory)).toBe(false);

    const result = writeSnapshotWithCollisionSafety({
      snapshotDirectory,
      baseSessionId: "forge-session-20260811-153000123",
      buildContent: (id) => id,
    });

    expect(fs.existsSync(result.snapshotPath)).toBe(true);
  });
});
