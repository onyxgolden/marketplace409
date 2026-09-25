// DesignerViewport3D.swap.test.js — rebuilds must not leave old geometry in the scene.
//
// Found live during P1-B: every debounced rebuild added a fresh content group
// but only DISPOSED the old one, never removed it. three.js re-uploads a
// disposed geometry that is still in the scene graph, so each step of a drag
// left a ghost copy of the house on screen (24 stacked groups after a few
// drags) and GPU memory grew with every edit. Plain Node, real Three.js
// objects, no WebGL — same approach as DesignerViewport3D.highlight.test.js.

import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { swapContentGroup } from "./DesignerViewport3D";

function contentGroup() {
  const group = new THREE.Group();
  group.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial()));
  return group;
}

describe("swapContentGroup", () => {
  it("keeps exactly one content group in the scene across many rebuilds", () => {
    const scene = new THREE.Scene();
    let current = null;
    for (let i = 0; i < 25; i += 1) current = swapContentGroup(scene, current, contentGroup());
    expect(scene.children.filter((c) => c.isGroup)).toEqual([current]);
  });

  it("disposes the old group's geometry and returns the new group", () => {
    const scene = new THREE.Scene();
    const oldGroup = swapContentGroup(scene, null, contentGroup());
    const geometry = oldGroup.children[0].geometry;
    const dispose = vi.spyOn(geometry, "dispose");
    const next = contentGroup();
    expect(swapContentGroup(scene, oldGroup, next)).toBe(next);
    expect(oldGroup.parent).toBeNull();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("with no new group (unmount) empties the scene of content", () => {
    const scene = new THREE.Scene();
    const group = swapContentGroup(scene, null, contentGroup());
    expect(swapContentGroup(scene, group, null)).toBeNull();
    expect(scene.children).toHaveLength(0);
  });
});
