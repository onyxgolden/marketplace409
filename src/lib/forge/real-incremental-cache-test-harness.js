// Test-only harness: runs code against the REAL installed Next.js 16.4.1
// IncrementalCache + unstable_cache (FileSystemCache, in-memory only),
// inside a simulated API Route Handler request context, including the
// server's real end-of-request revalidation step.
//
// Why this exists (ChatGPT NEEDS CHANGES on PR #822, P1-1/P1-2): the
// previous test fake (incremental-cache-test-fake.js, now deleted)
// hardcoded the desired immediate-miss behavior, so post-write freshness
// tests could pass without ever exercising the framework. Every freshness
// assertion in the S2A suite runs through this harness against the real
// cache implementation, and the harness carries a control (the old fixed
// key + revalidateTag("max") design) that demonstrably serves stale data
// on the first post-write GET — so a regression test passing here proves
// the new design, not the harness.
//
// Import order (load-bearing): this module's FIRST import is the setup
// module, which installs globalThis.AsyncLocalStorage BEFORE any Next
// server module is evaluated (Next captures it at import time). Test files
// must import this harness BEFORE importing any route or listReadCache
// module. Vitest evaluates static imports in order, so a top-of-file
// `import "@/lib/forge/real-incremental-cache-test-harness"` as the first
// import is sufficient.
//
// The simulated request mirrors what Next builds for an API Route Handler
// (next/dist/server/async-storage/request-store.js
// createRequestStoreForAPI): type 'request', phase 'action' (API routes
// start in action phase — this is what lets revalidateTag run without the
// during-render error, and what makes updateTag throw for a '/route'
// page). runInRealRequest also runs the server's real end-of-request step,
// executeRevalidates(workStore) (what
// route-modules/app-route/module.js resolvePendingRevalidations does), so
// a revalidateTag("max") issued inside a request marks the tag stale in
// the shared tags manifest exactly as production does, and pending cache
// writes are awaited before the call returns — the next runInRealRequest
// therefore sees exactly what the next production request sees.
//
// Cache isolation between tests: resetRealIncrementalCache() clears the
// process-global tags manifest and gives the fresh IncrementalCache a
// unique fetchCacheKeyPrefix (hashed into every cache key), because the
// FileSystemCache memory LRU is a process-global singleton with no clear()
// and entries written by earlier tests must stay unreachable.
import "./real-incremental-cache-test-setup.js";

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { IncrementalCache } from "next/dist/server/lib/incremental-cache";
import { workAsyncStorage } from "next/dist/server/app-render/work-async-storage.external";
import { workUnitAsyncStorage } from "next/dist/server/app-render/work-unit-async-storage.external";
import { executeRevalidates } from "next/dist/server/revalidation-utils";
import { tagsManifest } from "next/dist/server/lib/incremental-cache/tags-manifest.external";

const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "forge-real-cache-"));

let resetCount = 0;
let currentCache = null;

function createCacheInstance(fetchCacheKeyPrefix) {
  const cache = new IncrementalCache({
    fs: fs.promises,
    dev: false,
    flushToDisk: false,
    minimalMode: false,
    serverDistDir: cacheDir,
    requestHeaders: {},
    maxMemoryCacheSize: 50 * 1024 * 1024,
    previewProps: { previewModeId: "forge-test-preview-mode" },
    prerenderManifest: { routes: {}, dynamicRoutes: {} },
    fetchCacheKeyPrefix,
  });
  globalThis.__incrementalCache = cache;
  return cache;
}

currentCache = createCacheInstance("forge-test-0");

// Drop every entry and tag mark written by earlier tests, so the next test
// starts from a cold real cache. Call from beforeEach.
export function resetRealIncrementalCache() {
  tagsManifest.clear();
  resetCount += 1;
  currentCache = createCacheInstance(`forge-test-${resetCount}`);
  return currentCache;
}

// Run `fn` the way a production API Route Handler request runs: inside
// Next's work + work-unit async storage, then through the real
// end-of-request revalidation step. Returns `{ result, workStore }` —
// workStore is exposed so a test can inspect pendingRevalidatedTags when
// it needs to (e.g. asserting a mutation request recorded a revalidation).
export async function runInRealRequest(
  fn,
  { pathname = "/api/forge/scheduling", search = "" } = {},
) {
  const incrementalCache = currentCache;
  const workStore = {
    route: pathname,
    page: `${pathname}/route`,
    incrementalCache,
    nextFetchId: 1,
    pendingRevalidates: {},
    pendingRevalidatedTags: [],
    isDraftMode: false,
    isOnDemandRevalidate: false,
    fetchCache: undefined,
    // The built-in "max" cacheLife profile (never expires). Only `expire`
    // is consumed on the revalidateTag path — FileSystemCache.revalidateTag
    // marks the tag stale immediately and sets expired = now + expire —
    // so Infinity reproduces the documented "max" (stale-while-revalidate)
    // semantics exactly.
    cacheLifeProfiles: {
      max: { stale: Infinity, revalidate: Infinity, expire: Infinity },
    },
  };
  const workUnitStore = {
    type: "request",
    phase: "action",
    url: { pathname, search },
    implicitTags: undefined,
    resumeDataCache: null,
  };
  const result = await workAsyncStorage.run(workStore, () =>
    workUnitAsyncStorage.run(workUnitStore, fn),
  );
  await executeRevalidates(workStore);
  return { result, workStore, workUnitStore };
}
