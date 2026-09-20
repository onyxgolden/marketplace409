"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { buildThreeScene } from "@/domains/roomDesigner/designerThreeModel";

const IN = 1; // scene units are inches; camera distances derived from floor size

/**
 * 3D view of the design: extruded walls (with real door/window gaps),
 * furniture as simple 3D volumes, orbit controls. Rebuilt from the
 * design document whenever it changes.
 */
export default function DesignerViewport3D({ design }) {
  const mountRef = useRef(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const scene = buildThreeScene(design);
    const width = mount.clientWidth || 800;
    const height = mount.clientHeight || 600;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    mount.appendChild(renderer.domElement);

    const threeScene = new THREE.Scene();
    threeScene.background = new THREE.Color("#0b1220");

    const floorSize = scene.floor
      ? Math.max(scene.floor.maxX - scene.floor.minX, scene.floor.maxZ - scene.floor.minZ, 240)
      : 480;
    const camera = new THREE.PerspectiveCamera(50, width / height, 1, floorSize * 20);
    const cx = scene.floor ? (scene.floor.minX + scene.floor.maxX) / 2 : 0;
    const cz = scene.floor ? (scene.floor.minZ + scene.floor.maxZ) / 2 : 0;
    camera.position.set(cx + floorSize * 0.55, floorSize * 0.75, cz + floorSize * 0.55);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(cx, 0, cz);
    controls.maxPolarAngle = Math.PI / 2 - 0.02;
    controls.update();

    threeScene.add(new THREE.HemisphereLight("#ffffff", "#1f2937", 0.9));
    const sun = new THREE.DirectionalLight("#ffffff", 1.1);
    sun.position.set(cx + floorSize, floorSize * 1.2, cz + floorSize * 0.6);
    threeScene.add(sun);

    const disposables = [];
    const track = (obj) => {
      disposables.push(obj);
      return obj;
    };

    // floor
    if (scene.floor) {
      const fw = scene.floor.maxX - scene.floor.minX;
      const fd = scene.floor.maxZ - scene.floor.minZ;
      const floorMesh = new THREE.Mesh(
        track(new THREE.PlaneGeometry(fw, fd)),
        track(new THREE.MeshStandardMaterial({ color: "#1a2333", roughness: 1 })),
      );
      floorMesh.rotation.x = -Math.PI / 2;
      floorMesh.position.set((scene.floor.minX + scene.floor.maxX) / 2, -0.5, (scene.floor.minZ + scene.floor.maxZ) / 2);
      threeScene.add(floorMesh);
      const grid = new THREE.GridHelper(Math.max(fw, fd), Math.round(Math.max(fw, fd) / 24), "#334155", "#1e293b");
      grid.position.set(floorMesh.position.x, 0, floorMesh.position.z);
      threeScene.add(grid);
      track(grid.geometry);
      track(grid.material);
    }

    // walls (and window sills/headers)
    const wallMaterial = track(new THREE.MeshStandardMaterial({ color: "#e8e4da", roughness: 0.9 }));
    const trimMaterial = track(new THREE.MeshStandardMaterial({ color: "#c9c2b2", roughness: 0.9 }));
    for (const seg of scene.walls) {
      const length = Math.hypot(seg.b.x - seg.a.x, seg.b.y - seg.a.y);
      if (length < 0.5) continue;
      const height = seg.y1In - seg.y0In;
      if (height < 0.5) continue;
      const geo = track(new THREE.BoxGeometry(length, height, seg.thicknessIn * IN));
      const mesh = new THREE.Mesh(geo, seg.kind === "wall" ? wallMaterial : trimMaterial);
      const angle = Math.atan2(seg.b.y - seg.a.y, seg.b.x - seg.a.x);
      mesh.position.set((seg.a.x + seg.b.x) / 2, seg.y0In + height / 2, (seg.a.y + seg.b.y) / 2);
      mesh.rotation.y = -angle;
      threeScene.add(mesh);
    }

    // furniture volumes
    for (const box of scene.furniture) {
      const geo = track(new THREE.BoxGeometry(box.widthIn * IN, box.heightIn * IN, box.depthIn * IN));
      const mat = track(new THREE.MeshStandardMaterial({ color: box.color, roughness: 0.85 }));
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(box.x, box.heightIn / 2, box.z);
      mesh.rotation.y = box.rotY;
      threeScene.add(mesh);
    }

    let raf = 0;
    const animate = () => {
      raf = requestAnimationFrame(animate);
      controls.update();
      renderer.render(threeScene, camera);
    };
    animate();

    const onResize = () => {
      const w = mount.clientWidth || 800;
      const h = mount.clientHeight || 600;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener("resize", onResize);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      controls.dispose();
      for (const d of disposables) d.dispose?.();
      renderer.dispose();
      mount.removeChild(renderer.domElement);
    };
  }, [design]);

  return <div ref={mountRef} className="h-full w-full" />;
}
