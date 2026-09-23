"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { buildThreeScene } from "@/domains/roomDesigner/designerThreeModel";
import { furnitureParts } from "@/domains/roomDesigner/designerFurnitureParts";
import {
  acquireTextureCaches,
  plasterTexture,
  releaseTextureCaches,
  skyTexture,
  woodFloorTexture,
} from "./designerThreeTextures";

const IN = 1; // scene units are inches; camera distances derived from floor size

// Quality tiers (arch review: degrade gracefully on integrated GPUs).
// High: full PBR ambience + 2048 shadows + textures.
// Balanced: PBR ambience + 1024 shadows + textures.
// Low: no environment map + 1024 shadows + flat colors.
const TIERS = {
  high: { env: true, shadowSize: 2048, textured: true },
  balanced: { env: true, shadowSize: 1024, textured: true },
  low: { env: false, shadowSize: 1024, textured: false },
};

function pickQualityTier() {
  try {
    const override = window.localStorage.getItem("forge-3d-quality");
    if (override && TIERS[override]) return override;
  } catch {
    // storage unavailable — fall through to capability detection
  }
  const cores = window.navigator.hardwareConcurrency || 8;
  const coarse = window.matchMedia?.("(pointer: coarse)").matches;
  if (coarse || cores <= 4) return "low";
  if (cores <= 8) return "balanced";
  return "high";
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/**
 * 3D view of the design: extruded walls (with real door/window gaps and
 * glass), composed furniture, sun shadows, and PBR ambience. Rebuilt from
 * the design document whenever it changes.
 */
export default function DesignerViewport3D({ design }) {
  const mountRef = useRef(null);

  useEffect(() => {
    const mount = mountRef.current;
    acquireTextureCaches();
    if (!mount) return;

    const tierName = pickQualityTier();
    const tier = TIERS[tierName];
    const scene = buildThreeScene(design);
    const width = mount.clientWidth || 800;
    const height = mount.clientHeight || 600;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    mount.appendChild(renderer.domElement);

    const threeScene = new THREE.Scene();
    threeScene.background = skyTexture();
    const floorSize = scene.floor
      ? Math.max(scene.floor.maxX - scene.floor.minX, scene.floor.maxZ - scene.floor.minZ, 240)
      : 480;
    threeScene.fog = new THREE.Fog(0xe9e2d0, floorSize * 1.5, floorSize * 5);

    // PBR ambience (high/balanced only; PMREM targets are disposed on unmount).
    let pmrem = null;
    let envRT = null;
    if (tier.env) {
      pmrem = new THREE.PMREMGenerator(renderer);
      envRT = pmrem.fromScene(new RoomEnvironment(), 0.04);
      threeScene.environment = envRT.texture;
      threeScene.environmentIntensity = 0.45;
    }

    const camera = new THREE.PerspectiveCamera(50, width / height, 1, floorSize * 20);
    const cx = scene.floor ? (scene.floor.minX + scene.floor.maxX) / 2 : 0;
    const cz = scene.floor ? (scene.floor.minZ + scene.floor.maxZ) / 2 : 0;
    camera.position.set(cx + floorSize * 0.55, floorSize * 0.75, cz + floorSize * 0.55);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(cx, 0, cz);
    controls.maxPolarAngle = Math.PI / 2 - 0.02;
    controls.update();

    threeScene.add(new THREE.HemisphereLight(0xbdd5f2, 0x8a7f6a, 0.5));

    // Sun with a shadow frustum fitted to the model bounds and clamped so
    // pathological geometry can't blow it out (arch review).
    const sun = new THREE.DirectionalLight(0xfff1dc, 2.4);
    const ext = scene.floor ? clamp(Math.max(floorSize, 240) / 2, 120, 1200) : 480;
    sun.position.set(cx + ext * 1.1, ext * 1.5, cz + ext * 0.7);
    sun.target.position.set(cx, 0, cz);
    threeScene.add(sun.target);
    sun.castShadow = true;
    sun.shadow.mapSize.set(tier.shadowSize, tier.shadowSize);
    sun.shadow.camera.left = -ext;
    sun.shadow.camera.right = ext;
    sun.shadow.camera.top = ext;
    sun.shadow.camera.bottom = -ext;
    sun.shadow.camera.near = 10;
    sun.shadow.camera.far = ext * 4 + 500;
    sun.shadow.camera.updateProjectionMatrix();
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 1.5;
    threeScene.add(sun);

    const disposables = [];
    const track = (obj) => {
      disposables.push(obj);
      return obj;
    };

    // Material cache: one material per color/finish, reused across rebuilds
    // (arch review: never a texture/material per object instance).
    const materialCache = new Map();
    const stdMaterial = ({ color, map = null, roughness = 0.85, emissive = null, transparent = false, opacity = 1, depthWrite = true }) => {
      const key = `${color}|${roughness}|${emissive || ""}|${transparent}|${map ? "map" : ""}`;
      if (!materialCache.has(key)) {
        materialCache.set(
          key,
          new THREE.MeshStandardMaterial({
            color,
            map,
            roughness,
            metalness: 0,
            ...(emissive ? { emissive, emissiveIntensity: 0.55 } : {}),
            ...(transparent ? { transparent: true, opacity, depthWrite } : {}),
          }),
        );
      }
      return materialCache.get(key);
    };

    const shadowed = (mesh) => {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      return mesh;
    };

    // floor
    if (scene.floor) {
      const fw = scene.floor.maxX - scene.floor.minX;
      const fd = scene.floor.maxZ - scene.floor.minZ;
      const floorMat = tier.textured
        ? stdMaterial({ color: "#ffffff", map: woodFloorTexture(fw / 96, fd / 96), roughness: 0.7 })
        : stdMaterial({ color: "#a98f66", roughness: 0.9 });
      const floorMesh = new THREE.Mesh(track(new THREE.PlaneGeometry(fw, fd)), floorMat);
      floorMesh.rotation.x = -Math.PI / 2;
      floorMesh.position.set((scene.floor.minX + scene.floor.maxX) / 2, -0.5, (scene.floor.minZ + scene.floor.maxZ) / 2);
      floorMesh.receiveShadow = true;
      threeScene.add(floorMesh);
    }

    // walls (and window sills/headers)
    const wallMaterial = tier.textured
      ? stdMaterial({ color: "#ffffff", map: plasterTexture(3, 1.5), roughness: 0.95 })
      : stdMaterial({ color: "#ece8dc", roughness: 0.95 });
    const trimMaterial = stdMaterial({ color: "#d9d2c2", roughness: 0.9 });
    const glassMaterial = stdMaterial({
      color: "#bcd6e8",
      roughness: 0.1,
      transparent: true,
      opacity: 0.22,
      depthWrite: false, // arch review: glass must not write depth
    });
    for (const seg of scene.walls) {
      const length = Math.hypot(seg.b.x - seg.a.x, seg.b.y - seg.a.y);
      if (length < 0.5) continue;
      const height = seg.y1In - seg.y0In;
      if (height < 0.5) continue;
      const mesh = shadowed(
        new THREE.Mesh(
          track(new THREE.BoxGeometry(length, height, seg.thicknessIn * IN)),
          seg.kind === "wall" ? wallMaterial : trimMaterial,
        ),
      );
      const angle = Math.atan2(seg.b.y - seg.a.y, seg.b.x - seg.a.x);
      mesh.position.set((seg.a.x + seg.b.x) / 2, seg.y0In + height / 2, (seg.a.y + seg.b.y) / 2);
      mesh.rotation.y = -angle;
      threeScene.add(mesh);
    }

    // window glass
    for (const pane of scene.glass || []) {
      const length = Math.hypot(pane.b.x - pane.a.x, pane.b.y - pane.a.y);
      if (length < 0.5) continue;
      const height = pane.y1In - pane.y0In;
      if (height < 0.5) continue;
      const mesh = new THREE.Mesh(track(new THREE.PlaneGeometry(length, height)), glassMaterial);
      const angle = Math.atan2(pane.b.y - pane.a.y, pane.b.x - pane.a.x);
      mesh.position.set((pane.a.x + pane.b.x) / 2, pane.y0In + height / 2, (pane.a.y + pane.b.y) / 2);
      mesh.rotation.y = -angle;
      threeScene.add(mesh);
    }

    // furniture: composed groups from pure part descriptors
    for (const item of scene.furniture) {
      const group = new THREE.Group();
      const parts = furnitureParts(item.catalogId || "unknown", {
        widthIn: item.widthIn,
        depthIn: item.depthIn,
        heightIn: item.heightIn,
        color: item.color,
      });
      for (const part of parts) {
        const geo =
          part.shape === "cyl"
            ? track(new THREE.CylinderGeometry(part.w / 2, part.w / 2, part.h, 20))
            : track(new THREE.BoxGeometry(part.w, part.h, part.d));
        const mat = stdMaterial({
          color: part.color || item.color,
          roughness: 0.8,
          ...(part.glow ? { emissive: part.color || item.color } : {}),
        });
        const mesh = shadowed(new THREE.Mesh(geo, mat));
        mesh.position.set(part.dx, part.dy, part.dz);
        if (part.rotX) mesh.rotation.x = part.rotX;
        group.add(mesh);
      }
      group.position.set(item.x, 0, item.z);
      group.rotation.y = item.rotY;
      threeScene.add(group);
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
      for (const m of materialCache.values()) m.dispose();
      materialCache.clear();
      envRT?.dispose();
      pmrem?.dispose();
      releaseTextureCaches();
      renderer.dispose();
      mount.removeChild(renderer.domElement);
    };
  }, [design]);

  return <div ref={mountRef} className="h-full w-full" />;
}
