// A 3D rebuild disposes its own geometry but never the geometry a furniture
// model clone shares with its cached template.

import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { swapContentGroup } from "./DesignerViewport3D";

describe("swapContentGroup and shared model geometry", () => {
  it("disposes per-rebuild geometry but keeps shared model geometry alive", () => {
    const scene = new THREE.Scene();
    const old = new THREE.Group();
    const own = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
    const shared = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
    shared.userData.sharedAsset = true;
    old.add(own, shared);
    scene.add(old);
    const ownDispose = vi.spyOn(own.geometry, "dispose");
    const sharedDispose = vi.spyOn(shared.geometry, "dispose");
    const next = new THREE.Group();
    expect(swapContentGroup(scene, old, next)).toBe(next);
    expect(ownDispose).toHaveBeenCalledTimes(1);
    expect(sharedDispose).not.toHaveBeenCalled();
    expect(scene.children).toContain(next);
    expect(scene.children).not.toContain(old);
  });
});
