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

function collectSpecifiers(source, isTypeScript, { includeDynamic }) {
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
  if (includeDynamic) {
    for (const re of [DYNAMIC_IMPORT, REQUIRE]) {
      re.lastIndex = 0;
      let match;
      while ((match = re.exec(source)) !== null) {
        specifiers.push(match[1]);
      }
    }
  }
  return specifiers;
}

/**
 * Walks the import graph starting at entryFiles, following only relative
 * and @/ specifiers. Returns the visited files and every bare
 * (node_modules) specifier encountered.
 *
 * includeDynamic=false follows static imports/exports only -- this is what
 * lands in a serverless function's initial bundle. includeDynamic=true
 * also follows dynamic import() edges, which Next.js code-splits into
 * lazily-loaded chunks (runtime-loaded, never in the initial bundle).
 */
function walkModuleGraph(entryFiles, { includeDynamic = true } = {}) {
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

    for (const specifier of collectSpecifiers(source, isTypeScript, {
      includeDynamic,
    })) {
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

function stripeReachability(entryFiles, options) {
  const { bareSpecifiers, visited } = walkModuleGraph(entryFiles, options);
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

// The /api/plaid/* routes are backed by the same connection helper but never
// perform Stripe operations -- the stripe package must not appear in their
// static bundles. Checked against the STATIC graph: a dynamic import() edge
// would only ever execute inside a Stripe adapter method, never on these
// routes, but the static bundle is what Vercel ships per function.
const PLAID_ROUTE_ENTRIES = [
  path.join(srcRoot, "app/api/plaid/exchange-token/route.ts"),
  path.join(srcRoot, "app/api/plaid/link-token/route.ts"),
];

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

  it("the connection helper's static graph never reaches the stripe package", () => {
    // Regression guard for the NO-GO blocker: the helper backs /api/plaid/*
    // routes too, so even a single static `import ... StripeBillingProvider`
    // here would re-bundle the ~9.9MB stripe package into Plaid-only
    // functions. The Stripe client must stay behind the dynamic import()
    // inside stripeClientFactory. Fails loudly if the static edge returns.
    expect(
      stripeReachability([CONNECTION_ENTRY], { includeDynamic: false }),
    ).toEqual({
      stripeHits: [],
      billingProviderFiles: [],
      visitedCount: expect.any(Number),
    });
  });

  it("the plaid-only routes' static graph never reaches the stripe package", () => {
    expect(
      stripeReachability(PLAID_ROUTE_ENTRIES, { includeDynamic: false }),
    ).toEqual({
      stripeHits: [],
      billingProviderFiles: [],
      visitedCount: expect.any(Number),
    });
  });

  it("the connection entry still reaches the stripe package through a dynamic import (non-vacuous control)", () => {
    // The lazy edge must keep existing: the factory loads
    // StripeBillingProvider via import() only when a Stripe adapter method
    // actually runs. Full graph (static + dynamic) reaches stripe...
    const full = stripeReachability([CONNECTION_ENTRY]);
    expect(full.stripeHits).toContain("stripe");
    expect(full.billingProviderFiles.length).toBeGreaterThan(0);
    // ...while the static graph does not (see the guard above), and the
    // helper source carries exactly one dynamic import of the provider
    // module and no static one.
    const helperSource = fs.readFileSync(CONNECTION_ENTRY, "utf8");
    expect(
      helperSource.match(
        /import\(\s*["']@\/infrastructure\/billing\/StripeBillingProvider["']\s*\)/g,
      ) ?? [],
    ).toHaveLength(1);
    expect(helperSource).not.toMatch(
      /^\s*import\s+[^'"]*from\s+["']@\/infrastructure\/billing\/StripeBillingProvider["']/m,
    );
  });
});
