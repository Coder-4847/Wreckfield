import * as THREE from 'three';
import { createNoise, billboardTexture } from '../textures.js';
import { memo, markingsTexture, snowTextures, iceTextures, rockTextures, plankTextures } from '../textures2.js';
import { ARENA_HALF as HALF } from '../Arena.js';
import { flatMat, strut, decorBox, decorCyl, boulder, cliffWalls, boxGeo } from './kit.js';

// Map 4 — "Alpine Pass": a snowed-in mountain pass under heavy overcast. A frozen lake dominates the middle (grip
// nearly gone), pine groves with solid trunks pinch the plowed roads, two log chalets, a ski-lift line, snow kickers
// and two crevasses. Snow falls constantly.

const yawFor = (dx, dz) => Math.atan2(-dx, -dz);
const LAKE = { x: -6, z: 8, r: 24 };

export const ALPINE = {
  id: 'alpine',
  name: 'ALPINE PASS',
  short: 'ALPINE PASS',
  blurb: 'Snowfall over a frozen lake: pines pinch the roads, ice kills your grip, crevasses bite.',
  tags: ['ICE', 'SNOW', 'FOREST'],
  thumb: ['#b9c6d6', '#e6ecf3', '#8ea3ba'],
  env: { exposure: 1.06, bloom: [0.18, 0.5, 1.0], envIntensity: 1.05, headlight: 65 },

  build(a) {
    a.sunOffset.set(-60, 72, 44);
    a.lights({ sunColor: 0xe6eeff, sunIntensity: 1.8, hemiSky: 0xd2dff2, hemiGround: 0x8794a8, hemiIntensity: 1.3 });
    a.sky({
      horizon: [0.8, 0.84, 0.9], mid: [0.62, 0.7, 0.8], top: [0.4, 0.49, 0.62], ground: [0.76, 0.81, 0.87],
      sunColor: [1, 0.97, 0.9], sunGlow: 0.1, sunDisc: 2.5, hazeColor: [0.82, 0.86, 0.92], hazeBand: 0.55,
      clouds: { cover: 0.86, lit: [0.96, 0.97, 1.0], dark: [0.52, 0.58, 0.67], scale: 0.95, speed: 0.012 },
    });
    a.fog(0xc7d1dc, 0.0028);
    a.weatherLayer('snow', { count: 520, wind: [2.4, 0, 0.9] });

    a.spawn(-64, -10, yawFor(1, 0.1));
    a.spawn(64, -14, yawFor(-1, 0.1));
    a.spawn(-42, 62, yawFor(1, -0.4));
    a.spawn(42, 60, yawFor(-1, -0.4));

    for (const [kind, x, z] of [
      ['health', 4, -44], ['health', 12, 60], ['boost', -44, 22], ['boost', 40, 14],
      ['overcharge', -6, 8], ['overcharge', 52, -50],
      ['missile', -30, -52], ['scatter', 30, -36], ['mine', -26, 42], ['laser', 60, 36],
    ]) a.pickup(kind, x, z);

    a.waypointGrid(18, 66);

    this.ground(a);
    cliffWalls(a, {
      rock: memo('alpine:cliffA', () => this.rockMat(140, 9)),
      rock2: memo('alpine:cliffB', () => this.rockMat(112, 31)),
      cap: new THREE.MeshStandardMaterial({ color: 0xf1f5fa, roughness: 0.95 }),
      minH: 10, maxH: 24, seed: 8,
    });
    this.lake(a);
    this.chalets(a);
    this.skiLift(a);
    this.kickers(a);
    this.rocks(a);
    this.snowbanks(a);
    this.signage(a);
    this.mountains(a);

    a.boostPadsAt([
      { x: 0, z: -58, yaw: yawFor(1, 0) }, { x: -8, z: 40, yaw: yawFor(-1, 0) },
      { x: 50, z: -8, yaw: yawFor(0, 1) }, { x: -54, z: -34, yaw: yawFor(0, 1) },
    ], { emissive: 0x38b6ff, emissiveIntensity: 0.4 });

    a.zone({ x: LAKE.x, z: LAKE.z, r: LAKE.r - 0.5, style: 'ice', visual: false });
    a.zone({ x: 46, z: -30, r: 6, style: 'crevasse' });
    a.zone({ x: -50, z: -50, r: 6, style: 'crevasse' });

    this.pines(a); // last: keeps clear of everything placed above
  },

  rockMat(tone, seed) {
    const t = rockTextures([tone, tone + 4, tone + 12], seed);
    return new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normalMap, normalScale: new THREE.Vector2(0.9, 0.9), roughness: 0.95 });
  },

  ground(a) {
    const sn = snowTextures();
    const map = sn.map.clone(), nrm = sn.normalMap.clone();
    map.repeat.set(20, 20); nrm.repeat.set(20, 20);
    map.needsUpdate = nrm.needsUpdate = true;
    a.ground(new THREE.MeshStandardMaterial({ map, normalMap: nrm, normalScale: new THREE.Vector2(0.5, 0.5), roughness: 0.82, color: 0xf6f9ff }));

    const marks = markingsTexture(HALF, (ctx, m) => {
      const { px, toX, toY } = m;
      const n = createNoise(6);
      const lane = (pts, w) => {
        ctx.lineJoin = 'round'; ctx.lineCap = 'round';
        for (const [ww, alpha] of [[w, 0.1], [w * 0.78, 0.13], [w * 0.55, 0.16]]) {
          ctx.strokeStyle = `rgba(88,104,128,${alpha})`; ctx.lineWidth = ww * px;
          ctx.beginPath(); pts.forEach(([x, z], i) => (i ? ctx.lineTo(toX(x), toY(z)) : ctx.moveTo(toX(x), toY(z)))); ctx.stroke();
        }
        for (const off of [-1.2, 1.2]) {
          ctx.strokeStyle = 'rgba(70,84,104,0.28)'; ctx.lineWidth = 0.5 * px;
          ctx.beginPath();
          pts.forEach(([x, z], i) => { const j = pts[i + 1] ?? pts[i - 1], dx = j[0] - x, dz = j[1] - z, l = Math.hypot(dx, dz) || 1, sg = pts[i + 1] ? 1 : -1; (i ? ctx.lineTo : ctx.moveTo).call(ctx, toX(x - (dz / l) * off * sg), toY(z + (dx / l) * off * sg)); });
          ctx.stroke();
        }
      };
      const loop = [];
      for (let i = 0; i <= 56; i++) { const t = (i / 56) * Math.PI * 2; loop.push([Math.sin(t) * 52 + Math.sin(t * 2) * 4, Math.cos(t) * 48 + Math.sin(t * 3) * 3]); }
      lane(loop, 10);
      lane([[-70, -10], [-52, -4], [-30, 6]], 8);
      lane([[70, -14], [54, -10], [34, 4]], 8);
      lane([[-44, 66], [-30, 56], [-14, 44]], 8);
      lane([[44, 64], [30, 54], [14, 44]], 8);
      // wind-blown drifts + old footprints
      for (let i = 0; i < 180; i++) {
        ctx.fillStyle = `rgba(150,168,192,${0.03 + n.rnd() * 0.06})`;
        ctx.beginPath(); ctx.ellipse(toX((n.rnd() - 0.5) * 158), toY((n.rnd() - 0.5) * 158), (1.6 + n.rnd() * 5) * px, (0.5 + n.rnd() * 1.3) * px, n.rnd() * 3, 0, 7); ctx.fill();
      }
      // cleared spawn pads
      for (const [x, z] of [[-64, -10], [64, -14], [-42, 62], [42, 60]]) {
        ctx.fillStyle = 'rgba(96,112,134,0.22)'; ctx.fillRect(toX(x - 6), toY(z - 6), 12 * px, 12 * px);
        ctx.strokeStyle = 'rgba(232,150,40,0.85)'; ctx.lineWidth = 0.28 * px; ctx.strokeRect(toX(x - 5.4), toY(z - 5.4), 10.8 * px, 10.8 * px);
      }
    }, 'alpine');
    a.markings(marks);

    const outer = snowTextures();
    const om = outer.map.clone(), on = outer.normalMap.clone();
    om.repeat.set(180, 180); on.repeat.set(180, 180);
    om.needsUpdate = on.needsUpdate = true;
    a.outerGround(new THREE.MeshStandardMaterial({ map: om, normalMap: on, roughness: 0.9, color: 0xe4ebf4 }));
  },

  lake(a) {
    const ice = iceTextures();
    const m = new THREE.Mesh(
      new THREE.CircleGeometry(LAKE.r, 72),
      new THREE.MeshStandardMaterial({ map: ice.map, roughness: 0.1, metalness: 0.05, envMapIntensity: 1.6, color: 0xf2f9ff }),
    );
    m.rotation.x = -Math.PI / 2;
    m.position.set(LAKE.x, 0.03, LAKE.z);
    m.receiveShadow = true;
    a.add(m);
    // frosted shoreline: soft snow-white halo ring
    const halo = new THREE.Mesh(
      new THREE.RingGeometry(LAKE.r - 0.4, LAKE.r + 2.6, 72, 1),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, transparent: true, opacity: 0.5, depthWrite: false }),
    );
    halo.rotation.x = -Math.PI / 2;
    halo.position.set(LAKE.x, 0.04, LAKE.z);
    a.add(halo);
    // reeds / rocks at the shoreline
    const mat = memo('alpine:cliffB', () => this.rockMat(112, 31));
    [[-24, 26, 2.2], [14, -12, 2.6], [-31, -6, 1.9], [17, 28, 2.0]].forEach(([x, z, r], i) => boulder(a, x, z, r, mat, { seed: 700 + i, squash: 0.7 }));
  },

  chalets(a) {
    const wood = plankTextures([120, 88, 58]);
    const wm = wood.map.clone(), wn = wood.normalMap.clone();
    wm.repeat.set(2, 1); wn.repeat.set(2, 1);
    wm.needsUpdate = wn.needsUpdate = true;
    const wallMat = new THREE.MeshStandardMaterial({ map: wm, normalMap: wn, roughness: 0.9 });
    const roofMat = flatMat(a, 0x3b3f47, { roughness: 0.85 });
    const snowMat = flatMat(a, 0xf3f7fc, { roughness: 0.95 });
    const winMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.9, 1.35, 0.7), toneMapped: false });
    const brick = flatMat(a, 0x6b4a3d, { roughness: 0.9 });
    for (const [x, z, rotY, w, d] of [[-52, 32, 0.45, 13, 9], [50, 42, -0.55, 12, 9]]) {
      const c = Math.cos(rotY), s = Math.sin(rotY);
      const L = (lx, ly, lz) => [x + lx * c + lz * s, ly, z - lx * s + lz * c];
      const wallH = 4;
      a.decor(boxGeo(w, wallH, d, { tw: 6, th: 4 }), wallMat, { pos: L(0, wallH / 2, 0), rot: [0, rotY, 0] });
      // gable roof: two sloped slabs
      const slope = 0.62, half = d / 2 + 0.9;
      const rlen = half / Math.cos(slope);
      for (const sd of [-1, 1]) {
        const pos = L(0, wallH + Math.sin(slope) * rlen / 2 + 0.05, sd * half * 0.5);
        a.decor(new THREE.BoxGeometry(w + 1.4, 0.3, rlen), roofMat, { pos, rot: [sd * slope, rotY, 0], order: 'YXZ' });
        const pos2 = L(0, wallH + Math.sin(slope) * rlen / 2 + 0.28, sd * half * 0.5);
        a.decor(new THREE.BoxGeometry(w + 1.2, 0.34, rlen * 0.9), snowMat, { pos: pos2, rot: [sd * slope, rotY, 0], order: 'YXZ', cast: false });
      }
      // gable ends (triangles as thin boxes stack) — keep simple: a wall wedge via 3 stacked boxes
      for (let i = 0; i < 4; i++) {
        const ww = d * (1 - i * 0.24);
        for (const sx of [-1, 1]) a.decor(new THREE.BoxGeometry(0.3, 0.9, Math.max(ww, 0.4)), wallMat, { pos: L(sx * (w / 2 - 0.15), wallH + 0.45 + i * 0.9, 0), rot: [0, rotY, 0] });
      }
      // chimney, door, windows
      a.decor(new THREE.BoxGeometry(1.1, 3.4, 1.1), brick, { pos: L(w * 0.3, wallH + 2.6, -1.2), rot: [0, rotY, 0] });
      for (const wx of [-w * 0.3, w * 0.02, w * 0.3]) a.decor(new THREE.PlaneGeometry(1.4, 1.1), winMat, { pos: L(wx, 2.2, d / 2 + 0.02), rot: [0, rotY, 0], cast: false });
      a.decor(new THREE.BoxGeometry(1.3, 2.4, 0.12), flatMat(a, 0x3e2a1c, { roughness: 0.9 }), { pos: L(-w * 0.1, 1.2, d / 2 + 0.03), rot: [0, rotY, 0] });
      // porch light glow + woodpile
      a.decor(new THREE.BoxGeometry(2.4, 1.1, 0.9), wallMat, { pos: L(-w * 0.42, 0.55, d / 2 + 1.0), rot: [0, rotY, 0] });
      a.solid([w, wallH + 1, d], [x, (wallH + 1) / 2, z], { rotY });
    }
  },

  /** Ski-lift line along the north side: solid steel pylons, sagging cable, hanging cabins. */
  skiLift(a) {
    const steel = flatMat(a, 0x8b939c, { roughness: 0.5, metalness: 0.7 });
    const cable = flatMat(a, 0x1d1f22, { roughness: 0.6, metalness: 0.6 });
    const cabin = flatMat(a, 0xc4392b, { roughness: 0.5, metalness: 0.3 });
    const xs = [-56, -20, 16, 52];
    const z = -68;
    xs.forEach((x, i) => {
      decorCyl(a, steel, 0.4, 13, [x, 0, z], { radiusTop: 0.26 });
      decorBox(a, steel, [0.3, 0.3, 4.4], [x, 12.6, z]);
      a.solidCyl(0.5, 6, [x, 0, z]);
      decorBox(a, flatMat(a, 0x50565d, { roughness: 0.8 }), [1.3, 0.5, 1.3], [x, 0.25, z]);
      if (i < xs.length - 1) {
        const x2 = xs[i + 1];
        for (const dz of [-2.1, 2.1]) {
          const mid = 12.3 - 1.4;
          strut(a, cable, [x, 12.4, z + dz], [(x + x2) / 2, mid, z + dz], 0.06, false);
          strut(a, cable, [(x + x2) / 2, mid, z + dz], [x2, 12.4, z + dz], 0.06, false);
        }
        const cx = x + (x2 - x) * 0.4;
        decorBox(a, cabin, [2.2, 1.7, 1.7], [cx, 10.0, z + 2.1]);
        strut(a, cable, [cx, 10.9, z + 2.1], [cx, 11.0, z + 2.1], 0.05, false);
        decorBox(a, cable, [0.08, 1.6, 0.08], [cx, 11.1, z + 2.1]);
      }
    });
  },

  kickers(a) {
    const snow = new THREE.MeshStandardMaterial({ color: 0xf1f5fb, roughness: 0.85 });
    const wood = new THREE.MeshStandardMaterial({ color: 0x6b4d33, roughness: 0.9 });
    for (const [x, z, dx, dz] of [[24, -44, 0, 1], [-30, -26, 1, 0.4], [26, 40, -1, -0.2], [-20, 56, 0.3, -1]]) {
      const ramp = a.ramp(9, 2.2, 10, x, z, yawFor(dx, dz), [snow, wood]);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.4, 6), flatMat(a, 0xe8912a));
      pole.position.set(4.6, 1.2, 0);
      ramp.add(pole);
    }
  },

  rocks(a) {
    const mat = [memo('alpine:cliffA', () => this.rockMat(140, 9)), memo('alpine:cliffB', () => this.rockMat(112, 31))];
    [[-36, -34, 2.4], [-14, -44, 1.8], [36, 20, 2.2], [30, 62, 2.0], [-66, 44, 2.6], [64, -34, 2.8], [8, 62, 1.7], [-58, 6, 1.9], [60, 10, 2.1]]
      .forEach(([x, z, r], i) => boulder(a, x, z, r, mat[i % 2], { seed: 300 + i, squash: 0.66 }));
  },

  snowbanks(a) {
    const snow = flatMat(a, 0xf4f8fd, { roughness: 0.95 });
    const n = createNoise(23);
    const geo = new THREE.SphereGeometry(1, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2);
    for (let i = 0; i < 90; i++) {
      const side = Math.floor(n.rnd() * 4);
      const t = (n.rnd() - 0.5) * 2 * (HALF - 20);
      const off = HALF + 0.9 + n.rnd() * 1.4;
      const pos = side === 0 ? [t, 0, -off] : side === 1 ? [t, 0, off] : side === 2 ? [off, 0, t] : [-off, 0, t];
      const sc = 2.5 + n.rnd() * 3.5;
      a.decor(geo, snow, { pos, scale: [sc * 1.3, 0.9 + n.rnd() * 0.9, sc], rot: [0, n.rnd() * 3, 0], cast: false });
    }
  },

  signage(a) {
    const frame = flatMat(a, 0x5a3f28, { roughness: 0.9 });
    const g = new THREE.Group();
    g.position.set(0, 0, HALF + 8);
    g.rotation.y = Math.PI;
    a.add(g);
    const board = new THREE.Mesh(new THREE.BoxGeometry(28, 7, 0.6), frame);
    board.position.y = 12.5;
    g.add(board);
    for (const x of [-10, 10]) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.9, 12.5, 0.9), frame);
      p.position.set(x, 6.25, 0.8);
      g.add(p);
    }
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(26.8, 6.4), new THREE.MeshStandardMaterial({ map: billboardTexture('ALPINE PASS', 'CHAINS REQUIRED · SUMMIT 2,140 M · ROAD CLOSES AT DUSK', '#2b3b52', '#f2f5fa'), roughness: 0.7 }));
    sign.position.set(0, 12.5, 0.32);
    g.add(sign);
  },

  /** Ring of low-poly peaks: rock at the base, snowfields above, faded into the overcast by fog. */
  mountains(a) {
    const n = createNoise(58);
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true });
    const count = 15;
    for (let i = 0; i < count; i++) {
      const ang = (i / count) * Math.PI * 2 + (n.rnd() - 0.5) * 0.2;
      const r = 430 + n.rnd() * 220;
      const R = 200 + n.rnd() * 150, H = 200 + n.rnd() * 220;
      const geo = new THREE.ConeGeometry(R, H, 9, 6, true);
      const p = geo.attributes.position;
      const col = new Float32Array(p.count * 3);
      for (let v = 0; v < p.count; v++) {
        const y = p.getY(v);
        const t = (y + H / 2) / H;
        const jit = 0.82 + n.rnd() * 0.34;
        if (t < 0.98) { p.setX(v, p.getX(v) * jit); p.setZ(v, p.getZ(v) * jit); p.setY(v, y + (n.rnd() - 0.5) * H * 0.05 * (1 - t)); }
        const snowLine = 0.42 + (n.rnd() - 0.5) * 0.14;
        const c = t > snowLine ? [0.93, 0.95, 0.98] : t > 0.16 ? [0.42, 0.44, 0.5] : [0.22, 0.29, 0.26];
        col[v * 3] = c[0]; col[v * 3 + 1] = c[1]; col[v * 3 + 2] = c[2];
      }
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      geo.computeVertexNormals();
      const m = new THREE.Mesh(geo, mat);
      m.position.set(Math.sin(ang) * r, H / 2 - 6, Math.cos(ang) * r);
      m.rotation.y = n.rnd() * 6;
      a.add(m);
    }
  },

  /** Pine groves with solid trunks. Positions are rejection-sampled away from every gameplay object placed so far. */
  pines(a) {
    const n = createNoise(91);
    const trunk = flatMat(a, 0x4a3524, { roughness: 0.95 });
    const needle = flatMat(a, 0x24402f, { roughness: 0.92 });
    const needle2 = flatMat(a, 0x2c5038, { roughness: 0.92 });
    const snow = flatMat(a, 0xf2f6fb, { roughness: 0.95 });
    const keep = [];
    a.spawns.forEach((s) => keep.push([s.position.x, s.position.z, 13]));
    a.pickupSpots.forEach((p) => keep.push([p.x, p.z, 5]));
    a.boostPads.forEach((p) => keep.push([p.position.x, p.position.z, 8]));
    a.hazardZones.forEach((z) => keep.push([z.position.x, z.position.z, z.radius + 4]));
    keep.push([-52, 32, 13], [50, 42, 13], [24, -44, 9], [-30, -26, 9], [26, 40, 9], [-20, 56, 9]);
    for (let i = 0; i < 12; i++) keep.push([-56 + (i % 4) * 36, -68 + Math.floor(i / 4) * 0, 6]); // ski-lift pylons
    // groves: [cx, cz, radius, count]
    const groves = [[-54, -52, 16, 9], [56, -52, 16, 8], [-70, 60, 14, 7], [66, 26, 12, 6], [0, -20, 10, 4], [-18, 66, 11, 5], [22, 12, 9, 3], [-64, -30, 9, 4], [60, -8, 8, 3]];
    const trees = [];
    for (const [cx, cz, gr, cnt] of groves) {
      let placed = 0, tries = 0;
      while (placed < cnt && tries++ < 300) {
        const ang = n.rnd() * 6.283, rr = Math.sqrt(n.rnd()) * gr;
        const x = cx + Math.sin(ang) * rr, z = cz + Math.cos(ang) * rr;
        if (Math.abs(x) > HALF - 5 || Math.abs(z) > HALF - 5) continue;
        if (Math.abs(x) + Math.abs(z) > 132) continue;
        if (Math.hypot(x - LAKE.x, z - LAKE.z) < LAKE.r + 4) continue;
        if (keep.some(([kx, kz, kr]) => Math.hypot(x - kx, z - kz) < kr)) continue;
        if (trees.some(([tx, tz]) => Math.hypot(x - tx, z - tz) < 4.2)) continue;
        trees.push([x, z]);
        placed++;
      }
    }
    const coneGeos = new Map();
    const cone = (r, h) => {
      const k = `${r.toFixed(2)}:${h.toFixed(2)}`;
      if (!coneGeos.has(k)) coneGeos.set(k, new THREE.ConeGeometry(r, h, 9, 1));
      return coneGeos.get(k);
    };
    trees.forEach(([x, z], i) => {
      const s = 0.85 + n.rnd() * 0.6;
      const tall = 4 * s;
      decorCyl(a, trunk, 0.42 * s, tall, [x, 0, z], { radiusTop: 0.3 * s });
      const mat = i % 2 ? needle : needle2;
      for (let k = 0; k < 5; k++) {
        const r = (3.6 - k * 0.62) * s, h = 3.3 * s, y = tall * 0.55 + k * 2.2 * s;
        a.decor(cone(r, h), mat, { pos: [x, y + h / 2, z], rot: [0, k * 0.7, 0] });
        a.decor(cone(r * 0.9, h * 0.5), snow, { pos: [x, y + h * 0.72, z], rot: [0, k * 0.7, 0], cast: false });
      }
      a.solidCyl(0.55 * s, 6, [x, 0, z]);
    });
  },
};
