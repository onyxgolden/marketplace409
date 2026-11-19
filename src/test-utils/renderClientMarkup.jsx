import { act } from "react";
import { createRoot } from "react-dom/client";
import { markSWRHydrated } from "@/hooks/swrHydration";

// act() needs this flag in a jsdom test environment.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Client-render a React element and return its HTML, as a synchronous
 * drop-in replacement for renderToStaticMarkup in tests that assert on the
 * component's rendered output (not on SSR behavior).
 *
 * Why this exists: renderToStaticMarkup always sees the pre-hydration
 * (loading) state since the shared SWR hydration boundary
 * (src/hooks/swrHydration.js) -- the server snapshot is always false, so a
 * server render can never show persisted SWR data. Component-behavior tests
 * that seed the SWR cache and expect data must therefore render on the
 * client instead. This helper marks hydration (the state the running app is
 * in after the root SWRIdentityBridge commits), mounts with createRoot,
 * flushes with act, and returns container.innerHTML. It unmounts and
 * removes the container before returning so tests stay isolated.
 *
 * Do NOT use this for tests that specifically assert SSR/first-paint
 * behavior -- those should call renderToStaticMarkup directly and expect the
 * loading state. Test files using this helper need the jsdom environment
 * pragma (// @vitest-environment jsdom) at the top.
 */
export function renderClientMarkup(element) {
  markSWRHydrated();
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(element);
  });
  const html = container.innerHTML;
  act(() => {
    root.unmount();
  });
  container.remove();
  return html;
}
