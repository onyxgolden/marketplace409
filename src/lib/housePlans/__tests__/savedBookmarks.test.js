// @vitest-environment jsdom

import {
  bookmarksKey,
  isBookmarked,
  readBookmarks,
  toggleBookmark,
} from "../savedBookmarks";

const PROJECT = "project-abc";

describe("savedBookmarks (HP-L6)", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("keys bookmarks per project", () => {
    expect(bookmarksKey(PROJECT)).toBe("forge-house-plans-bookmarks:project-abc");
    expect(bookmarksKey(null)).toBe("forge-house-plans-bookmarks:default");
  });

  it("starts empty", () => {
    expect(readBookmarks(PROJECT)).toEqual([]);
    expect(isBookmarked(PROJECT, "r1")).toBe(false);
  });

  it("toggles a bookmark on and off", () => {
    let next = toggleBookmark(PROJECT, "r1");
    expect(next).toEqual(["r1"]);
    expect(isBookmarked(PROJECT, "r1")).toBe(true);

    next = toggleBookmark(PROJECT, "r1");
    expect(next).toEqual([]);
    expect(isBookmarked(PROJECT, "r1")).toBe(false);
  });

  it("keeps newest bookmarks first and never duplicates", () => {
    toggleBookmark(PROJECT, "r1");
    toggleBookmark(PROJECT, "r2");
    toggleBookmark(PROJECT, "r1"); // removing, then…
    toggleBookmark(PROJECT, "r1"); // re-adding moves it to the front
    const list = readBookmarks(PROJECT);
    expect(list).toEqual(["r1", "r2"]);
    expect(new Set(list).size).toBe(list.length);
  });

  it("isolates bookmarks between projects", () => {
    toggleBookmark("project-a", "r1");
    toggleBookmark("project-b", "r2");
    expect(readBookmarks("project-a")).toEqual(["r1"]);
    expect(readBookmarks("project-b")).toEqual(["r2"]);
  });

  it("ignores invalid reference ids instead of persisting them", () => {
    expect(toggleBookmark(PROJECT, null)).toEqual([]);
    expect(toggleBookmark(PROJECT, "")).toEqual([]);
    expect(isBookmarked(PROJECT, null)).toBe(false);
  });

  it("survives corrupt stored JSON", () => {
    localStorage.setItem(bookmarksKey(PROJECT), "{not json");
    expect(readBookmarks(PROJECT)).toEqual([]);
    expect(toggleBookmark(PROJECT, "r1")).toEqual(["r1"]);
  });

  it("persists across reads in this browser session", () => {
    toggleBookmark(PROJECT, "r1");
    expect(readBookmarks(PROJECT)).toEqual(["r1"]);
  });
});
