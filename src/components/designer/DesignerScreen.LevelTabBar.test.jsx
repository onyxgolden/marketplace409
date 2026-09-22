// @vitest-environment jsdom

// LevelTabBar + levelDeleteClick: the two-click delete contract for the
// HOME DESIGNER slice 2 level switcher (review finding 2).
//
// Contract: the first click on a level's × only ARMS that level (shows
// "Sure?") — nothing is deleted. Only a second click on the SAME armed
// level deletes it. Clicking × on a different level re-arms that level
// instead. The × is hidden when one level remains. The "Levels" label
// tooltip states level management is not undoable.

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi, afterEach } from "vitest";
import { LevelTabBar, levelDeleteClick } from "./DesignerScreen";
import { addLevel, createHomeProject } from "@/domains/roomDesigner/homeProject";

describe("levelDeleteClick", () => {
  it("first click arms the level (does not delete)", () => {
    expect(levelDeleteClick(null, "level_1")).toEqual({ armed: "level_1" });
  });

  it("second click on the same armed level deletes it", () => {
    expect(levelDeleteClick("level_1", "level_1")).toEqual({ delete: "level_1" });
  });

  it("clicking a different level re-arms that level instead of deleting the armed one", () => {
    expect(levelDeleteClick("level_1", "level_2")).toEqual({ armed: "level_2" });
  });

  it("arming is stable across repeated clicks on unarmed levels", () => {
    expect(levelDeleteClick("level_2", "level_1")).toEqual({ armed: "level_1" });
  });
});

describe("LevelTabBar", () => {
  let container;
  let root;

  const renderBar = (props) => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const defaults = {
      project: props.project,
      renamingLevelId: null,
      confirmDeleteLevelId: null,
      onSwitchLevel: vi.fn(),
      onAddLevel: vi.fn(),
      onStartRename: vi.fn(),
      onCommitRename: vi.fn(),
      onCancelRename: vi.fn(),
      onDeleteLevel: vi.fn(),
    };
    act(() => {
      root.render(<LevelTabBar {...defaults} {...props} />);
    });
    return defaults;
  };

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const twoLevels = () => {
    let project = createHomeProject("House");
    project = addLevel(project, "Second floor");
    return project;
  };

  const deleteButtons = () =>
    [...container.querySelectorAll("button")].filter((b) =>
      (b.getAttribute("aria-label") || "").startsWith("Delete ") ||
      (b.getAttribute("aria-label") || "").startsWith("Confirm delete "),
    );

  it("renders a delete button per level, each naming its own level", () => {
    const project = twoLevels();
    renderBar({ project });
    const buttons = deleteButtons();
    expect(buttons).toHaveLength(2);
    expect(buttons[0].getAttribute("aria-label")).toBe("Delete Level 1");
    expect(buttons[1].getAttribute("aria-label")).toBe("Delete Second floor");
  });

  it("hides the delete button entirely when one level remains", () => {
    const project = createHomeProject("House");
    renderBar({ project });
    expect(deleteButtons()).toHaveLength(0);
  });

  it("shows the confirm affordance only on the armed level", () => {
    const project = twoLevels();
    const armedId = project.levels[0].id;
    renderBar({ project, confirmDeleteLevelId: armedId });
    const buttons = deleteButtons();
    expect(buttons).toHaveLength(2);
    expect(buttons[0].textContent).toBe("Sure?");
    expect(buttons[0].getAttribute("aria-label")).toBe("Confirm delete Level 1");
    expect(buttons[0].title).toMatch(/click again to delete/i);
    // The other level keeps its plain ×.
    expect(buttons[1].textContent).not.toBe("Sure?");
    expect(buttons[1].getAttribute("aria-label")).toBe("Delete Second floor");
  });

  it("routes a delete click to onDeleteLevel with the exact level id", () => {
    const project = twoLevels();
    const props = renderBar({ project });
    const targetId = project.levels[1].id;
    const buttons = deleteButtons();
    act(() => {
      buttons[1].dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    });
    expect(props.onDeleteLevel).toHaveBeenCalledTimes(1);
    expect(props.onDeleteLevel).toHaveBeenCalledWith(targetId);
  });

  it("routes a tab click to onSwitchLevel with the level id", () => {
    const project = twoLevels();
    const props = renderBar({ project });
    const tab = [...container.querySelectorAll("button")].find(
      (b) => b.textContent === "Second floor",
    );
    act(() => {
      tab.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    });
    expect(props.onSwitchLevel).toHaveBeenCalledWith(project.levels[1].id);
  });

  it("the Levels label tells the user level management is not undoable", () => {
    const project = twoLevels();
    renderBar({ project });
    const label = [...container.querySelectorAll("span")].find(
      (s) => s.textContent === "Levels",
    );
    expect(label.title).toMatch(/not undoable/i);
  });
});
