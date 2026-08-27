// Naming-convention pairing: Foo.test.jsx -> Foo.jsx, fooBar.test.mjs -> fooBar.mjs, in the same
// directory. Returns null when no convention-matching sibling exists in the given path set (a test
// with no obvious associated source file, e.g. an integration test) rather than guessing.
export function deriveAssociatedSourcePaths(testPath, allTrackedPaths) {
  const match = testPath.match(/^(.*\/)?([^/]+)\.test\.(js|jsx|ts|tsx|mjs)$/);
  if (!match) return [];
  const [, dir = "", baseName] = match;
  const candidates = ["js", "jsx", "ts", "tsx", "mjs"].map((ext) => `${dir}${baseName}.${ext}`);
  return candidates.filter((candidate) => allTrackedPaths.has(candidate));
}
