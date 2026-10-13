// Designer UI state reducer — composition root for the domain slices in
// ./reducer/. Each slice handles its own action set and passes everything
// else through unchanged; the composed reducer is behavior-identical to the
// original single-switch implementation.

import { historySlice } from "./reducer/historySlice";
import { selectionSlice } from "./reducer/selectionSlice";
import { toolSlice } from "./reducer/toolSlice";
import { documentSlice } from "./reducer/documentSlice";
import { createInitialState } from "./reducer/historySlice";
import { TOOLS } from "./reducer/toolSlice";

export { createInitialState, TOOLS };

export function designerReducer(state, action) {
  state = historySlice(state, action);
  state = selectionSlice(state, action);
  state = toolSlice(state, action);
  return documentSlice(state, action);
}
