// Shared test setup: the app always mounts SWRIdentityBridge at the root,
// which marks the shared SWR hydration boundary after the first commit.
// Component tests mount consumers without the root layout, so mark hydration
// here to give them the same post-hydration state the running app has --
// otherwise every consumer would sit in its loading state and no fetched
// data would ever render in tests.
//
// Tests that specifically need the pre-hydration state (the SSR/hydration
// regression suites) reset the store in their own beforeEach via
// resetSWRHydration() and mark it explicitly when they need it.
import { markSWRHydrated } from "./src/hooks/swrHydration.js";

markSWRHydrated();
