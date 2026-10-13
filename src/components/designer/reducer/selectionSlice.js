// selectionSlice: extracted verbatim from designerReducer.js.


export function selectionSlice(state, action) {
  switch (action.type) {
    case "SELECT_HOUSE":
      return { ...state, tool: "select", selection: { kind: "house", id: "house" }, multiSelection: [] };

    case "SELECT":
      return { ...state, selection: action.selection, multiSelection: [] };

    case "TOGGLE_MULTI_SELECT": {
      const target = action.target;
      if (!target || target.kind !== "furniture") return state;
      const has = state.multiSelection.some((m) => m.id === target.id);
      return {
        ...state,
        selection: null,
        multiSelection: has
          ? state.multiSelection.filter((m) => m.id !== target.id)
          : [...state.multiSelection, { kind: "furniture", id: target.id }],
      };
    }

    case "CLEAR_SELECTION":
      return { ...state, selection: null, multiSelection: [] };
    default:
      return state;
  }
}
