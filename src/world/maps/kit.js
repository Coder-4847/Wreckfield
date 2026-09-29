import * as THREE from 'three';
import { containerTextures, createNoise } from '../textures.js';
import { memo, facadeTextures, poolTexture } from '../textures2.js';

// Shared prop builders for the maps. Everything here goes through Arena.decor() (merged per material) or the
// Arena collider helpers, so props stay cheap in draw calls and are disposed with the arena.

const mat = (props) => new THREE.MeshStandardMaterial(props);

// ---------------------------------------------------------------------------------------------------------------
// Shipping containers
// ---------------------------------------------------------------------------------------------------------------
export const CONT = { L: 12.2, H: 2.6, D: 2.44 };
export const CONTAINER_DEFS = [
  ['#8e3a2b', 'WRK·0719'], ['#2c6a72', 'MARLINE'], ['#b98a2a', 'SCRAPCO'],
  ['#33477a', 'VOLTLINE'], ['#6a6d70', 'KRUSH-44'], ['#3d6b45', 'GRNDLINE'],
  ['#a8551f', 'HALVORSEN'], ['#d8d4c8', 'NORDCARGO'],
];

/**
 * Container factory: each container is a dark steel body plus two textured side panels (both merged per material).
 * `place(x, y, z, rotY, {idx, collider})` — (x,z) is the centre, y the bottom. `stack(...)` lays out a block.
 */
export function containerKit(a, defs = CONTAINER_DEFS) {
  const sides = defs.map(([c, l], i) => {
    const t = memo(`cont:${i}:${c}:${l}`, () => containerTextures(c, l, 50 + i));
    return mat({ map: t.map, normalMap: t.normalMap, roughness: 0.55, metalness: 0.5 });
  });
  const body = mat({ color: 0x3a3a3c, roughness: 0.65, metalness: 0.6 });
  const bodyGeo = new THREE.BoxGeometry(CONT.L, CONT.H, CONT.D);
  const panelGeo = new THREE.PlaneGeometry(CONT.L, CONT.H);
  let next = 0;
  const place = (x, y, z, rotY, { idx = next++, collider = true, tilt = 0 } = {}) => {
    const cy = y + CONT.H / 2;
    a.decor(bodyGeo, body, { pos: [x, cy, z], rot: [0, rotY, tilt] });
    const nx = Math.sin(rotY), nz = Math.cos(rotY); // local +z axis in world
    const off = CONT.D / 2 + 0.004;
    const m = sides[((idx % sides.length) + sides.length) % sides.length];
    a.decor(panelGeo, m, { pos: [x + nx * off, cy, z + nz * off], rot: [0, rotY, tilt] });
    a.decor(panelGeo, m, { pos: [x - nx * off, cy, z - nz * off], rot: [0, rotY + Math.PI, tilt] });
    if (collider) a.solid([CONT.L, CONT.H, CONT.D], [x, cy, z], { rotY });
  };
  /** nx containers along the block length, nz rows, `levels` high; rotY turns the whole block around its centre. */
  const stack = (cx, cz, { nx = 2, nz = 2, levels = 2, rotY = 0, gap = 0.25, jitter = 0.12, seed = 1 } = {}) => {
    const n = createNoise(seed);
    const c = Math.cos(rotY), s = Math.sin(rotY);
    const pitchX = CONT.L + gap, pitchZ = CONT.D + gap;
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < nz; j++) {
        const lx = (i - (nx - 1) / 2) * pitchX + (n.rnd() - 0.5) * jitter * 4;
        const lz = (j - (nz - 1) / 2) * pitchZ;
        const lv = levels === 1 ? 1 : 1 + Math.floor(n.rnd() * levels);
        const wx = cx + lx * c + lz * s, wz = cz - lx * s + lz * c;
        for (let k = 0; k < lv; k++) place(wx, k * CONT.H, wz, rotY, { collider: false });
        // one collider for the whole column (cheaper than one per box)
        const h = lv * CONT.H;
        a.solid([CONT.L, h, CONT.D], [wx, h / 2, wz], { rotY });
      }
    }
  };
  return { place, stack };
}

// ---------------------------------------------------------------------------------------------------------------
// Lamps + light pools (no dynamic lights: emissive lenses + additive ground decals)
// ---------------------------------------------------------------------------------------------------------------
export function lampKit(a, { color = 0xffc98a, poolTint = 0xffb066, poolOpacity = 0.5 } = {}) {
  const pole = mat({ color: 0x4b4f55, roughness: 0.55, metalness: 0.8 });
  const head = mat({ color: 0x26292d, roughness: 0.5, metalness: 0.6 });
  const lens = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(2.6), toneMapped: false });
  const pool = new THREE.MeshBasicMaterial({
    map: poolTexture(), color: poolTint, transparent: true, opacity: poolOpacity, depthWrite: false,
    blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
  });
  const poleGeo = new THREE.CylinderGeometry(0.11, 0.17, 1, 8);
  const armGeo = new THREE.BoxGeometry(1, 0.1, 0.1);
  const headGeo = new THREE.BoxGeometry(0.9, 0.16, 0.34);
  const lensGeo = new THREE.BoxGeometry(0.8, 0.03, 0.26);
  const poolGeo = new THREE.PlaneGeometry(1, 1);
  const footGeo = new THREE.CylinderGeometry(0.28, 0.34, 0.4, 8);
  /** rotY: direction the arm points (0 = +z). */
  return (x, z, { h = 8, arm = 1.6, rotY = 0, poolR = 8, collider = true } = {}) => {
    a.decor(poleGeo, pole, { pos: [x, h / 2, z], scale: [1, h, 1] });
    a.decor(footGeo, pole, { pos: [x, 0.2, z] });
    const ax = x + Math.sin(rotY) * arm * 0.5, az = z + Math.cos(rotY) * arm * 0.5;
    a.decor(armGeo, pole, { pos: [ax, h, az], rot: [0, rotY - Math.PI / 2, 0], scale: [arm, 1, 1] });
    const hx = x + Math.sin(rotY) * arm, hz = z + Math.cos(rotY) * arm;
    a.decor(headGeo, head, { pos: [hx, h - 0.05, hz], rot: [0, rotY, 0] });
    a.decor(lensGeo, lens, { pos: [hx, h - 0.15, hz], rot: [0, rotY, 0], cast: false });
    a.decor(poolGeo, pool, { pos: [hx, 0.045, hz], rot: [-Math.PI / 2, 0, 0], scale: [poolR * 2, poolR * 2, 1], cast: false });
    if (collider) a.solidCyl(0.25, 3, [x, 0, z]);
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Buildings
// ---------------------------------------------------------------------------------------------------------------
/** Box geometry whose UVs are scaled to world size, so one tiled facade texture keeps a constant window size. */
export function boxGeo(w, h, d, { tw = 12, th = 18 } = {}) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  const scale = [[d / tw, h / th], [d / tw, h / th], [w / tw, d / tw], [w / tw, d / tw], [w / tw, h / th], [w / tw, h / th]];
  for (let f = 0; f < 6; f++) {
    for (let i = 0; i < 4; i++) {
      const k = f * 4 + i;
      uv.setXY(k, uv.getX(k) * scale[f][0], uv.getY(k) * scale[f][1]);
    }
  }
  return g;
}

/** Shared (per-arena) facade material: tiled windows, lit ones glow through the emissive map. */
export function facadeMat(a, kind = 'concrete', lit = 0.3, seed = 3, emissive = 1.0) {
  a._mats ??= new Map();
  const key = `${kind}:${lit}:${seed}:${emissive}`;
  if (!a._mats.has(key)) {
    const f = facadeTextures(kind, lit, seed);
    a._mats.set(key, mat({
      map: f.map, emissiveMap: f.emissiveMap, emissive: new THREE.Color(1, 1, 1), emissiveIntensity: emissive,
      roughness: kind === 'glass' ? 0.25 : 0.85, metalness: kind === 'glass' ? 0.6 : 0.05,
    }));
  }
  return a._mats.get(key);
}

/** Flat-coloured shared material (per arena). */
export function flatMat(a, color, { roughness = 0.85, metalness = 0.05 } = {}) {
  a._mats ??= new Map();
  const key = `flat:${color}:${roughness}:${metalness}`;
  if (!a._mats.has(key)) a._mats.set(key, mat({ color, roughness, metalness }));
  return a._mats.get(key);
}

/**
 * Solid building block with a tiled window facade + roof slab and rooftop clutter. `base` lifts it off the ground
 * (for overpasses). Merged into the arena's decor batches; a single cuboid collider.
 */
export function building(a, { x, z, w, d, h, rotY = 0, kind = 'concrete', lit = 0.3, seed = 3, roof = 0x55585c, emissive = 1.0, base = 0, collider = true, clutter = true }) {
  a.decor(boxGeo(w, h, d), facadeMat(a, kind, lit, seed, emissive), { pos: [x, base + h / 2, z], rot: [0, rotY, 0] });
  const roofMat = flatMat(a, roof, { roughness: 0.9 });
  const c = Math.cos(rotY), s = Math.sin(rotY);
  const at = (lx, lz) => [x + lx * c + lz * s, z - lx * s + lz * c];
  a.decor(new THREE.BoxGeometry(w + 0.5, 0.5, d + 0.5), roofMat, { pos: [x, base + h + 0.25, z], rot: [0, rotY, 0] });
  if (clutter && w > 8 && d > 8) {
    const n = createNoise(Math.round(x * 7 + z * 13) & 0xffff);
    const unitMat = flatMat(a, 0x9aa0a6, { roughness: 0.6, metalness: 0.5 });
    for (let i = 0; i < 3; i++) {
      const [ux, uz] = at((n.rnd() - 0.5) * (w - 4), (n.rnd() - 0.5) * (d - 4));
      a.decor(new THREE.BoxGeometry(1.6 + n.rnd() * 1.6, 1 + n.rnd(), 1.4 + n.rnd() * 1.4), unitMat, { pos: [ux, base + h + 1.0, uz], rot: [0, rotY, 0] });
    }
  }
  if (collider) a.solid([w, base + h, d], [x, (base + h) / 2, z], { rotY });
}

// ---------------------------------------------------------------------------------------------------------------
// Rocks
// ---------------------------------------------------------------------------------------------------------------
/** Jittered icosahedron boulder with a convex-hull collider. */
export function boulder(a, x, z, r, material, { seed = 1, squash = 0.7, sink = 0.25 } = {}) {
  const geo = new THREE.IcosahedronGeometry(1, 1);
  const n = createNoise(seed);
  const p = geo.attributes.position;
  const seen = new Map();
  for (let i = 0; i < p.count; i++) {
    const key = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    if (!seen.has(key)) seen.set(key, 0.78 + n.rnd() * 0.44);
    const k = seen.get(key);
    p.setXYZ(i, p.getX(i) * k, p.getY(i) * k, p.getZ(i) * k);
  }
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, material);
  mesh.scale.set(r, r * squash, r * (0.85 + n.rnd() * 0.3));
  mesh.position.set(x, r * squash * (1 - sink), z);
  mesh.rotation.y = n.rnd() * 6.28;
  mesh.castShadow = mesh.receiveShadow = true;
  a.add(mesh);
  a.hull(mesh);
  return mesh;
}

// ---------------------------------------------------------------------------------------------------------------
// Struts (cranes, gantries, pylons)
// ---------------------------------------------------------------------------------------------------------------
const _dummy = new THREE.Object3D();
const _strutGeos = new Map();
/** Thin square beam between two world points, batched through Arena.decor. */
export function strut(a, material, p1, p2, thick = 0.25, cast = true) {
  const len = Math.hypot(p2[0] - p1[0], p2[1] - p1[1], p2[2] - p1[2]);
  const key = `${thick.toFixed(3)}:${len.toFixed(2)}`;
  let geo = _strutGeos.get(key);
  if (!geo) _strutGeos.set(key, (geo = new THREE.BoxGeometry(thick, thick, len)));
  _dummy.position.set((p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2, (p1[2] + p2[2]) / 2);
  _dummy.lookAt(p2[0], p2[1], p2[2]);
  a.decor(geo, material, { pos: [_dummy.position.x, _dummy.position.y, _dummy.position.z], rot: [_dummy.rotation.x, _dummy.rotation.y, _dummy.rotation.z], cast });
}

/** Box helper: decor a box at a centre position. */
export function decorBox(a, material, size, pos, rot = [0, 0, 0], cast = true, order = 'XYZ') {
  const key = `box:${size.join(',')}`;
  let geo = _strutGeos.get(key);
  if (!geo) _strutGeos.set(key, (geo = new THREE.BoxGeometry(size[0], size[1], size[2])));
  a.decor(geo, material, { pos, rot, cast, order });
}

/** Unit-cylinder decor (vertical axis), scaled to radius/height. `pos` is the base centre. */
const _cylGeo = new THREE.CylinderGeometry(1, 1, 1, 20);
export function decorCyl(a, material, radius, height, pos, { radiusTop = null, rot = [0, 0, 0], cast = true, order = 'XYZ' } = {}) {
  const geo = radiusTop === null ? _cylGeo : new THREE.CylinderGeometry(radiusTop / radius, 1, 1, 20);
  a.decor(geo, material, { pos: [pos[0], pos[1] + height / 2, pos[2]], rot, scale: [radius, height, radius], cast, order });
}

// ---------------------------------------------------------------------------------------------------------------
// Cliff walls
// ---------------------------------------------------------------------------------------------------------------
/**
 * Perimeter of layered rock slabs (visual) around the arena, backed by the tall invisible collider from
 * Arena.perimeter. `cap` (optional material) puts a snow/dust cap on the slabs. Skips segments where `skip(seg)` is true.
 */
export function cliffWalls(a, { rock, rock2 = rock, cap = null, minH = 8, maxH = 18, seed = 5, chamfer = 18, T = 2.6, tw = 9, skip = null } = {}) {
  const n = createNoise(seed);
  a.perimeter((s) => {
    if (skip?.(s)) return;
    const ux = Math.cos(s.rotY), uz = -Math.sin(s.rotY); // along the wall
    let t = -s.len / 2;
    while (t < s.len / 2 - 1) {
      const w = Math.min(7 + n.rnd() * 10, s.len / 2 - t);
      const tc = t + w / 2;
      const h = minH + Math.pow(n.rnd(), 1.6) * (maxH - minH);
      const depth = 9 + n.rnd() * 6;
      const back = depth / 2 - T / 2;
      const px = s.cx + ux * tc - s.inward[0] * back, pz = s.cz + uz * tc - s.inward[1] * back;
      const m = n.rnd() < 0.5 ? rock : rock2;
      a.decor(boxGeo(w + 0.4, h, depth, { tw, th: tw }), m, { pos: [px, h / 2, pz], rot: [0, s.rotY, 0] });
      // upper bench: a narrower, set-back slab
      const h2 = 2 + n.rnd() * (maxH * 0.35);
      const d2 = depth * (0.55 + n.rnd() * 0.25);
      const b2 = back + (depth - d2) / 2 + 0.6;
      const px2 = s.cx + ux * tc - s.inward[0] * b2, pz2 = s.cz + uz * tc - s.inward[1] * b2;
      a.decor(boxGeo(w * 0.9, h2, d2, { tw, th: tw }), m === rock ? rock2 : rock, { pos: [px2, h + h2 / 2 - 0.05, pz2], rot: [0, s.rotY, 0] });
      if (cap) {
        a.decor(new THREE.BoxGeometry(w + 0.6, 0.5, depth + 0.2), cap, { pos: [px, h + 0.1, pz], rot: [0, s.rotY, 0] });
        a.decor(new THREE.BoxGeometry(w * 0.85 + 0.3, 0.6, d2 + 0.2), cap, { pos: [px2, h + h2 + 0.2, pz2], rot: [0, s.rotY, 0] });
      }
      t += w;
    }
  }, { chamfer, T, colH: 40 });
}

/** Far-off flat-topped mesas / massifs ringed around the arena (single merged draw call per material). */
export function distantRock(a, material, { count = 14, rMin = 360, rMax = 700, hMin = 60, hMax = 140, seed = 9, tw = 60 } = {}) {
  const n = createNoise(seed);
  for (let i = 0; i < count; i++) {
    const ang = (i / count) * Math.PI * 2 + (n.rnd() - 0.5) * 0.25;
    const r = rMin + n.rnd() * (rMax - rMin);
    const x = Math.sin(ang) * r, z = Math.cos(ang) * r;
    const w = 120 + n.rnd() * 160, d = 90 + n.rnd() * 120, h = hMin + n.rnd() * (hMax - hMin);
    const rot = n.rnd() * 3;
    a.decor(boxGeo(w, h, d, { tw, th: tw }), material, { pos: [x, h / 2 - 3, z], rot: [0, rot, 0] });
    a.decor(boxGeo(w * 0.62, h * 0.4, d * 0.6, { tw, th: tw }), material, { pos: [x + 6, h + h * 0.2 - 3.5, z - 4], rot: [0, rot + 0.3, 0] });
  }
}
