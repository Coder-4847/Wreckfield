import * as THREE from 'three';
import { concreteTextures, puddleRoughness, rampTextures, createNoise, billboardTexture } from '../textures.js';
import { memo, markingsTexture, waterNormal } from '../textures2.js';
import { ARENA_HALF as HALF } from '../Arena.js';
import { containerKit, lampKit, building, boxGeo, facadeMat, flatMat, strut, decorBox, decorCyl, CONT } from './kit.js';

// Map 2 — "Harbor Docks": a working container port at dusk. Wet concrete quay, a moored freighter beyond the north quay
// edge, two gantry cranes straddling the waterfront lane, container canyons, an open customs shed, a tank farm with
// leaking oil and a toxic spill, sodium lamps with warm light pools.
// North (−z) is the sea; the other three sides are walled by stacked shipping containers.

const CHAMFER = 18;
const QUAY_Z = -HALF; // waterfront edge
const WATER_Y = -2.4;
const yawFor = (dx, dz) => Math.atan2(-dx, -dz); // vehicle-convention yaw whose forward is (dx, dz)

export const HARBOR = {
  id: 'harbor',
  name: 'HARBOR DOCKS',
  short: 'HARBOR DOCKS',
  blurb: 'Dusk at a container port: crane lanes, stacked canyons, an oil-slick quay and a freighter at anchor.',
  tags: ['CANYONS', 'OIL', 'DUSK'],
  thumb: ['#e8804a', '#53507a', '#2b3038'],
  env: { exposure: 1.05, bloom: [0.4, 0.55, 0.85], envIntensity: 0.9, headlight: 55 },

  build(a) {
    a.sunOffset.set(-120, 26, -50);
    a.lights({ sunColor: 0xff9a5c, sunIntensity: 2.6, hemiSky: 0x7c86b8, hemiGround: 0x3d3540, hemiIntensity: 0.75 });
    a.sky({
      horizon: [1.0, 0.5, 0.28], mid: [0.62, 0.42, 0.58], top: [0.07, 0.11, 0.28], ground: [0.16, 0.16, 0.22],
      sunColor: [1, 0.55, 0.3], sunGlow: 0.55, sunDisc: 10, stars: 0.35, hazeColor: [0.95, 0.5, 0.36], hazeBand: 0.5,
      clouds: { cover: 0.5, lit: [1, 0.6, 0.42], dark: [0.28, 0.24, 0.4], scale: 1.3, speed: 0.005 },
    });
    a.fog(0xb8706a, 0.0026);

    // --- spawns (outer lanes, facing into the yard)
    a.spawn(-63, -50, yawFor(1, 0.2));
    a.spawn(63, -46, yawFor(-1, 0.2));
    a.spawn(-60, 52, yawFor(1, -0.3));
    a.spawn(30, 46, yawFor(-1, -0.4));

    // --- pickups
    for (const [kind, x, z] of [
      ['health', -8, -52], ['health', 8, 48], ['boost', -50, 8], ['boost', 48, -22],
      ['overcharge', 0, 6], ['overcharge', -38, 60],
      ['missile', 34, -64], ['scatter', -22, -34], ['mine', 22, 30], ['laser', -66, 18],
    ]) a.pickup(kind, x, z);

    a.waypointGrid(18, 66);

    this.ground(a);
    this.quayAndSea(a);
    this.walls(a);
    this.yard(a);
    this.shed(a);
    this.tanks(a);
    this.kickers(a);
    this.cranes(a);
    this.lamps(a);
    this.ship(a);
    this.horizon(a);

    a.boostPadsAt([
      { x: -30, z: -66, yaw: yawFor(1, 0) }, { x: 26, z: -66, yaw: yawFor(-1, 0) },
      { x: -6, z: 26, yaw: yawFor(0, -1) }, { x: 38, z: 8, yaw: yawFor(-1, 0) },
    ], { emissive: 0xffb02a, emissiveIntensity: 0.55 });

    a.zone({ x: -48, z: 30, r: 7, style: 'oil' });
    a.zone({ x: 50, z: -30, r: 7.5, style: 'oil' });
    a.zone({ x: 36, z: 56, r: 6, style: 'toxic' });
  },

  ground(a) {
    const conc = memo('harbor:conc', () => concreteTextures(44, [104, 104, 108]));
    conc.map.repeat.set(24, 24);
    conc.normalMap.repeat.set(24, 24);
    const rough = memo('harbor:rough', () => puddleRoughness());
    a.ground(new THREE.MeshStandardMaterial({
      map: conc.map, normalMap: conc.normalMap, normalScale: new THREE.Vector2(0.4, 0.4),
      roughnessMap: rough, roughness: 1, metalness: 0.02, color: 0xd8dbe4,
    }));

    const marks = markingsTexture(HALF, (ctx, m) => {
      const { px, toX, toY } = m;
      // quay-edge safety band
      ctx.save();
      ctx.beginPath(); ctx.rect(toX(-HALF), toY(-HALF + 1.6), HALF * 2 * px, 1.8 * px); ctx.clip();
      ctx.fillStyle = '#e6b31c'; ctx.fillRect(toX(-HALF), toY(-HALF + 1.6), HALF * 2 * px, 1.8 * px);
      ctx.fillStyle = '#1a1a1c';
      for (let x = -HALF - 2; x < HALF + 2; x += 1.6) {
        ctx.beginPath();
        ctx.moveTo(toX(x), toY(-HALF + 1.6)); ctx.lineTo(toX(x + 0.8), toY(-HALF + 1.6));
        ctx.lineTo(toX(x + 0.8 + 1.8), toY(-HALF + 3.4)); ctx.lineTo(toX(x + 1.8), toY(-HALF + 3.4));
        ctx.fill();
      }
      ctx.restore();
      // crane rail lines
      ctx.strokeStyle = 'rgba(70,72,76,0.9)'; ctx.lineWidth = 0.35 * px;
      for (const z of [-72, -58]) { ctx.beginPath(); ctx.moveTo(toX(-HALF), toY(z)); ctx.lineTo(toX(HALF), toY(z)); ctx.stroke(); }
      // dashed lane centre lines
      ctx.strokeStyle = 'rgba(236,236,228,0.85)'; ctx.lineWidth = 0.3 * px;
      ctx.setLineDash([3.2 * px, 3.2 * px]);
      for (const z of [-42, 20, 68]) { ctx.beginPath(); ctx.moveTo(toX(-70), toY(z)); ctx.lineTo(toX(70), toY(z)); ctx.stroke(); }
      for (const x of [-40, 2, 44]) { ctx.beginPath(); ctx.moveTo(toX(x), toY(-40)); ctx.lineTo(toX(x), toY(70)); ctx.stroke(); }
      ctx.setLineDash([]);
      // stacking-area outlines + bay codes
      ctx.strokeStyle = 'rgba(230,180,30,0.9)'; ctx.lineWidth = 0.28 * px;
      ctx.font = `bold ${3.4 * px}px Rajdhani, Arial Narrow, sans-serif`;
      ctx.fillStyle = 'rgba(232,232,224,0.85)';
      [[-26, 10, 'B-12'], [26, -8, 'B-13'], [0, 36, 'C-04'], [0, -30, 'C-05']].forEach(([x, z, t]) => {
        ctx.strokeRect(toX(x - 17), toY(z - 8), 34 * px, 16 * px);
        ctx.save(); ctx.translate(toX(x), toY(z + 11.4)); ctx.textAlign = 'center'; ctx.fillText(t, 0, 0); ctx.restore();
      });
      // spawn brackets
      ctx.strokeStyle = 'rgba(240,240,232,0.9)'; ctx.lineWidth = 0.22 * px;
      for (const [x, z] of [[-63, -50], [63, -46], [-60, 52], [30, 46]]) {
        const s = 4.5;
        for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
          ctx.beginPath();
          ctx.moveTo(toX(x + sx * s), toY(z + sz * (s - 1.6)));
          ctx.lineTo(toX(x + sx * s), toY(z + sz * s));
          ctx.lineTo(toX(x + sx * (s - 1.6)), toY(z + sz * s));
          ctx.stroke();
        }
      }
    }, 'harbor');
    a.markings(marks);

    // outer apron (south / east / west) — the north side is open sea
    const apron = new THREE.Mesh(
      new THREE.PlaneGeometry(1800, 1082),
      new THREE.MeshStandardMaterial({ map: conc.map, normalMap: conc.normalMap, color: 0x8d9098, roughness: 0.95 }),
    );
    apron.rotation.x = -Math.PI / 2;
    apron.position.set(0, -0.03, (QUAY_Z - 2 + 1000) / 2);
    a.add(apron);
    const uv = apron.geometry.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 11, uv.getY(i) * 6.6);
  },

  quayAndSea(a) {
    // quay face (visual only), then the water
    const face = new THREE.Mesh(
      new THREE.BoxGeometry(HALF * 2 + 4, 3.2, 3),
      new THREE.MeshStandardMaterial({ color: 0x5a5c60, roughness: 0.95 }),
    );
    face.position.set(0, -1.5, QUAY_Z - 2.6);
    a.add(face);
    // rubber fenders down the face
    const fender = flatMat(a, 0x111214, { roughness: 0.9 });
    for (let x = -HALF + 4; x < HALF; x += 9) decorBox(a, fender, [1.1, 1.4, 0.5], [x, -0.7, QUAY_Z - 1.0]);

    const nrm = waterNormal();
    nrm.repeat.set(260, 260);
    const water = new THREE.Mesh(
      new THREE.PlaneGeometry(2600, 2600),
      new THREE.MeshStandardMaterial({ color: 0x102a3a, roughness: 0.07, metalness: 0.15, normalMap: nrm, normalScale: new THREE.Vector2(0.55, 0.55), envMapIntensity: 1.6 }),
    );
    water.rotation.x = -Math.PI / 2;
    water.position.y = WATER_Y;
    a.add(water);
    a.animated.push((t) => nrm.offset.set(t * 0.012, t * 0.007));

    // bollards + a low chain rail along the quay edge
    const bol = flatMat(a, 0x1d1f22, { roughness: 0.5, metalness: 0.7 });
    const paint = flatMat(a, 0xe6b31c, { roughness: 0.6 });
    for (let x = -HALF + 6; x < HALF; x += 10) {
      decorCyl(a, bol, 0.42, 0.7, [x, 0, QUAY_Z + 0.6], { radiusTop: 0.3 });
      decorCyl(a, paint, 0.435, 0.06, [x, 0.7, QUAY_Z + 0.6], { radiusTop: 0.435 });
    }
    // ladder recesses + kerb
    decorBox(a, flatMat(a, 0x6b6d70, { roughness: 0.9 }), [HALF * 2, 0.35, 0.7], [0, 0.17, QUAY_Z + 0.35]);
  },

  walls(a) {
    const kit = containerKit(a);
    const n = createNoise(17);
    a.perimeter((s) => {
      // the sea side (north + its two chamfers) is open water — quay edge only
      if (s.index === 0 || s.index === 5 || s.index === 7) return;
      const count = Math.round(s.len / (CONT.L + 0.3));
      const step = s.len / count;
      const dx = Math.cos(s.rotY), dz = -Math.sin(s.rotY);
      for (let i = 0; i < count; i++) {
        const t = (i - (count - 1) / 2) * step;
        const levels = 2 + Math.floor(n.rnd() * 2);
        for (let k = 0; k < levels; k++) kit.place(s.cx + dx * t, k * CONT.H, s.cz + dz * t, s.rotY, { collider: false, idx: Math.floor(n.rnd() * 8) });
      }
    }, { chamfer: CHAMFER, T: 2.6, colH: 30 });
  },

  yard(a) {
    const kit = containerKit(a);
    kit.stack(-26, 10, { nx: 2, nz: 3, levels: 2, seed: 3 });
    kit.stack(26, -8, { nx: 2, nz: 3, levels: 2, seed: 8 });
    kit.stack(0, 36, { nx: 2, nz: 2, levels: 3, rotY: Math.PI / 2, seed: 12 });
    kit.stack(0, -30, { nx: 1, nz: 2, levels: 2, rotY: Math.PI / 2, seed: 21 });
    // scattered loose boxes near the lanes
    kit.place(-58, 0, -14, 0.5, { idx: 5 });
    kit.place(-44, 0, 44, -0.3, { idx: 2 });
    kit.place(60, 0, 8, 1.2, { idx: 7 });

    // dock office + a small warehouse block
    building(a, { x: -66, z: 0, w: 10, d: 18, h: 6, rotY: 0, kind: 'concrete', lit: 0.4, seed: 9, roof: 0x4a4d52 });
    building(a, { x: 12, z: 62, w: 26, d: 10, h: 8, rotY: 0, kind: 'concrete', lit: 0.25, seed: 14, roof: 0x4a4d52 });
    // pallets + drums
    const wood = flatMat(a, 0x8a6a45, { roughness: 0.9 });
    const drumRed = flatMat(a, 0xa33a2a, { roughness: 0.5, metalness: 0.5 });
    const drumBlue = flatMat(a, 0x2b4f8a, { roughness: 0.5, metalness: 0.5 });
    [[-42, 24], [-53, 36]].forEach(([x, z], i) => {
      for (let j = 0; j < 5; j++) {
        const dx = (j % 3) * 0.75, dz = Math.floor(j / 3) * 0.75;
        decorCyl(a, i ? drumBlue : drumRed, 0.3, 0.9, [x + dx, 0, z + dz]);
      }
      a.solid([2.2, 1, 1.6], [x + 0.8, 0.5, z + 0.35]);
    });
    [[54, -38], [44, -22]].forEach(([x, z]) => {
      decorBox(a, wood, [1.8, 0.16, 1.8], [x, 0.09, z]);
      decorBox(a, wood, [1.5, 1.2, 1.5], [x, 0.85, z], [0, 0.3, 0]);
      a.solid([1.9, 1.4, 1.9], [x, 0.75, z], { rotY: 0.3 });
    });
  },

  shed(a) {
    // open customs shed: roof on columns, drive-under
    const cx = 60, cz = 22, w = 16, d = 34, roofY = 6.6;
    const steel = flatMat(a, 0x6a7078, { roughness: 0.55, metalness: 0.7 });
    const roof = flatMat(a, 0x8b9096, { roughness: 0.5, metalness: 0.6 });
    const band = flatMat(a, 0xc4592b, { roughness: 0.6 });
    decorBox(a, roof, [w, 0.5, d], [cx, roofY, cz]);
    decorBox(a, band, [w + 0.1, 0.9, 0.3], [cx, roofY - 0.1, cz - d / 2]);
    decorBox(a, band, [w + 0.1, 0.9, 0.3], [cx, roofY - 0.1, cz + d / 2]);
    // ribs on the roof
    for (let i = -8; i <= 8; i++) decorBox(a, steel, [w, 0.14, 0.14], [cx, roofY + 0.32, cz + i * 2.0]);
    a.solid([w, 0.6, d], [cx, roofY, cz]);
    for (const lx of [-w / 2 + 0.6, w / 2 - 0.6]) {
      for (let i = 0; i < 5; i++) {
        const z = cz - d / 2 + 1.5 + i * ((d - 3) / 4);
        decorBox(a, steel, [0.8, roofY, 0.8], [cx + lx, roofY / 2, z]);
        a.solid([0.8, roofY, 0.8], [cx + lx, roofY / 2, z]);
      }
    }
    // stacked crates under cover
    const crate = flatMat(a, 0x7d6543, { roughness: 0.9 });
    for (const [x, z] of [[cx + 3, cz - 8], [cx - 3, cz + 6]]) {
      decorBox(a, crate, [2.4, 2.2, 2.4], [x, 1.1, z]);
      a.solid([2.4, 2.2, 2.4], [x, 1.1, z]);
    }
  },

  tanks(a) {
    const tankMat = flatMat(a, 0xd9dcdf, { roughness: 0.45, metalness: 0.45 });
    const cap = flatMat(a, 0x8f9499, { roughness: 0.5, metalness: 0.6 });
    const stripe = flatMat(a, 0xc4392b, { roughness: 0.5 });
    const rail = flatMat(a, 0x45484d, { roughness: 0.5, metalness: 0.7 });
    [[62, 56, 6.5], [46, 66, 5.5], [64, 38, 5]].forEach(([x, z, r]) => {
      const h = 9;
      decorCyl(a, tankMat, r, h, [x, 0, z]);
      decorCyl(a, cap, r * 1.03, 0.35, [x, h, z]);
      decorCyl(a, stripe, r * 1.01, 0.9, [x, h * 0.55, z]);
      // catwalk ring + ladder + pipe stub
      decorCyl(a, rail, r * 1.06, 0.12, [x, h + 0.35, z]);
      decorBox(a, rail, [0.3, h + 0.6, 0.3], [x + r * 0.95, (h + 0.6) / 2, z]);
      decorCyl(a, rail, 0.35, 5, [x - r - 0.4, 0, z], { rot: [0, 0, 0] });
      a.solidCyl(r, h, [x, 0, z]);
    });
    // pipe rack
    const pipe = flatMat(a, 0x8a6f2a, { roughness: 0.5, metalness: 0.5 });
    for (let i = 0; i < 3; i++) decorBox(a, pipe, [0.5, 0.5, 20], [55.5 + i * 0.7, 3.2, 52], [0, 0, 0]);
    for (const z of [42, 52, 62]) { decorBox(a, rail, [0.4, 3.2, 0.4], [55.5, 1.6, z]); decorBox(a, rail, [0.4, 3.2, 0.4], [57.6, 1.6, z]); }
    a.solid([3, 3.6, 20], [56.5, 1.8, 52]);
  },

  kickers(a) {
    const rt = memo('yard:ramp', () => rampTextures());
    const mat = new THREE.MeshStandardMaterial({ map: rt.map, normalMap: rt.normalMap, roughness: 0.5, metalness: 0.7, color: 0xd8c8b0 });
    const side = new THREE.MeshStandardMaterial({ color: 0x555860, roughness: 0.6, metalness: 0.6 });
    const strip = new THREE.MeshStandardMaterial({ color: 0xe6b31c, roughness: 0.6 });
    const H = 1.9, L = 9, W = 8;
    for (const [x, z, dx, dz] of [[-56, -24, 1, 0], [30, -50, -1, 0.15], [-8, 56, 0, -1], [70, -6, -1, 0]]) {
      const ramp = a.ramp(W, H, L, x, z, yawFor(dx, dz), [mat, side]);
      const lip = new THREE.Mesh(new THREE.BoxGeometry(W, 0.1, 0.14), strip);
      lip.position.set(0, H + 0.02, -L / 2);
      ramp.add(lip);
    }
  },

  /** Two quay-side gantry cranes: legs are solid, cars drive between them along the waterfront. */
  cranes(a) {
    const crane = (cx, color) => {
      const paint = flatMat(a, color, { roughness: 0.55, metalness: 0.4 });
      const dark = flatMat(a, 0x35393e, { roughness: 0.55, metalness: 0.6 });
      const H = 30, zs = [-72, -58];
      for (const lx of [-7, 7]) for (const z of zs) {
        decorBox(a, paint, [1.3, H, 1.3], [cx + lx, H / 2, z]);
        decorBox(a, dark, [1.9, 0.8, 1.9], [cx + lx, 0.4, z]);
        a.solid([1.3, H, 1.3], [cx + lx, H / 2, z]);
      }
      // portal bracing
      for (const y of [9, 19]) {
        for (const z of zs) decorBox(a, paint, [14, 0.7, 0.7], [cx, y, z]);
        for (const lx of [-7, 7]) decorBox(a, paint, [0.7, 0.7, 14], [cx + lx, y, -65]);
      }
      for (const z of zs) {
        strut(a, dark, [cx - 7, 0.8, z], [cx + 7, 19, z], 0.32);
        strut(a, dark, [cx + 7, 0.8, z], [cx - 7, 19, z], 0.32);
      }
      for (const lx of [-7, 7]) {
        strut(a, dark, [cx + lx, 0.8, -72], [cx + lx, 19, -58], 0.32);
        strut(a, dark, [cx + lx, 0.8, -58], [cx + lx, 19, -72], 0.32);
      }
      // top frame + machinery house
      for (const z of zs) decorBox(a, paint, [15, 1.4, 1.4], [cx, H, z]);
      for (const lx of [-7, 7]) decorBox(a, paint, [1.4, 1.4, 15], [cx + lx, H, -65]);
      decorBox(a, paint, [9, 4.4, 8], [cx, H + 2.9, -62]);
      decorBox(a, dark, [9.2, 0.5, 8.2], [cx, H + 5.3, -62]);
      // boom (twin girders) out over the water + back-reach, lattice diagonals
      const z0 = -50, z1 = -128, by = H + 3.4;
      for (const gx of [-1.6, 1.6]) {
        decorBox(a, paint, [0.8, 1.2, z0 - z1], [cx + gx, by, (z0 + z1) / 2]);
        for (let z = z1; z < z0 - 4; z += 5.2) {
          strut(a, dark, [cx + gx, by - 0.5, z], [cx + gx, by + 0.5, z + 2.6], 0.22);
          strut(a, dark, [cx + gx, by + 0.5, z + 2.6], [cx + gx, by - 0.5, z + 5.2], 0.22);
        }
      }
      for (let z = z1 + 2; z < z0; z += 6) decorBox(a, paint, [3.2, 0.4, 0.4], [cx, by, z]);
      // A-frame + stays
      const tz = -62, ty = H + 22;
      strut(a, paint, [cx - 3, H + 3, tz - 3], [cx, ty, tz], 0.8);
      strut(a, paint, [cx + 3, H + 3, tz - 3], [cx, ty, tz], 0.8);
      strut(a, paint, [cx - 3, H + 3, tz + 3], [cx, ty, tz], 0.8);
      strut(a, paint, [cx + 3, H + 3, tz + 3], [cx, ty, tz], 0.8);
      strut(a, dark, [cx, ty, tz], [cx, by + 0.6, z1 + 4], 0.16);
      strut(a, dark, [cx, ty, tz], [cx, by + 0.6, z0 + 2], 0.16);
      // trolley, hoist ropes and a hanging container
      const trz = -104;
      decorBox(a, dark, [4.2, 1.6, 4.6], [cx, by - 1.3, trz]);
      const spY = 12;
      strut(a, dark, [cx - 1.6, by - 2.1, trz - 1.8], [cx - 2, spY + 3, trz - 2.4], 0.07);
      strut(a, dark, [cx + 1.6, by - 2.1, trz + 1.8], [cx + 2, spY + 3, trz + 2.4], 0.07);
      decorBox(a, dark, [3.4, 0.5, 12.4], [cx, spY + 2.9, trz]);
      const boxColor = flatMat(a, 0x2c6a72, { roughness: 0.55, metalness: 0.5 });
      decorBox(a, boxColor, [2.44, 2.6, 12.2], [cx, spY + 1.3, trz]);
      // beacon
      const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.4, 10, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 0.2, 0.1), toneMapped: false }));
      beacon.position.set(cx, ty + 1.2, tz);
      a.add(beacon);
      const off = cx * 0.13;
      a.animated.push((t) => beacon.scale.setScalar(Math.sin(t * 3 + off) > 0.3 ? 1 : 0.2));
    };
    crane(-38, 0xc4492a);
    crane(34, 0x8fa3b3);
  },

  lamps(a) {
    const lamp = lampKit(a, { color: 0xffb870, poolTint: 0xff9a4a, poolOpacity: 0.55 });
    const put = (x, z, rotY) => lamp(x, z, { h: 9.5, arm: 2.0, rotY, poolR: 10 });
    // waterfront row
    for (const x of [-64, -16, 4, 60]) put(x, -76.8, Math.PI);
    // along the lanes
    [[-10, -41], [-10, 20.5], [40, 20.5], [-40, 68.5], [30, 68.5], [3, -18], [-30, 40], [46, -12], [-56, -6]].forEach(([x, z], i) => put(x, z, (i % 2) * Math.PI));
    // lamp poles that clear the container walls
    for (const [x, z, r] of [[-74, 20, Math.PI / 2], [74, -24, -Math.PI / 2], [-74, -30, Math.PI / 2]]) put(x, z, r);
  },

  /** Freighter moored beyond the quay edge, deck loaded with containers, lit accommodation block. */
  ship(a) {
    const zc = -112, deckY = 13;
    const hullLow = flatMat(a, 0x8c2b25, { roughness: 0.6, metalness: 0.2 });
    const hullHi = flatMat(a, 0x1c2430, { roughness: 0.55, metalness: 0.3 });
    const shape = new THREE.Shape();
    const pts = [[-104, -16], [72, -16], [96, -9], [112, 0], [96, 9], [72, 16], [-104, 16]];
    pts.forEach(([x, y], i) => (i ? shape.lineTo(x, y) : shape.moveTo(x, y)));
    shape.closePath();
    const mk = (depth, y0, material) => {
      const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
      geo.rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(geo, material);
      m.position.set(0, y0, zc);
      m.castShadow = m.receiveShadow = true;
      a.add(m);
    };
    mk(2.5 - (WATER_Y - 6), WATER_Y - 6, hullLow); // antifouling red up to the boot-top
    mk(deckY - 2.5, 2.5, hullHi);
    decorBox(a, flatMat(a, 0x9aa0a8, { roughness: 0.6, metalness: 0.4 }), [190, 0.7, 0.5], [-8, deckY + 0.3, zc + 16.1]);
    // hull-side white draught / name band
    decorBox(a, flatMat(a, 0xe8e6de, { roughness: 0.6 }), [120, 1.2, 0.2], [-30, 3.5, zc + 16.02]);
    // container load
    const kit = containerKit(a);
    const n = createNoise(77);
    for (let bay = 0; bay < 11; bay++) {
      const x = -76 + bay * 12.6;
      for (let row = 0; row < 9; row++) {
        const levels = 2 + Math.floor(n.rnd() * 3);
        for (let k = 0; k < levels; k++) kit.place(x, deckY + k * CONT.H, zc - 11 + row * 2.75, 0, { collider: false, idx: Math.floor(n.rnd() * 8) });
      }
    }
    // accommodation tower at the stern + funnel
    const fm = facadeMat(a, 'concrete', 0.55, 6, 1.3);
    const towerX = -96;
    for (let i = 0; i < 4; i++) {
      const w = 20 - i * 1.5;
      a.decor(boxGeo(w, 4.4, 26 - i * 1.5, { tw: 8, th: 4.4 }), i % 2 ? fm : flatMat(a, 0xf0efe8, { roughness: 0.5 }), { pos: [towerX, deckY + 2.2 + i * 4.4, zc] });
    }
    a.decor(boxGeo(6, 3.4, 30, { tw: 8, th: 4.4 }), fm, { pos: [towerX, deckY + 19.3, zc] });
    decorCyl(a, flatMat(a, 0xc4392b, { roughness: 0.5 }), 3.6, 10, [towerX + 8, deckY + 16, zc], { radiusTop: 3.0 });
    decorCyl(a, flatMat(a, 0x141516, { roughness: 0.7 }), 3.02, 1.2, [towerX + 8, deckY + 26, zc], { radiusTop: 3.02 });
    // deck cranes
    const cr = flatMat(a, 0xd8d5c8, { roughness: 0.6, metalness: 0.3 });
    for (const x of [-40, 20]) {
      decorBox(a, cr, [1.5, 16, 1.5], [x, deckY + 8, zc + 13.5]);
      decorBox(a, cr, [1.2, 1.2, 26], [x, deckY + 16, zc + 2]);
    }
    // bow lamp + mast
    decorBox(a, cr, [0.6, 20, 0.6], [30, deckY + 10, zc]);
    const mast = new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 3, 0.4), toneMapped: false }));
    mast.position.set(30, deckY + 21, zc);
    a.add(mast);
  },

  /** Far shore (north across the water) + a port town to the south, rendered as lit facade blocks in the dusk haze. */
  horizon(a) {
    const n = createNoise(303);
    const fm = facadeMat(a, 'glass', 0.3, 4, 0.85);
    const gm = facadeMat(a, 'glass', 0.38, 8, 0.9);
    const dark = flatMat(a, 0x1b2030, { roughness: 1 });
    // southern town
    for (let i = 0; i < 46; i++) {
      const x = -520 + (i / 45) * 1040 + (n.rnd() - 0.5) * 12;
      const z = 330 + n.rnd() * 160;
      const w = 22 + n.rnd() * 40, d = 20 + n.rnd() * 30, h = 20 + n.rnd() * 90 * (0.4 + n.rnd());
      a.decor(boxGeo(w, h, d, { tw: 14, th: 20 }), n.rnd() < 0.5 ? gm : fm, { pos: [x, h / 2 - 1, z] });
    }
    // northern far shore: low silhouette hills with sparse lights
    for (let i = 0; i < 12; i++) {
      const x = -600 + (i / 11) * 1200;
      const h = 30 + n.rnd() * 50;
      const hill = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2), dark);
      hill.scale.set(150 + n.rnd() * 120, h, 90);
      hill.position.set(x, WATER_Y - 2, -620 - n.rnd() * 60);
      a.add(hill);
    }
    // west / east: warehouses
    for (const sx of [-1, 1]) {
      for (let i = 0; i < 12; i++) {
        const z = -80 + i * 55 + n.rnd() * 10;
        const w = 40 + n.rnd() * 40, d = 30 + n.rnd() * 30, h = 14 + n.rnd() * 26;
        a.decor(boxGeo(w, h, d), fm, { pos: [sx * (300 + n.rnd() * 60), h / 2 - 1, z] });
      }
    }
    // billboard on the customs side
    const frame = flatMat(a, 0x2a2d31, { roughness: 0.6, metalness: 0.6 });
    const g = new THREE.Group();
    g.position.set(0, 0, HALF + 7);
    g.rotation.y = Math.PI;
    a.add(g);
    const board = new THREE.Mesh(new THREE.BoxGeometry(34, 8.5, 0.6), frame);
    board.position.y = 14;
    g.add(board);
    for (const x of [-12, 12]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.8, 14, 0.8), frame);
      post.position.set(x, 7, 0.8);
      g.add(post);
    }
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(32.6, 8.1), new THREE.MeshStandardMaterial({ map: billboardTexture('HARBOR DOCKS', 'BERTH 9 · AUTHORIZED PERSONNEL · HI-VIS REQUIRED', '#122334', '#f0b23a'), roughness: 0.6, emissive: new THREE.Color(0.5, 0.5, 0.5), emissiveIntensity: 0.6 }));
    sign.material.emissiveMap = sign.material.map;
    sign.position.set(0, 14, 0.32);
    g.add(sign);
  },
};
