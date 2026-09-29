import * as THREE from 'three';
import { rampTextures, createNoise, billboardTexture } from '../textures.js';
import { memo, markingsTexture, sandTextures, rockTextures, dirtTextures } from '../textures2.js';
import { ARENA_HALF as HALF } from '../Arena.js';
import { flatMat, strut, decorBox, decorCyl, boulder, cliffWalls, distantRock, boxGeo } from './kit.js';

// Map 3 — "Desert Quarry": an open-pit sandstone quarry at high noon. Blinding sun, layered cliff walls, a central mesa
// with ramps, a crusher plant with a conveyor and stockpile, parked excavator + haul trucks, boulder slaloms,
// loose-sand patches (slow) and two toxic tailings ponds. Dust drifts across the pit.

const yawFor = (dx, dz) => Math.atan2(-dx, -dz);
const YELLOW = 0xd9a21b;

export const QUARRY = {
  id: 'quarry',
  name: 'DESERT QUARRY',
  short: 'DESERT QUARRY',
  blurb: 'High-noon sandstone pit: central mesa, crusher plant, boulder slaloms and slow sand.',
  tags: ['OFF-ROAD', 'SAND', 'DAY'],
  thumb: ['#8fc4ee', '#f0d29a', '#c99560'],
  env: { exposure: 0.95, bloom: [0.16, 0.4, 1.05], envIntensity: 0.9, headlight: 20 },

  build(a) {
    a.sunOffset.set(-40, 105, 35);
    a.lights({ sunColor: 0xfff0d8, sunIntensity: 4.0, hemiSky: 0xbcd8ff, hemiGround: 0x9b7d5a, hemiIntensity: 0.95 });
    a.sky({
      horizon: [0.9, 0.84, 0.72], mid: [0.5, 0.7, 0.92], top: [0.17, 0.42, 0.82], ground: [0.7, 0.58, 0.42],
      sunColor: [1, 0.95, 0.8], sunGlow: 0.18, sunDisc: 14, hazeColor: [0.92, 0.82, 0.66], hazeBand: 0.6,
      clouds: { cover: 0.28, lit: [1, 0.98, 0.94], dark: [0.72, 0.76, 0.86], scale: 1.4, speed: 0.008 },
    });
    a.fog(0xe1c9a6, 0.0019);
    a.weatherLayer('dust', { count: 240, wind: [5, 0.4, 1.5] });

    a.spawn(-60, -58, yawFor(1, 0.6));
    a.spawn(60, -56, yawFor(-1, 0.6));
    a.spawn(-58, 58, yawFor(1, -0.6));
    a.spawn(60, 56, yawFor(-1, -0.6));

    for (const [kind, x, z] of [
      ['health', 0, -34], ['health', 0, 34], ['boost', -30, -8], ['boost', 30, 12],
      ['overcharge', -34, 20], ['overcharge', 26, -36],
      ['missile', 8, 58], ['scatter', -56, 36], ['mine', 46, 6], ['laser', -14, -62],
    ]) a.pickup(kind, x, z);

    a.waypointGrid(18, 66);

    this.ground(a);
    cliffWalls(a, {
      rock: memo('quarry:cliffA', () => this.rockMat(a, [214, 164, 116], 14)),
      rock2: memo('quarry:cliffB', () => this.rockMat(a, [188, 140, 100], 27)),
      cap: new THREE.MeshStandardMaterial({ color: 0xd8bf94, roughness: 1 }),
      minH: 9, maxH: 19, seed: 21,
    });
    this.mesa(a);
    this.bench(a);
    this.crusher(a);
    this.machines(a);
    this.boulders(a);
    this.kickers(a);
    this.signage(a);
    this.horizon(a);

    a.boostPadsAt([
      { x: -40, z: -30, yaw: yawFor(0, 1) }, { x: 40, z: 30, yaw: yawFor(0, -1) },
      { x: 22, z: -52, yaw: yawFor(-1, 0) }, { x: -22, z: 52, yaw: yawFor(1, 0) },
    ], { emissive: 0xffb02a, emissiveIntensity: 0.45 });

    a.zone({ x: -38, z: -8, r: 10, style: 'sand' });
    a.zone({ x: 28, z: 24, r: 11, style: 'sand' });
    a.zone({ x: -10, z: -50, r: 9, style: 'sand' });
    a.zone({ x: 50, z: 0, r: 8, style: 'toxic' });
    a.zone({ x: -46, z: 42, r: 7.5, style: 'toxic' });
  },

  /** Cliff / boulder material: banded sandstone with a shared UV-scaled albedo + normal. */
  rockMat(a, tint, seed) {
    const t = rockTextures(tint, seed);
    return new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normalMap, normalScale: new THREE.Vector2(0.9, 0.9), roughness: 0.95 });
  },

  ground(a) {
    const sand = sandTextures();
    const gMap = sand.map.clone(), gNrm = sand.normalMap.clone();
    gMap.repeat.set(26, 26); gNrm.repeat.set(26, 26);
    gMap.needsUpdate = gNrm.needsUpdate = true;
    a.ground(new THREE.MeshStandardMaterial({ map: gMap, normalMap: gNrm, normalScale: new THREE.Vector2(0.6, 0.6), roughness: 0.96, color: 0xf2e6d2 }));

    const marks = markingsTexture(HALF, (ctx, m) => {
      const { px, toX, toY } = m;
      const n = createNoise(4);
      // packed haul road around the mesa: soft dark band + two tyre-rut lines
      const road = (pts, wMeters) => {
        ctx.lineJoin = 'round'; ctx.lineCap = 'round';
        for (const [w, alpha] of [[wMeters, 0.14], [wMeters * 0.8, 0.16], [wMeters * 0.6, 0.2]]) {
          ctx.strokeStyle = `rgba(96,70,44,${alpha})`; ctx.lineWidth = w * px;
          ctx.beginPath(); pts.forEach(([x, z], i) => (i ? ctx.lineTo(toX(x), toY(z)) : ctx.moveTo(toX(x), toY(z)))); ctx.stroke();
        }
        for (const off of [-1.3, 1.3]) {
          ctx.strokeStyle = 'rgba(70,50,32,0.32)'; ctx.lineWidth = 0.55 * px;
          ctx.beginPath();
          pts.forEach(([x, z], i) => { const j = pts[i + 1] ?? pts[i - 1]; const dx = j[0] - x, dz = j[1] - z, l = Math.hypot(dx, dz) || 1; const ox = (-dz / l) * off * (pts[i + 1] ? 1 : -1), oz = (dx / l) * off * (pts[i + 1] ? 1 : -1); (i ? ctx.lineTo : ctx.moveTo).call(ctx, toX(x + ox), toY(z + oz)); });
          ctx.stroke();
        }
      };
      const loop = [];
      for (let i = 0; i <= 48; i++) { const t = (i / 48) * Math.PI * 2; loop.push([Math.sin(t) * 44 + Math.sin(t * 3) * 3, Math.cos(t) * 40 + Math.cos(t * 2) * 3]); }
      road(loop, 11);
      road([[-70, -58], [-44, -44], [-30, -30]], 8);
      road([[70, 56], [44, 44], [30, 30]], 8);
      road([[-30, 46], [-8, 60], [20, 64], [58, 60]], 8);
      // scuffed dark patches + scattered pebbles
      for (let i = 0; i < 220; i++) {
        ctx.fillStyle = `rgba(90,64,40,${0.05 + n.rnd() * 0.08})`;
        ctx.beginPath(); ctx.ellipse(toX((n.rnd() - 0.5) * 156), toY((n.rnd() - 0.5) * 156), (1 + n.rnd() * 3.2) * px, (0.6 + n.rnd() * 1.6) * px, n.rnd() * 3, 0, 7); ctx.fill();
      }
      // spawn scrapes
      ctx.fillStyle = 'rgba(80,58,36,0.16)';
      for (const [x, z] of [[-60, -58], [60, -56], [-58, 58], [60, 56]]) ctx.fillRect(toX(x - 5), toY(z - 5), 10 * px, 10 * px);
      // painted hazard-line by the excavator + fuel dump
      ctx.strokeStyle = 'rgba(230,180,40,0.75)'; ctx.lineWidth = 0.35 * px; ctx.setLineDash([2.5 * px, 1.6 * px]);
      ctx.strokeRect(toX(-52), toY(-40), 14 * px, 12 * px);
      ctx.setLineDash([]);
    }, 'quarry');
    a.markings(marks);

    const dirt = dirtTextures([176, 138, 96], 55);
    dirt.map.repeat.set(120, 120);
    dirt.normalMap.repeat.set(120, 120);
    a.outerGround(new THREE.MeshStandardMaterial({ map: dirt.map, normalMap: dirt.normalMap, roughness: 1, color: 0xd6b88e }));
  },

  /** Central mesa: sandstone plinth with a ramp on each end (cars can cross over the top). */
  mesa(a) {
    const rock = memo('quarry:cliffA', () => this.rockMat(a, [214, 164, 116], 14));
    const top = new THREE.MeshStandardMaterial({ color: 0xd5b483, roughness: 1 });
    const H = 3.6, half = 11;
    a.decor(boxGeo(half * 2, H, half * 2, { tw: 8, th: 8 }), rock, { pos: [0, H / 2, 0] });
    a.decor(new THREE.BoxGeometry(half * 2 + 0.2, 0.15, half * 2 + 0.2), top, { pos: [0, H + 0.02, 0], cast: false });
    a.solid([half * 2, H, half * 2], [0, H / 2, 0]);
    const rt = memo('quarry:ramp', () => {
      const t = sandTextures();
      return { map: t.map, normalMap: t.normalMap };
    });
    const dirtRamp = new THREE.MeshStandardMaterial({ map: rt.map, normalMap: rt.normalMap, roughness: 1, color: 0xd9b98a });
    for (const sx of [-1, 1]) a.ramp(10, H, 12, sx * (half + 6), 0, yawFor(-sx, 0), [dirtRamp, rock]);
    // survey tripod + drill rig on top
    const steel = flatMat(a, 0x5b5f64, { roughness: 0.5, metalness: 0.7 });
    const yel = flatMat(a, YELLOW, { roughness: 0.55, metalness: 0.3 });
    decorBox(a, yel, [3, 1.4, 2.4], [-4, H + 0.7, 3]);
    decorBox(a, steel, [0.5, 7, 0.5], [-4, H + 4.9, 3.6]);
    strut(a, steel, [-4.8, H + 0.6, 2], [-4, H + 6.4, 3.6], 0.2);
    strut(a, steel, [-3.2, H + 0.6, 2], [-4, H + 6.4, 3.6], 0.2);
    for (let i = 0; i < 6; i++) decorCyl(a, flatMat(a, 0xc44a2b, { roughness: 0.6, metalness: 0.4 }), 0.42, 1.1, [4 + (i % 3) * 0.95, H + 0.15, -4 + Math.floor(i / 3) * 0.95]);
  },

  /** Terraced bench on the west side with a dirt ramp. */
  bench(a) {
    const rock = memo('quarry:cliffB', () => this.rockMat(a, [188, 140, 100], 27));
    const H = 2.4;
    a.decor(boxGeo(14, H, 24, { tw: 8, th: 8 }), rock, { pos: [-62, H / 2, -4] });
    a.decor(new THREE.BoxGeometry(14.2, 0.15, 24.2), new THREE.MeshStandardMaterial({ color: 0xcdaa78, roughness: 1 }), { pos: [-62, H + 0.02, -4], cast: false });
    a.solid([14, H, 24], [-62, H / 2, -4]);
    const t = sandTextures();
    const dirtRamp = new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normalMap, roughness: 1, color: 0xd9b98a });
    a.ramp(9, H, 12, -49, -4, yawFor(-1, 0), [dirtRamp, rock]);
  },

  crusher(a) {
    const steel = flatMat(a, 0x5c6168, { roughness: 0.5, metalness: 0.7 });
    const yel = flatMat(a, YELLOW, { roughness: 0.55, metalness: 0.3 });
    const dark = flatMat(a, 0x2a2c30, { roughness: 0.6, metalness: 0.5 });
    const belt = flatMat(a, 0x1b1c1e, { roughness: 0.9 });
    const x = 46, z = -38;
    // plant body + hopper
    decorBox(a, steel, [10, 6, 8], [x, 3, z]);
    a.solid([10, 6, 8], [x, 3, z]);
    decorBox(a, yel, [10.2, 0.5, 8.2], [x, 6.2, z]);
    decorCyl(a, steel, 5.6, 4.5, [x, 6.2, z + 0.2], { radiusTop: 2.8 });
    for (const [lx, lz] of [[-4.6, -3.6], [4.6, -3.6], [-4.6, 3.6], [4.6, 3.6]]) decorBox(a, yel, [0.4, 6, 0.4], [x + lx, 3, z + lz]);
    decorBox(a, dark, [3, 3.4, 2.6], [x - 6.5, 1.7, z + 3]); // control cabin
    a.solid([3, 3.4, 2.6], [x - 6.5, 1.7, z + 3]);
    // inclined conveyor to the stockpile (toward -z)
    const z1 = z - 26, y1 = 15;
    for (const off of [-1, 1]) strut(a, steel, [x + off, 5.6, z - 4], [x + off, y1, z1], 0.35);
    strut(a, belt, [x, 5.9, z - 4], [x, y1 + 0.2, z1], 0.5);
    for (let i = 1; i <= 4; i++) {
      const t = i / 4.4;
      const py = 5.6 + (y1 - 5.6) * t, pz = z - 4 + (z1 - z + 4) * t;
      decorBox(a, yel, [3.2, 0.3, 0.3], [x, py - 0.3, pz]);
      for (const off of [-1.5, 1.5]) {
        decorBox(a, yel, [0.36, py, 0.36], [x + off, py / 2, pz]);
        a.solid([0.36, py, 0.36], [x + off, py / 2, pz]);
      }
    }
    // stockpile under the discharge
    const heap = new THREE.Mesh(new THREE.ConeGeometry(9, 8, 14, 1), new THREE.MeshStandardMaterial({ color: 0xc9a672, roughness: 1, flatShading: true }));
    heap.position.set(x, 4, z1 - 3);
    heap.castShadow = heap.receiveShadow = true;
    a.add(heap);
    a.hull(heap);
    // fuel tank + drums by the plant
    decorCyl(a, flatMat(a, 0xdedcd4, { roughness: 0.5, metalness: 0.3 }), 1.4, 4.4, [x + 9, 0, z + 2], { rot: [0, 0, 0] });
    a.solidCyl(1.4, 4.4, [x + 9, 0, z + 2]);
  },

  machines(a) {
    const yel = flatMat(a, YELLOW, { roughness: 0.55, metalness: 0.3 });
    const dark = flatMat(a, 0x26282b, { roughness: 0.8, metalness: 0.3 });
    const tire = flatMat(a, 0x111213, { roughness: 0.95 });
    const steel = flatMat(a, 0x686d73, { roughness: 0.5, metalness: 0.7 });
    const glass = flatMat(a, 0x16222c, { roughness: 0.15, metalness: 0.6 });
    const world = (x, z, rotY, lx, lz) => [x + lx * Math.cos(rotY) + lz * Math.sin(rotY), z - lx * Math.sin(rotY) + lz * Math.cos(rotY)];

    // excavator
    {
      const x = -46, z = -34, r = 0.6;
      for (const s of [-1, 1]) {
        const [tx, tz] = world(x, z, r, 0, s * 2.4);
        decorBox(a, dark, [9, 1.5, 2.2], [tx, 0.75, tz], [0, r, 0]);
      }
      const [bx, bz] = world(x, z, r, -0.6, 0);
      decorBox(a, yel, [6.4, 1.8, 5.6], [bx, 2.4, bz], [0, r, 0]);
      const [cx, cz] = world(x, z, r, 2.0, 1.4);
      decorBox(a, yel, [2.6, 2.6, 2.4], [cx, 4.4, cz], [0, r, 0]);
      const [gx, gz] = world(x, z, r, 3.32, 1.4);
      decorBox(a, glass, [0.1, 1.7, 2.0], [gx, 4.6, gz], [0, r, 0]);
      const [wx, wz] = world(x, z, r, -3.6, 0);
      decorBox(a, dark, [1.8, 2.0, 5], [wx, 2.9, wz], [0, r, 0]);
      // boom + stick + bucket
      const P = (lx, ly, lz) => { const [px, pz] = world(x, z, r, lx, lz); return [px, ly, pz]; };
      strut(a, yel, P(2.4, 3.4, -1.2), P(8, 8, -1.2), 0.75);
      strut(a, yel, P(8, 8, -1.2), P(11.6, 3.0, -1.2), 0.6);
      strut(a, steel, P(11.6, 3.0, -1.2), P(12.6, 0.8, -1.2), 0.9);
      a.solid([9, 3.4, 5.6], [x, 1.7, z], { rotY: r });
    }

    // haul trucks
    for (const [x, z, r] of [[-32, 44, 0.5], [40, 46, -0.4]]) {
      const P = (lx, ly, lz) => { const [px, pz] = world(x, z, r, lx, lz); return [px, ly, pz]; };
      for (const lx of [-3.4, 3.6]) for (const s of [-1, 1]) {
        const [wx, wz] = world(x, z, r, lx, s * 3.5);
        decorCyl(a, tire, 1.9, 1.5, [wx, 1.15, wz], { rot: [Math.PI / 2, r, 0], order: 'YXZ' });
      }
      const chassis = P(0, 2.6, 0);
      decorBox(a, dark, [9.4, 1.0, 4.4], chassis, [0, r, 0]);
      const bed = P(-0.6, 4.6, 0);
      decorBox(a, yel, [8.2, 2.4, 5.8], bed, [0, r, 0.05], true, 'XYZ');
      const lip = P(3.4, 6.0, 0);
      decorBox(a, yel, [2.4, 1.0, 6.0], lip, [0, r, 0]);
      const cab = P(4.4, 4.0, 2.6);
      decorBox(a, yel, [3.0, 2.4, 1.8], cab, [0, r, 0]);
      const wind = P(5.95, 4.3, 2.6);
      decorBox(a, glass, [0.1, 1.2, 1.5], wind, [0, r, 0]);
      a.solid([9.6, 6, 6.4], [x, 3, z], { rotY: r });
    }
  },

  boulders(a) {
    const mats = [
      memo('quarry:bA', () => this.rockMat(a, [196, 148, 108], 33)),
      memo('quarry:bB', () => this.rockMat(a, [168, 124, 92], 41)),
    ];
    const list = [
      [-20, -22, 2.4], [-14, -30, 1.8], [-26, -16, 1.5], [18, -20, 2.6], [24, -26, 1.7], [10, 22, 2.2], [-6, 26, 3.0], [-22, 30, 1.6],
      [38, 14, 2.4], [56, 22, 1.9], [-54, -18, 2.2], [-40, 20, 2.0], [30, -50, 3.0], [-44, -58, 2.6], [12, -62, 2.2], [-18, 62, 2.6],
      [50, -18, 1.6], [66, 6, 2.4], [-68, 30, 2.8], [4, 46, 1.7],
    ];
    list.forEach(([x, z, r], i) => boulder(a, x, z, r, mats[i % 2], { seed: 100 + i, squash: 0.62 + (i % 3) * 0.1 }));
  },

  kickers(a) {
    const rock = memo('quarry:cliffB', () => this.rockMat(a, [188, 140, 100], 27));
    const t = sandTextures();
    const dirt = new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normalMap, roughness: 1, color: 0xd0ac7a });
    for (const [x, z, dx, dz] of [[34, -6, 1, 0], [-8, -30, 0, 1], [8, 34, 0, -1], [-30, 40, -1, 0]]) a.ramp(8, 2.0, 9, x, z, yawFor(dx, dz), [dirt, rock]);
  },

  signage(a) {
    const frame = flatMat(a, 0x3d3a34, { roughness: 0.7, metalness: 0.4 });
    const g = new THREE.Group();
    g.position.set(0, 0, -(HALF + 6));
    a.add(g);
    const board = new THREE.Mesh(new THREE.BoxGeometry(30, 7.5, 0.6), frame);
    board.position.y = 13;
    g.add(board);
    for (const x of [-11, 11]) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.8, 13, 0.8), frame);
      p.position.set(x, 6.5, -0.8);
      g.add(p);
    }
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(28.6, 7.1), new THREE.MeshStandardMaterial({ map: billboardTexture('DESERT QUARRY', 'BLASTING IN PROGRESS · HARD HATS BEYOND THIS POINT', '#e0c58f', '#3b2a18'), roughness: 0.7 }));
    sign.position.set(0, 13, 0.32);
    g.add(sign);
    // blast warning stakes with pennant lines around the pit
    const stake = flatMat(a, 0xd6b22c, { roughness: 0.6 });
    for (let i = 0; i < 16; i++) {
      const ang = (i / 16) * Math.PI * 2;
      decorBox(a, stake, [0.16, 1.5, 0.16], [Math.sin(ang) * 30, 0.75, Math.cos(ang) * 30], [0, ang, 0], false);
    }
  },

  horizon(a) {
    const mesaRock = memo('quarry:far', () => {
      const t = rockTextures([200, 148, 106], 63);
      return new THREE.MeshStandardMaterial({ map: t.map, roughness: 1 });
    });
    distantRock(a, mesaRock, { count: 16, rMin: 380, rMax: 720, hMin: 70, hMax: 160, seed: 12, tw: 70 });
  },
};
