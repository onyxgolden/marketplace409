// Test-only. Must be imported BEFORE any module that transitively imports
// next/cache (or any next/dist/server/app-render/* store): Next's
// async-local-storage module captures `globalThis.AsyncLocalStorage` at
// import time and falls back to a FakeAsyncLocalStorage that always returns
// undefined when it is absent, so the shim has to exist first. This module
// imports nothing from Next, so it is safe to load first.
import { AsyncLocalStorage } from "node:async_hooks";

if (typeof globalThis.AsyncLocalStorage === "undefined") {
  globalThis.AsyncLocalStorage = AsyncLocalStorage;
}
