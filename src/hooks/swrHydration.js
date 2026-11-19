// Client hydration-readiness external store for the shared SWR hook.
//
// Problem it solves: a browser-only, disk-persisted SWR entry is read
// synchronously during render, but server rendering has no localStorage and
// emits a loading state. When the browser hydrates with a signed-in identity
// already set, the hook revives the disk entry and emits full content -- a
// different first-client tree from the server HTML, i.e. React #418.
//
// This store is the single app-wide "the root has committed" signal. It starts
// false and is set once, idempotently, by SWRIdentityBridge's effect after the
// root commits. The hook subscribes with useSyncExternalStore: SSR and the
// first hydration render both see the server snapshot (false) and therefore
// render the loading-equivalent tree; after the bridge marks readiness, the
// normal memory/disk cache becomes visible. Client-side navigation after the
// root has hydrated sees readiness already true, so warm cache-on-remount
// behavior is preserved -- there is no per-hook mount gate.
//
// The store holds no window/localStorage access and is never set by server
// rendering. It is not an authorization boundary.

let hydrated = false;
const listeners = new Set();

/** Subscribe to hydration-readiness changes. Returns an unsubscribe function. */
export function subscribeSWRHydration(listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Client snapshot for useSyncExternalStore: true once the root has committed. */
export function getSWRHydrationSnapshot() {
  return hydrated;
}

/** Server snapshot for useSyncExternalStore: always false, so SSR and the
 *  first hydration render both see hydration-not-ready. */
export function getSWRHydrationServerSnapshot() {
  return false;
}

/** Mark hydration complete. Idempotent: Strict Mode's double-effect
 *  invocation and repeated calls are harmless; subscribers are notified once. */
export function markSWRHydrated() {
  if (hydrated) return;
  hydrated = true;
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch {
      // A misbehaving subscriber must not break the boundary for everyone else.
    }
  }
}

/** Test/utility escape hatch: restore the initial unmarked state. */
export function resetSWRHydration() {
  hydrated = false;
  listeners.clear();
}
