const fs = require("fs");
const path = require("path");

class PatchEngine {
  constructor(repositoryRoot) {
    this.repositoryRoot = path.resolve(repositoryRoot);
  }

  loadPatch(patchFile) {
    const fullPath = path.resolve(patchFile);

    if (!fs.existsSync(fullPath)) {
      throw new Error(`Patch file not found: ${fullPath}`);
    }

    return JSON.parse(fs.readFileSync(fullPath, "utf8"));
  }

  validate(patch) {
    if (!patch.operations || !Array.isArray(patch.operations)) {
      throw new Error("Patch must contain an operations array.");
    }

    for (const operation of patch.operations) {
      if (operation.type !== "replace_file") {
        throw new Error(`Unsupported operation: ${operation.type}`);
      }

      const target = path.resolve(this.repositoryRoot, operation.path);

      if (
        target !== this.repositoryRoot &&
        !target.startsWith(this.repositoryRoot + path.sep)
      ) {
        throw new Error(`Refusing to write outside repository: ${operation.path}`);
      }

      const relativeTarget = path.relative(
        this.repositoryRoot,
        target
      );

      const segments = relativeTarget
        .split(path.sep)
        .filter(Boolean);

      let currentPath = this.repositoryRoot;

      for (const segment of segments) {
        currentPath = path.join(currentPath, segment);

        if (!fs.existsSync(currentPath)) {
          break;
        }

        if (fs.lstatSync(currentPath).isSymbolicLink()) {
          throw new Error(
            `Refusing to write outside repository: ${operation.path}`
          );
        }
      }
    }
  }

  apply(patch) {
    this.validate(patch);

    const results = [];

    for (const operation of patch.operations) {
      const target = path.resolve(this.repositoryRoot, operation.path);

      fs.mkdirSync(path.dirname(target), { recursive: true });

      fs.writeFileSync(target, operation.content, "utf8");

      let verified = true;

      if (operation.verify) {
        const readBack = fs.readFileSync(target, "utf8");
        verified = readBack === operation.content;

        if (!verified) {
          throw new Error(`Verification failed for ${operation.path}`);
        }
      }

      results.push({
        path: operation.path,
        status: "written",
        verified,
      });
    }

    return results;
  }
}

module.exports = PatchEngine;
