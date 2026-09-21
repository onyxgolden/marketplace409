import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
// src/infrastructure/composition/__tests__ -> repo root
const repoRoot = path.resolve(here, "..", "..", "..", "..");
const srcRoot = path.join(repoRoot, "src");

const EXTENSIONS = [".js", ".ts", ".jsx", ".tsx"];

function resolveSpecifier(specifier, fromFile) {
  if (specifier.startsWith("@/")) {
    return path.join(srcRoot, specifier.slice(2));
  }
  if (specifier.startsWith(".")) {
    return path.resolve(path.dirname(fromFile), specifier);
  }
  return null; // bare specifier: node_modules, not traversed
}

function resolveFile(base) {
  if (fs.existsSync(base) && fs.statSync(base).isFile()) {
    return base;
  }
  for (const ext of EXTENSIONS) {
    if (fs.existsSync(base + ext)) {
      return base + ext;
    }
  }
  for (const ext of EXTENSIONS) {
    const indexFile = path.join(base, `index${ext}`);
    if (fs.existsSync(indexFile)) {
      return indexFile;
    }
  }
  return null;
}

const STATIC_IMPORT =
  /^\s*import\s+(type\s+)?(?:[^'"]*?\sfrom\s+)?['"]([^'"]+)['"]/gm;
const STATIC_EXPORT_FROM =
  /^\s*export\s+(type\s+)?(?:[^'"]*?\sfrom\s+)['"]([^'"]+)['"]/gm;
const DYNAMIC_IMPORT = /import\(\s*['"]([^'"]+)['"]\s*\)/g;
const REQUIRE = /require\(\s*['"]([^'"]+)['"]\s*\)/g;

function collectSpecifiers(source, isTypeScript) {
  const specifiers = [];
  for (const re of [STATIC_IMPORT, STATIC_EXPORT_FROM]) {
    re.lastIndex = 0;
    let match;
    while ((match = re.exec(source)) !== null) {
      // import type / export type are erased at compile time -- they can
      // never pull a runtime dependency into a serverless function bundle.
      if (isTypeScript && match[1]) {
        continue;
      }
      specifiers.push(match[2]);
    }
  }
  for (const re of [DYNAMIC_IMPORT, REQUIRE]) {
    re.lastIndex = 0;
    let match;
    while ((match = re.exec(source)) !== null) {
      specifiers.push(match[1]);
    }
  }
  return specifiers;
}

/**
 * Walks the static + dynamic import graph starting at entryFiles,
 * following only relative and @/ specifiers. Returns the visited files
 * and every bare (node_modules) specifier encountered.
 */
function walkModuleGraph(entryFiles) {
  const visited = new Set();
  const bareSpecifiers = new Set();
  const queue = entryFiles.map((f) => resolveFile(f)).filter(Boolean);

  while (queue.length > 0) {
    const file = queue.pop();
    if (visited.has(file)) {
      continue;
    }
    visited.add(file);

    const source = fs.readFileSync(file, "utf8");
    const isTypeScript = file.endsWith(".ts") || file.endsWith(".tsx");

    for (const specifier of collectSpecifiers(source, isTypeScript)) {
      if (!specifier.startsWith(".") && !specifier.startsWith("@/")) {
        bareSpecifiers.add(specifier);
        continue;
      }
      const resolved = resolveFile(resolveSpecifier(specifier, file));
      if (resolved && !visited.has(resolved)) {
        queue.push(resolved);
      }
    }
  }

  return { visited, bareSpecifiers };
}

// The 28 financial routes all build their backend through
// createAuthenticatedFinancialApplication, which now imports the financial
// suite directly (never the composition barrel). If the Plaid graph ever
// becomes reachable from here again, those functions silently re-bloat by
// ~17MB -- this guard fails loudly instead.
const FINANCIAL_ENTRIES = [
  path.join(srcRoot, "lib/supabase/createAuthenticatedFinancialApplication.js"),
  path.join(
    srcRoot,
    "infrastructure/composition/createFinancialApplicationSuite.js",
  ),
];

describe("serverless bundle isolation", () => {
  it("the financial application graph never reaches the plaid package", () => {
    const { bareSpecifiers, visited } = walkModuleGraph(FINANCIAL_ENTRIES);

    const plaidHits = [...bareSpecifiers].filter(
      (spec) => spec === "plaid" || spec.startsWith("plaid/"),
    );
    const plaidFiles = [...visited].filter((file) =>
      /(^|\/)plaid-adapter\//.test(
        path.relative(srcRoot, file).replace(/\\/g, "/"),
      ),
    );

    expect({
      plaidBareSpecifiers: plaidHits,
      plaidAdapterFiles: plaidFiles,
      visitedCount: visited.size,
    }).toEqual({
      plaidBareSpecifiers: [],
      plaidAdapterFiles: [],
      visitedCount: expect.any(Number),
    });
  });

  it("the financial application graph never goes through the composition barrel or the connection platform suite", () => {
    const { visited } = walkModuleGraph(FINANCIAL_ENTRIES);
    const relative = [...visited].map((file) =>
      path.relative(srcRoot, file).replace(/\\/g, "/"),
    );

    expect(
      relative.filter((f) => f === "infrastructure/composition/index.js"),
    ).toEqual([]);
    expect(
      relative.filter(
        (f) => f === "infrastructure/composition/createConnectionPlatformSuite.js",
      ),
    ).toEqual([]);
  });
});

// The forge routes build their backend through
// createAuthenticatedForgeApplication -> createForgeApplicationSuite ->
// createConnectionPlatformSuite, which constructs the Stripe Financial
// Connections adapter unconditionally. The adapter's Stripe client is now
// injected (never imported, statically or dynamically), so these functions
// must never reach the stripe package again -- this guard fails loudly
// instead of silently re-bloating ~28 forge functions by ~9.9MB each.
const FORGE_ENTRIES = [
  path.join(srcRoot, "lib/supabase/createAuthenticatedForgeApplication.js"),
  path.join(
    srcRoot,
    "infrastructure/composition/createForgeApplicationSuite.js",
  ),
];

// The one static edge to the stripe SDK: backs the /api/connection/*,
// /api/plaid/*, and /api/stripe/financial-connections/* routes, the only
// entry points that perform real Stripe Financial Connections operations.
const CONNECTION_ENTRY = path.join(
  srcRoot,
  "lib/supabase/createAuthenticatedConnectionApplication.js",
);

function stripeReachability(entryFiles) {
  const { bareSpecifiers, visited } = walkModuleGraph(entryFiles);
  const stripeHits = [...bareSpecifiers].filter(
    (spec) => spec === "stripe" || spec.startsWith("stripe/"),
  );
  const billingProviderFiles = [...visited].filter((file) =>
    /(^|\/)infrastructure\/billing\/StripeBillingProvider\.js$/.test(
      path.relative(srcRoot, file).replace(/\\/g, "/"),
    ),
  );
  return {
    stripeHits,
    billingProviderFiles,
    visitedCount: visited.size,
  };
}

describe("serverless bundle isolation (stripe)", () => {
  it("the financial application graph never reaches the stripe package", () => {
    expect(stripeReachability(FINANCIAL_ENTRIES)).toEqual({
      stripeHits: [],
      billingProviderFiles: [],
      visitedCount: expect.any(Number),
    });
  });

  it("the forge application graph never reaches the stripe package", () => {
    expect(stripeReachability(FORGE_ENTRIES)).toEqual({
      stripeHits: [],
      billingProviderFiles: [],
      visitedCount: expect.any(Number),
    });
  });

  it("the connection entry point still reaches the stripe package (non-vacuous control)", () => {
    const { stripeHits, billingProviderFiles } = stripeReachability([
      CONNECTION_ENTRY,
    ]);
    expect(stripeHits).toContain("stripe");
    expect(billingProviderFiles.length).toBeGreaterThan(0);
  });
});
