import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  WorkspaceModule,
} from "../WorkspaceModule.js";

function createWorkspaceModule(overrides = {}) {
  return new WorkspaceModule({
    moduleIdentity: "financial-position",
    displayName: "Financial Position",
    category: "financial",
    priority: 10,
    renderTile: vi.fn(),
    ...overrides,
  });
}

describe("WorkspaceModule", () => {
  it("creates an immutable workspace module definition", () => {
    const renderTile = vi.fn();

    const workspaceModule = createWorkspaceModule({
      renderTile,
    });

    expect(workspaceModule.moduleIdentity).toBe(
      "financial-position",
    );

    expect(workspaceModule.displayName).toBe(
      "Financial Position",
    );

    expect(workspaceModule.category).toBe(
      "financial",
    );

    expect(workspaceModule.priority).toBe(10);
    expect(workspaceModule.renderTile).toBe(
      renderTile,
    );

    expect(
      Object.isFrozen(workspaceModule),
    ).toBe(true);
  });

  it("uses a deterministic default priority", () => {
    const workspaceModule =
      new WorkspaceModule({
        moduleIdentity: "transaction-review",
        displayName: "Transaction Review",
        category: "review",
        renderTile: vi.fn(),
      });

    expect(workspaceModule.priority).toBe(100);
  });

  it.each([
    [
      { moduleIdentity: "" },
      "WorkspaceModule requires a moduleIdentity.",
    ],
    [
      { displayName: "" },
      "WorkspaceModule requires a displayName.",
    ],
    [
      { category: "" },
      "WorkspaceModule requires a category.",
    ],
    [
      { priority: -1 },
      "WorkspaceModule requires priority to be a non-negative integer.",
    ],
    [
      { priority: 1.5 },
      "WorkspaceModule requires priority to be a non-negative integer.",
    ],
    [
      { renderTile: undefined },
      "WorkspaceModule requires a renderTile function.",
    ],
  ])(
    "rejects invalid module definitions",
    (overrides, expectedMessage) => {
      expect(() =>
        createWorkspaceModule(overrides),
      ).toThrow(expectedMessage);
    },
  );
});
