// FORGE Doc-to-Overview — verified filesystem primitive tests.
//
// These tests are deterministic: every swap is placed before the
// operation (the worst case for a check-then-use design — the swap has
// already happened when the operation runs) or applied to a held
// descriptor (which must be immune). No test depends on winning a
// timing window, because the design has no timing window: verification
// reads what was actually opened, and descriptors name inodes, not
// path spellings.

import {
  closeSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { constants as fsConstants } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createVerifiedTemp,
  ensureVerifiedDirChain,
  fdPath,
  openVerifiedDir,
  openVerifiedFd,
  openVerifiedFile,
  readdirVerifiedDir,
  renameWithinDir,
} from "./verifiedFs.js";

const { O_RDONLY } = fsConstants;

function tempRoot() {
  return mkdtempSync(path.join(tmpdir(), "doc-overview-verified-fs-"));
}

describe("verifiedFs", () => {
  it("refuses a pre-placed symlinked record file (ELOOP, never followed)", () => {
    const root = tempRoot();
    const target = path.join(root, "secret.txt");
    writeFileSync(target, "SECRET", "utf8");
    const link = path.join(root, "record.json");
    symlinkSync(target, link);
    expect(() => openVerifiedFile(link, O_RDONLY)).toThrow(/symlink/);
    expect(() => openVerifiedFd(link, O_RDONLY)).toThrow(/symlink/);
  });

  it("refuses a file opened through a swapped intermediate directory", () => {
    const root = tempRoot();
    const realDir = path.join(root, "real");
    const victimDir = path.join(root, "victim");
    mkdirSync(realDir);
    mkdirSync(victimDir);
    writeFileSync(path.join(victimDir, "record.json"), "VICTIM", "utf8");
    // Swap the intermediate directory for a symlink to the victim tree
    // BEFORE the open: the worst case for check-then-use, and the
    // descriptor's true location must betray it.
    renameSync(realDir, path.join(root, "real.bak"));
    symlinkSync(victimDir, realDir, "dir");
    expect(() => openVerifiedFile(path.join(realDir, "record.json"), O_RDONLY)).toThrow(/symlink/);
    expect(() => openVerifiedDir(realDir)).toThrow(/symlink/);
  });

  it("a held file descriptor is immune to a later path swap", () => {
    const root = tempRoot();
    const victimDir = path.join(root, "victim");
    mkdirSync(victimDir);
    const file = path.join(root, "record.json");
    writeFileSync(file, "ORIGINAL", "utf8");
    writeFileSync(path.join(victimDir, "record.json"), "VICTIM", "utf8");
    const fd = openVerifiedFile(file, O_RDONLY);
    try {
      // Swap the path out from under the open descriptor.
      renameSync(file, path.join(root, "record.json.bak"));
      symlinkSync(path.join(victimDir, "record.json"), file);
      expect(readFileSync(fd, "utf8")).toBe("ORIGINAL");
      expect(fdPath(fd)).toBe(path.join(root, "record.json.bak"));
      // A fresh open through the swapped path must refuse, not serve
      // the victim's bytes.
      expect(() => openVerifiedFile(file, O_RDONLY)).toThrow(/symlink/);
    } finally {
      closeSync(fd);
    }
  });

  it("a held directory descriptor lists the original directory after a path swap", () => {
    const root = tempRoot();
    const realDir = path.join(root, "real");
    const victimDir = path.join(root, "victim");
    mkdirSync(realDir);
    mkdirSync(victimDir);
    writeFileSync(path.join(realDir, "a.json"), "{}", "utf8");
    writeFileSync(path.join(victimDir, "b.json"), "{}", "utf8");
    const dirFd = openVerifiedDir(realDir);
    try {
      renameSync(realDir, path.join(root, "real.bak"));
      symlinkSync(victimDir, realDir, "dir");
      expect(readdirVerifiedDir(dirFd)).toEqual(["a.json"]);
      expect(fdPath(dirFd)).toBe(path.join(root, "real.bak"));
    } finally {
      closeSync(dirFd);
    }
  });

  it("rename through a held directory descriptor cannot land in another tree", () => {
    const root = tempRoot();
    const realDir = path.join(root, "real");
    const victimDir = path.join(root, "victim");
    mkdirSync(realDir);
    mkdirSync(victimDir);
    const dirFd = openVerifiedDir(realDir);
    try {
      // Swap the directory's path spelling, then rename through the
      // held descriptor: the rename must still land in the original
      // directory, never in the victim tree.
      renameSync(realDir, path.join(root, "real.bak"));
      symlinkSync(victimDir, realDir, "dir");
      const tmpFd = createVerifiedTemp(dirFd, path.join(root, "real.bak"), ".tmp-1");
      writeFileSync(tmpFd, "DATA", "utf8");
      closeSync(tmpFd);
      renameWithinDir(dirFd, ".tmp-1", "final.json");
      expect(readFileSync(path.join(root, "real.bak", "final.json"), "utf8")).toBe("DATA");
      expect(readdirVerifiedDir(dirFd).sort()).toEqual(["final.json"]);
    } finally {
      closeSync(dirFd);
    }
    // The victim tree is untouched: no temp, no renamed file.
    expect(() => statSync(path.join(victimDir, "final.json"))).toThrow(/ENOENT/);
    expect(() => statSync(path.join(victimDir, ".tmp-1"))).toThrow(/ENOENT/);
  });

  it("ensureVerifiedDirChain creates missing levels 0700 and refuses symlinked components", () => {
    const root = tempRoot();
    const victimDir = path.join(root, "victim");
    mkdirSync(victimDir);
    const { dirFd, dirPath } = ensureVerifiedDirChain(root, ["owner-1", "drafts"]);
    try {
      expect(dirPath).toBe(path.join(root, "owner-1", "drafts"));
      expect(statSync(path.join(root, "owner-1")).mode & 0o777).toBe(0o700);
      expect(statSync(path.join(root, "owner-1", "drafts")).mode & 0o777).toBe(0o700);
    } finally {
      closeSync(dirFd);
    }
    // Swap a mid-chain component for a symlink: the chain build must
    // refuse rather than create through it.
    renameSync(path.join(root, "owner-1"), path.join(root, "owner-1.bak"));
    symlinkSync(victimDir, path.join(root, "owner-1"), "dir");
    expect(() => ensureVerifiedDirChain(root, ["owner-1", "drafts"])).toThrow(/symlink/);
  });

  it("createVerifiedTemp is exclusive and mode 0600", () => {
    const root = tempRoot();
    const { dirFd, dirPath } = ensureVerifiedDirChain(root, ["owner-1", "drafts"]);
    try {
      const fd = createVerifiedTemp(dirFd, dirPath, ".tmp-1");
      closeSync(fd);
      expect(statSync(path.join(dirPath, ".tmp-1")).mode & 0o777).toBe(0o600);
      expect(() => createVerifiedTemp(dirFd, dirPath, ".tmp-1")).toThrow(/EEXIST/);
    } finally {
      closeSync(dirFd);
    }
  });
});
