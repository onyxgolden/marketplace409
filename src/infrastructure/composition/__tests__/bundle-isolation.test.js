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
//
// Derived from the filesystem (not hardcoded) so a future /api/plaid/*
// route cannot silently escape this guard: any route.ts/route.js added
// under src/app/api/plaid/ is automatically covered.
function discoverRouteEntries(dir) {
  const entries = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      entries.push(...discoverRouteEntries(full));
    } else if (/^route\.(js|ts|jsx|tsx)$/.test(entry.name)) {
      entries.push(full);
    }
  }
  return entries;
}

const PLAID_ROUTE_ENTRIES = discoverRouteEntries(
  path.join(srcRoot, "app/api/plaid"),
);

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
    // Non-vacuous: fails loudly if the filesystem derivation above ever
    // stops covering a real route (e.g. a renamed directory), instead of
    // silently passing on an empty entry list.
    expect(PLAID_ROUTE_ENTRIES.length).toBeGreaterThan(0);
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

// Slice 3: exceljs was the last statically-imported heavy SDK (the two
// scheduling excel routes). @google-cloud/vision and unpdf were already
// lazy -- dynamic import() inside GoogleCloudVisionOCRAdapter and the
// extract*Text wrappers -- so these guards lock that property in: a future
// static import must fail loudly instead of silently re-bloating every
// route that touches OCR or PDF text extraction.
const EXCEL_ROUTE_ENTRIES = [
  path.join(
    srcRoot,
    "app/api/forge/scheduling/[projectId]/export/excel/route.js",
  ),
  path.join(
    srcRoot,
    "app/api/forge/scheduling/[projectId]/import/excel/route.js",
  ),
];

// Statically imports both lazy wrappers (vision adapter + native pdf text)
// but must never statically reach the heavy packages themselves.
const OCR_WRAPPER_USER_ENTRY = path.join(
  srcRoot,
  "app/api/rental/documents/route.js",
);

const isExceljs = (spec) =>
  spec === "exceljs" || spec.startsWith("exceljs/");
const isVision = (spec) =>
  spec === "@google-cloud/vision" ||
  spec.startsWith("@google-cloud/vision/");
const isUnpdf = (spec) => spec === "unpdf" || spec.startsWith("unpdf/");

function packageReachability(entryFiles, matchSpec, options) {
  const { bareSpecifiers, visited } = walkModuleGraph(entryFiles, options);
  return {
    hits: [...bareSpecifiers].filter(matchSpec),
    visitedCount: visited.size,
  };
}

describe("serverless bundle isolation (slice 3: exceljs/vision/unpdf)", () => {
  it("the excel routes' static graphs never reach the exceljs package", () => {
    expect(
      packageReachability(EXCEL_ROUTE_ENTRIES, isExceljs, {
        includeDynamic: false,
      }),
    ).toEqual({
      hits: [],
      visitedCount: expect.any(Number),
    });
  });

  it("the excel routes still reach exceljs through a dynamic import (non-vacuous control)", () => {
    // The lazy edge must keep existing: each route loads exceljs via
    // import() only when the handler actually runs. Full graph
    // (static + dynamic) reaches exceljs...
    const full = packageReachability(EXCEL_ROUTE_ENTRIES, isExceljs);
    expect(full.hits).toContain("exceljs");
    // ...while the static graph does not (see the guard above), and each
    // route source carries exactly one dynamic import of exceljs and no
    // static one.
    for (const entry of EXCEL_ROUTE_ENTRIES) {
      const source = fs.readFileSync(entry, "utf8");
      expect(source.match(/import\(\s*["']exceljs["']\s*\)/g) ?? []).toHaveLength(
        1,
      );
      expect(source).not.toMatch(
        /^\s*import\s+[^'"]*from\s+["']exceljs["']/m,
      );
    }
  });

  it("no route's static graph reaches the vision or unpdf packages", () => {
    // Both packages were already lazy before slice 3; this locks it in
    // across all 142 routes so a future static import can't silently
    // re-bloat OCR/PDF routes.
    const routes = discoverRouteEntries(path.join(srcRoot, "app/api"));
    expect(routes.length).toBeGreaterThan(0);
    const visionHitters = [];
    const unpdfHitters = [];
    for (const route of routes) {
      const { bareSpecifiers } = walkModuleGraph([route], {
        includeDynamic: false,
      });
      const specs = [...bareSpecifiers];
      if (specs.some(isVision)) {
        visionHitters.push(path.relative(srcRoot, route));
      }
      if (specs.some(isUnpdf)) {
        unpdfHitters.push(path.relative(srcRoot, route));
      }
    }
    expect({ visionHitters, unpdfHitters }).toEqual({
      visionHitters: [],
      unpdfHitters: [],
    });
  });

  it("the ocr wrapper user still reaches vision and unpdf dynamically (non-vacuous control)", () => {
    // /api/rental/documents statically imports both lazy wrappers; the
    // heavy packages must stay behind their dynamic import() edges.
    const fullVision = packageReachability([OCR_WRAPPER_USER_ENTRY], isVision);
    const fullUnpdf = packageReachability([OCR_WRAPPER_USER_ENTRY], isUnpdf);
    expect(fullVision.hits).toContain("@google-cloud/vision");
    expect(fullUnpdf.hits).toContain("unpdf");
    expect(
      packageReachability([OCR_WRAPPER_USER_ENTRY], isVision, {
        includeDynamic: false,
      }).hits,
    ).toEqual([]);
    expect(
      packageReachability([OCR_WRAPPER_USER_ENTRY], isUnpdf, {
        includeDynamic: false,
      }).hits,
    ).toEqual([]);
  });
});
