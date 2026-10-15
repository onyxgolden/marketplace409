// Test-only: install the real AsyncLocalStorage before next/cache is
// imported. Next's work-unit storage is created at module load via
// createAsyncLocalStorage(), which falls back to a throwing fake when
// globalThis.AsyncLocalStorage is unset (as in the vitest node env).
import { AsyncLocalStorage } from "node:async_hooks";

if (typeof globalThis.AsyncLocalStorage === "undefined") {
  globalThis.AsyncLocalStorage = AsyncLocalStorage;
}
