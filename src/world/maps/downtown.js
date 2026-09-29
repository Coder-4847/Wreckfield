import * as THREE from 'three';
import { asphaltTextures, concreteTextures, createNoise, billboardTexture } from '../textures.js';
import { memo, markingsTexture, wetRoughness } from '../textures2.js';
import { ARENA_HALF as HALF } from '../Arena.js';
import { containerKit, lampKit, building, boxGeo, facadeMat, flatMat, strut, decorBox, decorCyl } from './kit.js';

// Map 5 — "Downtown Rain": a city grid at night in a downpour. 3×3 blocks (pitch 52, streets 16 wide): four tower
// blocks in the corners, an open plaza with a fountain in the centre, a construction site, a parking deck with ramps,
// a mall and a skate lot. Wet asphalt, sodium street lamps with light pools, lit windows; neon only as real signage.

const yawFor = (dx, dz) => Math.atan2(-dx, -dz);
const P = 52; // block pitch
const BH = 18; // block half size

export const DOWNTOWN = {
  id: 'downtown',
  name: 'DOWNTOWN RAIN',
  short: 'DOWNTOWN',
  blurb: 'Night storm over a city grid: tight streets, a plaza fountain, a parking deck and a live power line.',
  tags: ['URBAN', 'RAIN', 'NIGHT'],
  thumb: ['#1b2540', '#39456a', '#171a22'],
  env: { exposure: 1.22, bloom: [0.6, 0.6, 0.78], envIntensity: 0.5, headlight: 120 },

  build(a) {
    a.sunOffset.set(70, 96, -50);
    a.lights({ sunColor: 0x9fb2ff, sunIntensity: 0.75, hemiSky: 0x3a4870, hemiGround: 0x16181f, hemiIntensity: 0.6 });
    a.sky({
      horizon: [0.2, 0.15, 0.16], mid: [0.07, 0.09, 0.15], top: [0.02, 0.03, 0.06], ground: [0.05, 0.05, 0.07],
      sunColor: [0.5, 0.6, 0.9], sunGlow: 0.05, sunDisc: 0.8, hazeColor: [0.32, 0.22, 0.17], hazeBand: 0.7,
      clouds: { cover: 0.96, lit: [0.2, 0.22, 0.3], dark: [0.04, 0.05, 0.08], scale: 1.0, speed: 0.014 },
    });
    a.fog(0x1a2030, 0.0044);
    a.weatherLayer('rain', { count: 950, wind: [1.6, 0, 0.6] });

    a.spawn(-26, -64, yawFor(0, 1));
    a.spawn(26, 64, yawFor(0, -1));
    a.spawn(-64, 26, yawFor(1, 0));
    a.spawn(64, -26, yawFor(-1, 0));

    for (const [kind, x, z] of [
      ['health', -8, 8], ['health', 8, -8], ['boost', 26, 6], ['boost', -26, -6],
      ['overcharge', 6, -26], ['overcharge', -6, 26],
      ['missile', 52, -26], ['scatter', -52, 26], ['mine', 26, -52], ['laser', -26, 64],
    ]) a.pickup(kind, x, z);

    a.waypointGrid(13, 78, 3);
    for (const v of [-74, -26, 0, 26, 74]) for (const s of [-74, 74]) { a.waypointPrune(s, v, 3); a.waypointPrune(v, s, 3); }

    this.ground(a);
    this.walls(a);
    this.towers(a);
    this.plaza(a);
    this.construction(a);
    this.deck(a);
    this.mall(a);
    this.skateLot(a);
    this.streetLife(a);
    this.lamps(a);
    this.skyline(a);

    a.boostPadsAt([
      { x: -26, z: -46, yaw: yawFor(0, 1) }, { x: 26, z: 46, yaw: yawFor(0, -1) },
      { x: 46, z: 26, yaw: yawFor(-1, 0) }, { x: -46, z: -26, yaw: yawFor(1, 0) },
    ], { emissive: 0x39c0ff, emissiveIntensity: 0.5 });

    a.zone({ x: -26, z: -26, r: 5.5, style: 'hazard' }); // downed power line
    a.zone({ x: 26, z: -6, r: 6.5, style: 'oil' });
    a.zone({ x: -26, z: 8, r: 6.5, style: 'oil' });
  },

  ground(a) {
    const as = memo('dt:asphalt', () => asphaltTextures(22));
    a.ground(new THREE.MeshStandardMaterial({
      map: as.map, normalMap: as.normalMap, normalScale: new THREE.Vector2(0.4, 0.4),
      roughnessMap: wetRoughness(), roughness: 1, metalness: 0.0, color: 0xb8bcc8,
    }));

    const marks = markingsTexture(HALF, (ctx, m) => {
      const { px, toX, toY } = m;
      const n = createNoise(12);
      // sidewalks: every block footprint + kerb line
      for (const bx of [-P, 0, P]) for (const bz of [-P, 0, P]) {
        ctx.fillStyle = 'rgba(96,98,106,0.9)';
        ctx.fillRect(toX(bx - BH - 1.4), toY(bz - BH - 1.4), (BH * 2 + 2.8) * px, (BH * 2 + 2.8) * px);
        ctx.fillStyle = 'rgba(130,130,138,0.95)';
        ctx.fillRect(toX(bx - BH), toY(bz - BH), BH * 2 * px, BH * 2 * px);
        // paving joints
        ctx.strokeStyle = 'rgba(60,62,70,0.5)'; ctx.lineWidth = 0.08 * px;
        for (let g = -BH; g <= BH; g += 3) {
          ctx.beginPath(); ctx.moveTo(toX(bx + g), toY(bz - BH)); ctx.lineTo(toX(bx + g), toY(bz + BH)); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(toX(bx - BH), toY(bz + g)); ctx.lineTo(toX(bx + BH), toY(bz + g)); ctx.stroke();
        }
      }
      // dirt lot of the construction site (north block)
      ctx.fillStyle = 'rgba(70,52,38,0.92)'; ctx.fillRect(toX(-BH), toY(-P - BH), BH * 2 * px, BH * 2 * px);
      for (let i = 0; i < 140; i++) {
        ctx.fillStyle = `rgba(40,30,22,${0.1 + n.rnd() * 0.2})`;
        ctx.beginPath(); ctx.ellipse(toX((n.rnd() - 0.5) * 34), toY(-P + (n.rnd() - 0.5) * 34), (0.6 + n.rnd() * 2.2) * px, (0.4 + n.rnd() * 1.2) * px, n.rnd() * 3, 0, 7); ctx.fill();
      }
      // plaza: circular paved pattern
      ctx.strokeStyle = 'rgba(70,72,82,0.8)'; ctx.lineWidth = 0.14 * px;
      for (const r of [7.5, 10.5, 13.5]) { ctx.beginPath(); ctx.arc(toX(0), toY(0), r * px, 0, 7); ctx.stroke(); }
      // road centre lines (dashed yellow) along every street, skipping intersections
      const streets = [-P / 2, P / 2, -76, 76];
      ctx.strokeStyle = 'rgba(232,186,40,0.9)'; ctx.lineWidth = 0.28 * px;
      ctx.setLineDash([3.2 * px, 3.0 * px]);
      for (const s of [-P / 2, P / 2]) {
        for (const seg of [[-78, s - 10], [s + 10, 78]]) {
          if (seg[1] - seg[0] < 6) continue;
          ctx.beginPath(); ctx.moveTo(toX(s), toY(seg[0])); ctx.lineTo(toX(s), toY(seg[1])); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(toX(seg[0]), toY(s)); ctx.lineTo(toX(seg[1]), toY(s)); ctx.stroke();
        }
        // the section between the two cross streets
        ctx.beginPath(); ctx.moveTo(toX(s), toY(-P / 2 + 10)); ctx.lineTo(toX(s), toY(P / 2 - 10)); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(toX(-P / 2 + 10), toY(s)); ctx.lineTo(toX(P / 2 - 10), toY(s)); ctx.stroke();
      }
      ctx.setLineDash([]);
      void streets;
      // crosswalks at every intersection approach
      ctx.fillStyle = 'rgba(232,232,226,0.85)';
      for (const cx of [-P / 2, P / 2]) for (const cz of [-P / 2, P / 2]) {
        for (const s of [-1, 1]) {
          for (let k = -6; k <= 6; k += 1.6) {
            ctx.fillRect(toX(cx + k - 0.4), toY(cz + s * 10.5 - 1.4), 0.8 * px, 2.8 * px);
            ctx.fillRect(toX(cx + s * 10.5 - 1.4), toY(cz + k - 0.4), 2.8 * px, 0.8 * px);
          }
        }
      }
      // spawn brackets
      ctx.strokeStyle = 'rgba(240,240,232,0.85)'; ctx.lineWidth = 0.22 * px;
      for (const [x, z] of [[-26, -64], [26, 64], [-64, 26], [64, -26]]) {
        const s = 4.2;
        for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
          ctx.beginPath(); ctx.moveTo(toX(x + sx * s), toY(z + sz * (s - 1.5))); ctx.lineTo(toX(x + sx * s), toY(z + sz * s)); ctx.lineTo(toX(x + sx * (s - 1.5)), toY(z + sz * s)); ctx.stroke();
        }
      }
      // tyre-worn patches + oil sheen
      for (let i = 0; i < 160; i++) {
        ctx.fillStyle = `rgba(10,10,14,${0.06 + n.rnd() * 0.1})`;
        const x = (n.rnd() - 0.5) * 156, z = (n.rnd() - 0.5) * 156;
        ctx.beginPath(); ctx.ellipse(toX(x), toY(z), (2 + n.rnd() * 5) * px, (0.5 + n.rnd() * 1.2) * px, n.rnd() < 0.5 ? 0 : Math.PI / 2, 0, 7); ctx.fill();
      }
    }, 'downtown');
    a.markings(marks);

    const out = memo('dt:outer', () => concreteTextures(58, [70, 72, 78]));
    const om = out.map.clone(), on = out.normalMap.clone();
    om.repeat.set(120, 120); on.repeat.set(120, 120);
    om.needsUpdate = on.needsUpdate = true;
    a.outerGround(new THREE.MeshStandardMaterial({ map: om, normalMap: on, roughness: 0.6, color: 0x6a6d78 }));
  },

  /** Perimeter: high hoarding / party walls with lit windows above, so the outer ring road feels like an alley. */
  walls(a) {
    const fm = facadeMat(a, 'concrete', 0.3, 21, 0.9);
    const base = flatMat(a, 0x2b2e35, { roughness: 0.8 });
    a.perimeter((s) => {
      const h = 22 + (s.index % 3) * 6;
      const w = s.len, d = 6;
      const back = d / 2 - s.T / 2;
      const px = s.cx - s.inward[0] * back, pz = s.cz - s.inward[1] * back;
      a.decor(boxGeo(w, h, d), fm, { pos: [px, h / 2, pz], rot: [0, s.rotY, 0] });
      // dark plinth band + ledge
      const bx = s.cx - s.inward[0] * (back - 0.06), bz = s.cz - s.inward[1] * (back - 0.06);
      a.decor(new THREE.BoxGeometry(w, 1.4, d + 0.1), base, { pos: [bx, 0.7, bz], rot: [0, s.rotY, 0] });
      a.decor(new THREE.BoxGeometry(w + 0.4, 0.5, d + 0.4), base, { pos: [px, h + 0.25, pz], rot: [0, s.rotY, 0] });
    }, { chamfer: 18, T: 2.6, colH: 40 });
  },

  /** Four tower blocks in the corners. */
  towers(a) {
    building(a, { x: -P - 1, z: -P + 1, w: 25, d: 27, h: 56, kind: 'glass', lit: 0.42, seed: 31, emissive: 1.25, roof: 0x24272e });
    building(a, { x: -P + 10, z: -P - 12, w: 12, d: 10, h: 18, kind: 'concrete', lit: 0.35, seed: 32, emissive: 1.1 });
    building(a, { x: P, z: -P - 1, w: 27, d: 24, h: 40, kind: 'concrete', lit: 0.4, seed: 33, emissive: 1.2, roof: 0x2c2f35 });
    building(a, { x: P - 4, z: -P + 14, w: 14, d: 8, h: 14, kind: 'concrete', lit: 0.3, seed: 34, emissive: 1.1 });
    building(a, { x: -P + 1, z: P, w: 28, d: 26, h: 46, kind: 'concrete', lit: 0.36, seed: 35, emissive: 1.2 });
    building(a, { x: P + 1, z: P - 1, w: 24, d: 28, h: 64, kind: 'glass', lit: 0.4, seed: 36, emissive: 1.3, roof: 0x22252b });
    // rooftop beacons (aircraft warning) on the two tallest
    for (const [x, z, y] of [[-P - 1, -P + 1, 57.5], [P + 1, P - 1, 65.5]]) {
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.45, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 0.15, 0.1), toneMapped: false }));
      b.position.set(x, y, z);
      a.add(b);
      a.animated.push((t) => b.scale.setScalar(Math.sin(t * 2.2 + x) > 0.4 ? 1 : 0.15));
    }
  },

  plaza(a) {
    const stone = flatMat(a, 0x8a8d96, { roughness: 0.7 });
    const stone2 = flatMat(a, 0x6f727b, { roughness: 0.8 });
    const water = new THREE.MeshStandardMaterial({ color: 0x1c3550, roughness: 0.05, metalness: 0.2, emissive: new THREE.Color(0.06, 0.16, 0.28), emissiveIntensity: 0.8 });
    decorCyl(a, stone, 5.4, 0.8, [0, 0, 0]);
    decorCyl(a, water, 4.8, 0.06, [0, 0.76, 0]);
    decorCyl(a, stone2, 1.5, 2.2, [0, 0, 0], { radiusTop: 1.1 });
    decorCyl(a, stone, 2.3, 0.3, [0, 2.0, 0]);
    const jet = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.55, 0.75, 1.0), transparent: true, opacity: 0.55, toneMapped: false, depthWrite: false });
    const jm = new THREE.Mesh(new THREE.ConeGeometry(0.9, 3.4, 12, 1, true), jet);
    jm.position.set(0, 3.9, 0);
    a.add(jm);
    a.animated.push((t) => { jm.scale.set(1 + Math.sin(t * 6) * 0.06, 1 + Math.sin(t * 4.3) * 0.08, 1 + Math.sin(t * 6) * 0.06); });
    a.solidCyl(5.4, 2.6, [0, 0, 0]);
    // planters + benches (slalom)
    const plant = flatMat(a, 0x1f3b26, { roughness: 0.95 });
    const wood = flatMat(a, 0x6a4b33, { roughness: 0.85 });
    for (const [x, z] of [[-14, -14], [14, 14], [-14, 14], [14, -14]]) {
      decorBox(a, stone2, [3.2, 0.7, 3.2], [x, 0.35, z]);
      decorBox(a, plant, [2.8, 0.8, 2.8], [x, 0.9, z]);
      a.solid([3.2, 1.2, 3.2], [x, 0.6, z]);
    }
    for (const [x, z, r] of [[0, -11, 0], [0, 11, 0], [-11, 0, Math.PI / 2], [11, 0, Math.PI / 2]]) {
      decorBox(a, wood, [3.4, 0.16, 0.9], [x, 0.55, z], [0, r, 0]);
      decorBox(a, stone2, [3.2, 0.5, 0.3], [x, 0.25, z], [0, r, 0]);
      a.solid([3.4, 0.8, 0.9], [x, 0.4, z], { rotY: r });
    }
  },

  construction(a) {
    const conc = flatMat(a, 0x8f9299, { roughness: 0.85 });
    const yel = flatMat(a, 0xe0a71c, { roughness: 0.55, metalness: 0.3 });
    const dark = flatMat(a, 0x30343a, { roughness: 0.6, metalness: 0.5 });
    const fence = flatMat(a, 0xd8d3c6, { roughness: 0.6 });
    // half-built concrete frame you can drive under
    const fx = -4, fz = -52;
    for (const y of [3.8, 7.8]) {
      decorBox(a, conc, [22, 0.45, 14], [fx, y, fz]);
      a.solid([22, 0.45, 14], [fx, y, fz]);
    }
    for (const cx of [-12, -4, 4]) for (const cz of [-58, -46]) {
      decorBox(a, conc, [0.9, 8.2, 0.9], [cx, 4.1, cz]);
      a.solid([0.9, 8.2, 0.9], [cx, 4.1, cz]);
      decorBox(a, dark, [0.1, 1.6, 0.1], [cx, 9.0, cz]); // rebar
    }
    // tower crane
    const mx = 13, mz = -62;
    decorBox(a, yel, [1.8, 40, 1.8], [mx, 20, mz]);
    a.solid([1.8, 40, 1.8], [mx, 20, mz]);
    for (let y = 4; y < 40; y += 4) { strut(a, yel, [mx - 0.9, y, mz - 0.9], [mx + 0.9, y + 4, mz + 0.9], 0.15); strut(a, yel, [mx + 0.9, y, mz - 0.9], [mx - 0.9, y + 4, mz + 0.9], 0.15); }
    decorBox(a, yel, [1.4, 1.4, 44], [mx, 41, mz - 8], [0, 0.35, 0]);
    decorBox(a, dark, [3.2, 2.8, 2.6], [mx, 39.6, mz]);
    decorBox(a, dark, [3, 3, 6], [mx + 1.6, 41, mz + 9.5], [0, 0.35, 0]);
    const cb = new THREE.Mesh(new THREE.SphereGeometry(0.4, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 0.15, 0.1), toneMapped: false }));
    cb.position.set(mx, 43, mz);
    a.add(cb);
    a.animated.push((t) => cb.scale.setScalar(Math.sin(t * 2.6) > 0.3 ? 1 : 0.15));
    // hoarding fence along the street side, with a gate gap
    for (let x = -17; x <= 17; x += 3.4) {
      if (Math.abs(x) < 5) continue;
      decorBox(a, fence, [3.3, 2.2, 0.16], [x, 1.1, -P + BH - 0.2]);
    }
    // stacked pipes + material bays
    const pipe = flatMat(a, 0x3d5a8c, { roughness: 0.5, metalness: 0.4 });
    for (let i = 0; i < 6; i++) decorCyl(a, pipe, 0.5, 6, [10 + (i % 3) * 1.05, i > 2 ? 0.9 : 0, -44 + (i > 2 ? 0 : 0)], { rot: [0, 0, Math.PI / 2] });
    a.solid([6.4, 1.8, 3.2], [11, 0.9, -44]);
    // excavated pit (dark) + spoil heap
    const pit = new THREE.Mesh(new THREE.PlaneGeometry(10, 8), new THREE.MeshBasicMaterial({ color: 0x050506 }));
    pit.rotation.x = -Math.PI / 2;
    pit.position.set(-12, 0.045, -64);
    a.add(pit);
    const heap = new THREE.Mesh(new THREE.ConeGeometry(4.5, 3.6, 10), new THREE.MeshStandardMaterial({ color: 0x4d3a2a, roughness: 1, flatShading: true }));
    heap.position.set(-3, 1.8, -66);
    heap.castShadow = true;
    a.add(heap);
    a.hull(heap);
  },

  /** Parking deck: raised slab with ramps on the west/east sides. */
  deck(a) {
    const H = 3.2, z = P;
    const conc = flatMat(a, 0x60636b, { roughness: 0.85 });
    const strip = flatMat(a, 0xbdbfc4, { roughness: 0.6 });
    a.decor(new THREE.BoxGeometry(30, H, 30), conc, { pos: [0, H / 2, z] });
    a.decor(new THREE.BoxGeometry(30.4, 0.28, 30.4), strip, { pos: [0, H - 0.05, z] });
    a.decor(new THREE.BoxGeometry(30.4, 0.16, 30.4), strip, { pos: [0, 0.9, z] });
    a.solid([30, H, 30], [0, H / 2, z]);
    // deck paint: bay lines
    const line = new THREE.MeshBasicMaterial({ color: 0xcfcfc8 });
    for (let i = -5; i <= 5; i++) {
      for (const zz of [-9, 9]) decorBox(a, line, [0.14, 0.02, 5], [i * 2.6, H + 0.09, z + zz], [0, 0, 0], false);
    }
    for (const sx of [-1, 1]) {
      const ramp = a.ramp(10, H, 12, sx * 21, z, yawFor(-sx, 0), [conc, conc]);
      void ramp;
    }
    // deck rail posts + light poles
    const post = flatMat(a, 0xd6a417, { roughness: 0.6 });
    for (let i = -7; i <= 7; i++) for (const sz of [-1, 1]) decorBox(a, post, [0.25, 0.9, 0.25], [i * 2, H + 0.5, z + sz * 14.8]);
  },

  mall(a) {
    const x = -P, z = 0;
    building(a, { x, z, w: 34, d: 30, h: 12, kind: 'glass', lit: 0.5, seed: 41, emissive: 1.5, roof: 0x2b2e34, clutter: true });
    const signs = [
      ['ARCADE', 'GAMES · TOKENS · CLAW', '#160d18', '#ff6fb0', -9, 4.5],
      ['RAMEN', 'OPEN LATE', '#1a1108', '#ffb35a', 1, 3.6],
      ['24H', 'PHARMACY', '#0b1a14', '#6fe6a8', 10, 3.6],
    ];
    for (const [t, sub, bg, fg, sz, w] of signs) {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(w * 1.6, w * 0.8),
        new THREE.MeshStandardMaterial({ map: billboardTexture(t, sub, bg, fg), roughness: 0.6, emissive: new THREE.Color(1, 1, 1), emissiveIntensity: 0.9 }),
      );
      m.material.emissiveMap = m.material.map;
      m.rotation.y = Math.PI / 2;
      m.position.set(x + 17.06, 6.2, z + sz);
      a.add(m);
    }
    // awning
    a.decor(new THREE.BoxGeometry(2.6, 0.2, 30), flatMat(a, 0x2f333b, { roughness: 0.6, metalness: 0.4 }), { pos: [x + 18.2, 3.6, z] });
  },

  /** East block: open lot with kickers and a barrier line — a free-for-all skate lot. */
  skateLot(a) {
    const x = P;
    const conc = new THREE.MeshStandardMaterial({ color: 0x777a83, roughness: 0.8 });
    const side = new THREE.MeshStandardMaterial({ color: 0x4a4d55, roughness: 0.8 });
    for (const [rx, rz, dx, dz] of [[x - 10, -10, 1, 0], [x + 12, 10, -1, 0], [x + 1, 13, 0, -1]]) {
      const r = a.ramp(9, 2.0, 10, rx, rz, yawFor(dx, dz), [conc, side]);
      const lip = new THREE.Mesh(new THREE.BoxGeometry(9, 0.1, 0.16), flatMat(a, 0xe0a71c));
      lip.position.set(0, 2.02, -5);
      r.add(lip);
    }
    const jersey = flatMat(a, 0xa0a3a8, { roughness: 0.8 });
    for (let i = 0; i < 4; i++) {
      decorBox(a, jersey, [4, 0.95, 0.75], [x + 2, 0.48, -6 - i * 4.6], [0, 0.15 * (i % 2 ? 1 : -1), 0]);
      a.solid([4, 0.95, 0.75], [x + 2, 0.48, -6 - i * 4.6], { rotY: 0.15 * (i % 2 ? 1 : -1) });
    }
    // bus shelter on the street edge
    decorBox(a, flatMat(a, 0x1b2026, { roughness: 0.5, metalness: 0.7 }), [4.4, 0.2, 1.8], [x - 14.5, 2.5, 6]);
    decorBox(a, new THREE.MeshBasicMaterial({ color: new THREE.Color(0.7, 0.85, 1).multiplyScalar(0.9) }), [0.1, 1.9, 1.7], [x - 16.6, 1.4, 6], [0, 0, 0], false);
    a.solid([4.4, 2.6, 1.8], [x - 14.5, 1.3, 6]);
  },

  /** Street life: parked bus x2, a crashed taxi, dumpsters, and the downed power pole. */
  streetLife(a) {
    const body = flatMat(a, 0x2f4f7a, { roughness: 0.45, metalness: 0.35 });
    const white = flatMat(a, 0xd9dde2, { roughness: 0.5, metalness: 0.3 });
    const glass = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.9, 0.75, 0.45).multiplyScalar(0.7) });
    const tail = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 0.1, 0.05), toneMapped: false });
    const tire = flatMat(a, 0x0e0e10, { roughness: 0.95 });
    const bus = (x, z, rotY) => {
      const c = Math.cos(rotY), s = Math.sin(rotY);
      const L = (lx, ly, lz) => [x + lx * c + lz * s, ly, z - lx * s + lz * c];
      decorBox(a, body, [12, 2.3, 2.6], L(0, 1.7, 0), [0, rotY, 0]);
      decorBox(a, white, [12, 0.7, 2.62], L(0, 3.05, 0), [0, rotY, 0]);
      decorBox(a, glass, [11, 0.9, 2.66], L(0, 2.4, 0), [0, rotY, 0], false);
      decorBox(a, tail, [0.1, 0.3, 2.2], L(-6.02, 1.0, 0), [0, rotY, 0], false);
      for (const lx of [-3.6, 3.6]) for (const sz of [-1, 1]) decorCyl(a, tire, 0.55, 0.4, L(lx, 0.02, sz * 1.25).map((v, i) => (i === 1 ? 0.35 : v)), { rot: [Math.PI / 2, rotY, 0], order: 'YXZ' });
      a.solid([12, 3.4, 2.7], [x, 1.7, z], { rotY });
    };
    bus(24, -40, Math.PI / 2 + 0.09);
    bus(-28, 40, Math.PI / 2 - 0.07);
    // taxi wrecked into the intersection
    const yellow = flatMat(a, 0xe0b41c, { roughness: 0.4, metalness: 0.4 });
    decorBox(a, yellow, [4.6, 1.0, 1.9], [26, 0.85, 27], [0, 0.6, 0]);
    decorBox(a, glass, [2.4, 0.6, 1.8], [25.8, 1.55, 27], [0, 0.6, 0], false);
    a.solid([4.6, 1.6, 1.9], [26, 0.8, 27], { rotY: 0.6 });
    // dumpsters
    const green = flatMat(a, 0x2f5a3c, { roughness: 0.6, metalness: 0.3 });
    for (const [x, z, r] of [[-19.4, -40, 0], [34.6, 30, 0], [-34.6, -22, 0.1], [19.4, 38, 0]]) {
      decorBox(a, green, [1.4, 1.3, 2.6], [x, 0.65, z], [0, r, 0]);
      a.solid([1.4, 1.3, 2.6], [x, 0.65, z], { rotY: r });
    }
    // fallen pole + live cable at the hazard zone
    const pole = flatMat(a, 0x4b4f55, { roughness: 0.6, metalness: 0.7 });
    decorCyl(a, pole, 0.2, 9, [-31, 0.2, -30], { rot: [0, 0, Math.PI / 2], order: 'YXZ' });
    decorBox(a, pole, [0.2, 0.2, 2.6], [-27, 0.35, -30]);
    const cable = flatMat(a, 0x111214, { roughness: 0.6 });
    strut(a, cable, [-27, 0.35, -30], [-24, 0.08, -25], 0.07, false);
    strut(a, cable, [-24, 0.08, -25], [-27, 0.08, -22], 0.07, false);
    const sparks = [];
    for (let i = 0; i < 5; i++) {
      const sp = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 4), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.2, 2.2, 3.6), toneMapped: false }));
      sp.position.set(-24, 0.15, -25);
      a.add(sp);
      sparks.push(sp);
    }
    a.animated.push((t) => sparks.forEach((sp, i) => {
      const k = (t * 7 + i * 1.7) % 1;
      const on = Math.sin(t * 23 + i * 5) > -0.2;
      sp.visible = on && k < 0.7;
      sp.position.set(-24 + Math.sin(i * 12.3 + Math.floor(t * 7 + i) * 3.1) * 0.9 * k, 0.15 + Math.sin(k * Math.PI) * 0.9, -25 + Math.cos(i * 7.7 + Math.floor(t * 7 + i) * 2.3) * 0.9 * k);
    }));
    // container yard behind the construction site (a couple of loose boxes)
    const kit = containerKit(a);
    kit.place(66, 0, 26, Math.PI / 2, { idx: 1 });
  },

  lamps(a) {
    const lamp = lampKit(a, { color: 0xffbf7a, poolTint: 0xff9d52, poolOpacity: 0.42 });
    const off = 7.6;
    for (const cx of [-P / 2, P / 2]) for (const cz of [-P / 2, P / 2]) {
      for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const x = cx + sx * off, z = cz + sz * off;
        lamp(x, z, { h: 9.5, arm: 2.4, rotY: Math.atan2(-sx, -sz), poolR: 9.5 });
      }
    }
    // outer ring road
    for (const [x, z, r] of [[-75, -60, Math.PI / 2], [75, 62, -Math.PI / 2], [-75, 60, Math.PI / 2], [75, -58, -Math.PI / 2], [-60, -75, 0], [60, 75, Math.PI], [60, -75, 0], [-58, 75, Math.PI]]) {
      lamp(x, z, { h: 9.5, arm: 2.4, rotY: r, poolR: 9.5 });
    }
  },

  skyline(a) {
    const n = createNoise(77);
    const glassA = facadeMat(a, 'glass', 0.4, 51, 1.0);
    const glassB = facadeMat(a, 'glass', 0.3, 52, 0.9);
    const conc = facadeMat(a, 'concrete', 0.3, 53, 0.9);
    const mats = [glassA, glassB, conc];
    for (let i = 0; i < 70; i++) {
      const ang = (i / 70) * Math.PI * 2 + (n.rnd() - 0.5) * 0.05;
      const r = 240 + n.rnd() * 260;
      const w = 22 + n.rnd() * 36, d = 22 + n.rnd() * 36, h = 40 + Math.pow(n.rnd(), 1.5) * 180;
      a.decor(boxGeo(w, h, d, { tw: 14, th: 20 }), mats[i % 3], { pos: [Math.sin(ang) * r, h / 2 - 1, Math.cos(ang) * r], rot: [0, ang, 0] });
    }
    // a few red beacons far away
    for (let i = 0; i < 6; i++) {
      const ang = n.rnd() * 6.28, r = 300 + n.rnd() * 160;
      const b = new THREE.Mesh(new THREE.SphereGeometry(1.2, 6, 4), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 0.2, 0.1), toneMapped: false }));
      b.position.set(Math.sin(ang) * r, 150 + n.rnd() * 60, Math.cos(ang) * r);
      a.add(b);
      a.animated.push((t) => b.scale.setScalar(Math.sin(t * 1.7 + i * 2) > 0.5 ? 1 : 0.2));
    }
  },
};
