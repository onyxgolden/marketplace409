// A 3D rebuild disposes its own geometry but never the geometry a furniture
// model clone shares with its cached template.

import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { disposeContentGroup, swapContentGroup } from "./DesignerViewport3D";

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

describe("disposeContentGroup with furniture models AND TrueView tag sprites (integration)", () => {
  it("releases sprites without disposing them, skips shared model geometry, disposes the rest", () => {
    const group = new THREE.Group();
    const own = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
    const shared = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
    shared.userData.sharedAsset = true;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial());
    group.add(own, shared, sprite);
    const ownDispose = vi.spyOn(own.geometry, "dispose");
    const sharedDispose = vi.spyOn(shared.geometry, "dispose");
    const spriteGeoDispose = vi.spyOn(sprite.geometry, "dispose"); // three.js shares one sprite geometry
    const spriteMatDispose = vi.spyOn(sprite.material, "dispose");
    disposeContentGroup(group);
    expect(ownDispose).toHaveBeenCalledTimes(1);
    expect(sharedDispose).not.toHaveBeenCalled();
    expect(spriteGeoDispose).not.toHaveBeenCalled();
    expect(spriteMatDispose).not.toHaveBeenCalled();
  });
});
