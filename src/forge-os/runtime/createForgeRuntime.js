import {
  ForgeRuntime,
} from "./ForgeRuntime.js";

import {
  registerVersionOneManagers,
} from "../managers/registerVersionOneManagers.js";

import {
  createCanonicalContextStore,
} from "../context/createCanonicalContextStore.js";

export function createForgeRuntime() {
  return new ForgeRuntime({
    managerRegistry:
      registerVersionOneManagers(),

    contextStore:
      createCanonicalContextStore(),
  });
}
