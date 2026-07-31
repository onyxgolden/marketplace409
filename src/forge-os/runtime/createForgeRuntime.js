import {
  ForgeRuntime,
} from "./ForgeRuntime.js";

import {
  registerVersionOneManagers,
} from "../managers/registerVersionOneManagers.js";

export function createForgeRuntime() {
  return new ForgeRuntime({
    managerRegistry:
      registerVersionOneManagers(),
  });
}
