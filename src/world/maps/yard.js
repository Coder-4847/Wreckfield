import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  asphaltTextures, puddleRoughness, concreteWallTextures, concreteTextures, containerTextures,
  rampTextures, arenaMarkings, plinthTopTextures, billboardTexture, createNoise,
} from '../textures.js';
import { memo } from '../textures2.js';
import { ARENA_HALF as HALF } from '../Arena.js';

// Map 1 — "Salvage Yard 7": a golden-hour industrial scrapyard. Dry asphalt and weathered concrete under a low
// warm sun, painted road markings, matte steel ramps, rusted containers, hazy industrial skyline.
// Layout: central plinth with 4 ramps, a jump loop (r=46) with 4 kickers, container stacks (diagonals, r=62),
// jersey barriers (diagonals, r=38), boost pads on the loop diagonals, 2 hazard zones.

const CHAMFER = 18;
const WALL_H = 5;
const PLINTH_HALF = 12;
const PLINTH_H = 2.4;
const LOOP_R = 46;
const PLINTH_RING = 31;
const DEG = Math.PI / 180;
const polar = (deg, r) => [Math.sin(deg * DEG) * r, Math.cos(deg * DEG) * r];

export const YARD = {
  id: 'yard',
  name: 'SALVAGE YARD 7',
  short: 'SALVAGE YARD',
  blurb: 'Golden-hour scrapyard. Central plinth, a jump loop and container stacks.',
  tags: ['OPEN', 'JUMPS', 'DAY'],
  thumb: ['#f2c08c', '#c98f66', '#4a4a4c'],
  env: { exposure: 1.0, bloom: [0.22, 0.45, 1.0], envIntensity: 0.85, headlight: 40 },

  build(a) {
    a.sunOffset.set(-95, 62, 62);
    a.lights({ sunColor: 0xffd6a6, sunIntensity: 3.3, hemiSky: 0xa9c8ff, hemiGround: 0x6a5846, hemiIntensity: 0.85 });
    a.sky({
      horizon: [0.98, 0.76, 0.58], mid: [0.52, 0.68, 0.92], top: [0.17, 0.37, 0.74], ground: [0.62, 0.5, 0.4],
      sunColor: [1, 0.82, 0.55], sunGlow: 0.3, sunDisc: 12,
      clouds: { cover: 0.45, lit: [1, 0.86, 0.7], dark: [0.66, 0.66, 0.74], scale: 1.15, speed: 0.006 },
    });
    a.fog(0xd9b596, 0.0021);

    // --- spawn pads: on the outer lane, tangent to the jump loop
    for (let k = 0; k < 4; k++) {
      const th = (k * Math.PI) / 2;
      a.spawn(Math.sin(th) * 64, Math.cos(th) * 64, Math.atan2(Math.cos(th), -Math.sin(th)));
    }
    // --- pickups: one per free angular gap between the props (see Phase 4/6 notes)
    for (const [kind, deg, r] of [
      ['health', 20.5, 42], ['boost', 110.5, 50], ['overcharge', 159.5, 44], ['health', 200.5, 52], ['boost', 290.5, 40], ['overcharge', 339.5, 56],
      ['missile', 12, 55], ['scatter', 116, 38], ['mine', 207, 40], ['laser', 298, 55],
    ]) a.pickup(kind, ...polar(deg, r));
    // --- AI navigation ring around the plinth (between plinth ring and container stacks)
    a.waypointRing(43, 16, Math.PI / 16);

    this.floor(a);
    this.walls(a);
    this.plinth(a);
    this.kickers(a);
    this.containers(a);
    this.barriers(a);

    a.boostPadsAt([0, 1, 2, 3].map((k) => {
      const th = Math.PI / 4 + (k * Math.PI) / 2;
      return { x: Math.sin(th) * LOOP_R, z: Math.cos(th) * LOOP_R, yaw: Math.atan2(Math.cos(th), -Math.sin(th)) };
    }));
    for (const deg of [70, 250]) a.zone({ x: polar(deg, 54)[0], z: polar(deg, 54)[1], r: 6.5, style: 'hazard' });

    this.towers(a);
    this.skyline(a);
    this.signs(a);
  },

  floor(a) {
    const asphalt = memo('yard:asphalt', () => asphaltTextures(16));
    const rough = memo('yard:rough', () => puddleRoughness());
    a.ground(new THREE.MeshStandardMaterial({
      map: asphalt.map, normalMap: asphalt.normalMap, normalScale: new THREE.Vector2(0.35, 0.35),
      roughnessMap: rough, roughness: 1, metalness: 0, color: 0xffffff,
    }));
    const mk = memo('yard:marks', () => arenaMarkings(HALF, {
      loopRadius: LOOP_R, plinthRing: PLINTH_RING,
      spawns: [0, 1, 2, 3].map((k) => {
        const th = (k * Math.PI) / 2;
        return { x: Math.sin(th) * 64, z: Math.cos(th) * 64, yaw: Math.atan2(Math.cos(th), -Math.sin(th)) };
      }),
      chamfer: CHAMFER,
    }));
    a.markings(mk.map);
    const dirt = memo('yard:dirt', () => concreteTextures(31, [126, 108, 88]));
    dirt.map.repeat.set(70, 70);
    dirt.normalMap.repeat.set(70, 70);
    a.outerGround(new THREE.MeshStandardMaterial({ map: dirt.map, normalMap: dirt.normalMap, roughness: 0.97, color: 0xb8a48c }));
  },

  walls(a) {
    const wt = memo('yard:wall', () => concreteWallTextures());
    const capMat = new THREE.MeshStandardMaterial({ color: 0x8c8a84, roughness: 0.7, metalness: 0.4 });
    const bandColor = ['#d5d0c4', '#d5d0c4', '#d4a62b', '#d4a62b', '#c4592b', '#c4592b', '#c4592b', '#c4592b'];
    a.perimeter((s) => {
      const map = wt.map.clone(), nrm = wt.normalMap.clone();
      map.repeat.set(s.len / 10, 1);
      nrm.repeat.set(s.len / 10, 1);
      map.needsUpdate = nrm.needsUpdate = true;
      const mat = new THREE.MeshStandardMaterial({ map, normalMap: nrm, roughness: 0.85, metalness: 0.05 });
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(s.len, WALL_H, s.T), [mat, mat, capMat, capMat, mat, mat]);
      mesh.position.set(s.cx, WALL_H / 2, s.cz);
      mesh.rotation.y = s.rotY;
      mesh.castShadow = mesh.receiveShadow = true;
      a.add(mesh);
      const nm = new THREE.MeshStandardMaterial({ color: bandColor[s.index], roughness: 0.75, metalness: 0.05 });
      const off = new THREE.Vector3(s.inward[0], 0, s.inward[1]).multiplyScalar(s.T / 2 + 0.03);
      for (const [h, th] of [[WALL_H - 0.4, 0.26], [1.05, 0.12]]) {
        const strip = new THREE.Mesh(new THREE.BoxGeometry(s.len - 0.4, th, 0.05), nm);
        strip.position.set(s.cx + off.x, h, s.cz + off.z);
        strip.rotation.y = s.rotY;
        a.add(strip);
      }
      const cap = new THREE.Mesh(new THREE.BoxGeometry(s.len, 0.25, s.T + 0.3), capMat);
      cap.position.set(s.cx, WALL_H + 0.12, s.cz);
      cap.rotation.y = s.rotY;
      cap.castShadow = true;
      a.add(cap);
    }, { chamfer: CHAMFER });
  },

  plinth(a) {
    const top = memo('yard:plinthTop', () => plinthTopTextures());
    const ct = memo('yard:plinthSide', () => concreteTextures(12, [128, 122, 112]));
    const side = ct.map.clone(), sideN = ct.normalMap.clone();
    side.repeat.set(3, 0.4); sideN.repeat.set(3, 0.4);
    side.needsUpdate = sideN.needsUpdate = true;
    const sideMat = new THREE.MeshStandardMaterial({ map: side, normalMap: sideN, roughness: 0.85 });
    const topMat = new THREE.MeshStandardMaterial({ map: top.map, roughness: 0.75, metalness: 0.05 });
    const plinth = new THREE.Mesh(new THREE.BoxGeometry(PLINTH_HALF * 2, PLINTH_H, PLINTH_HALF * 2), [sideMat, sideMat, topMat, sideMat, sideMat, sideMat]);
    plinth.position.y = PLINTH_H / 2;
    plinth.castShadow = plinth.receiveShadow = true;
    a.add(plinth);
    a.collider(a.R.ColliderDesc.cuboid(PLINTH_HALF, PLINTH_H / 2, PLINTH_HALF), plinth.position);

    const edgeMat = new THREE.MeshStandardMaterial({ color: 0xd6a92a, roughness: 0.7 });
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      for (const sd of [-1, 1]) {
        const len = PLINTH_HALF - 5.2;
        const along = sd * (5.2 + len / 2);
        const m = new THREE.Mesh(new THREE.BoxGeometry(dx !== 0 ? 0.15 : len, 0.12, dx !== 0 ? len : 0.15), edgeMat);
        m.position.set(dx * (PLINTH_HALF + 0.05) + (dz !== 0 ? along : 0), PLINTH_H - 0.08, dz * (PLINTH_HALF + 0.05) + (dx !== 0 ? along : 0));
        a.add(m);
      }
    }

    const rt = memo('yard:ramp', () => rampTextures());
    const rampMat = new THREE.MeshStandardMaterial({ map: rt.map, normalMap: rt.normalMap, roughness: 0.5, metalness: 0.7 });
    const rampLen = 12;
    for (const [sx, sz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      a.ramp(10, PLINTH_H, rampLen, sx * (PLINTH_HALF + rampLen / 2), sz * (PLINTH_HALF + rampLen / 2), Math.atan2(sx, sz), [rampMat, sideMat]);
    }
  },

  kickers(a) {
    const rt = memo('yard:ramp', () => rampTextures());
    const mat = new THREE.MeshStandardMaterial({ map: rt.map, normalMap: rt.normalMap, roughness: 0.5, metalness: 0.7, color: 0xffe0b0 });
    const side = new THREE.MeshStandardMaterial({ color: 0x555860, roughness: 0.6, metalness: 0.6 });
    const H = 1.7, L = 8, W = 8;
    const strip = new THREE.MeshStandardMaterial({ color: 0xd6a92a, roughness: 0.6, metalness: 0.2 });
    for (let k = 0; k < 4; k++) {
      const th = (k * Math.PI) / 2;
      const ramp = a.ramp(W, H, L, Math.sin(th) * LOOP_R, Math.cos(th) * LOOP_R, Math.atan2(Math.cos(th), -Math.sin(th)), [mat, side]);
      const lip = new THREE.Mesh(new THREE.BoxGeometry(W, 0.1, 0.14), strip);
      lip.position.set(0, H + 0.02, -L / 2);
      ramp.add(lip);
    }
  },

  containers(a) {
    const defs = [
      ['#8e3a2b', 'WRK·0719'], ['#2c6a72', 'MARLINE'], ['#b98a2a', 'SCRAPCO'],
      ['#33477a', 'VOLTLINE'], ['#6a6d70', 'KRUSH-44'], ['#3d6b45', 'GRNDLINE'],
    ];
    const mats = defs.map(([c, l], i) => {
      const t = memo(`yard:cont:${i}`, () => containerTextures(c, l, 50 + i));
      return new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normalMap, roughness: 0.55, metalness: 0.55 });
    });
    const endMat = new THREE.MeshStandardMaterial({ color: 0x3a3a3c, roughness: 0.65, metalness: 0.6 });
    const L = 12.2, H = 2.6, D = 2.44;
    let mi = 0;
    const place = (x, y, z, rotY) => {
      const m = mats[mi++ % mats.length];
      a.box([L, H, D], [x, y + H / 2, z], [endMat, endMat, endMat, endMat, m, m], { rotY });
    };
    for (let k = 0; k < 4; k++) {
      const th = Math.PI / 4 + (k * Math.PI) / 2;
      const r = 62;
      const cx = Math.sin(th) * r, cz = Math.cos(th) * r;
      const rot = Math.atan2(Math.cos(th), -Math.sin(th)) + Math.PI / 2;
      const rx = Math.sin(th), rz = Math.cos(th);
      place(cx, 0, cz, rot);
      place(cx + rx * 2.6, 0, cz + rz * 2.6, rot);
      place(cx + rx * 1.3 + Math.cos(th) * 1.5, H, cz + rz * 1.3 - Math.sin(th) * 1.5, rot + 0.06);
    }
  },

  barriers(a) {
    const shape = new THREE.Shape();
    shape.moveTo(-0.35, 0); shape.lineTo(0.35, 0); shape.lineTo(0.3, 0.25); shape.lineTo(0.14, 0.45);
    shape.lineTo(0.1, 0.95); shape.lineTo(-0.1, 0.95); shape.lineTo(-0.14, 0.45); shape.lineTo(-0.3, 0.25);
    shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 4, bevelEnabled: false });
    geo.translate(0, 0, -2);
    const ct = memo('yard:barrier', () => concreteTextures(19, [150, 144, 134]));
    const mp = ct.map.clone(), np = ct.normalMap.clone();
    mp.repeat.set(0.3, 0.3); np.repeat.set(0.3, 0.3);
    mp.needsUpdate = np.needsUpdate = true;
    const mat = new THREE.MeshStandardMaterial({ map: mp, normalMap: np, roughness: 0.85 });
    const tape = new THREE.MeshStandardMaterial({ color: 0xe8e4d8, roughness: 0.35, metalness: 0.1 });
    for (let k = 0; k < 4; k++) {
      const base = Math.PI / 4 + (k * Math.PI) / 2;
      for (let j = -1; j <= 1; j++) {
        const th = base + j * 0.11;
        const r = 38 + (j === 0 ? 1.6 : 0);
        const b = new THREE.Mesh(geo, mat);
        b.position.set(Math.sin(th) * r, 0, Math.cos(th) * r);
        b.rotation.y = th + Math.PI / 2;
        b.castShadow = b.receiveShadow = true;
        a.add(b);
        a.hull(b);
        const g = new THREE.Mesh(new THREE.BoxGeometry(0.21, 0.06, 3.9), tape);
        g.position.set(0, 0.96, 0);
        b.add(g);
      }
    }
  },

  /** Corner floodlight masts. Golden hour, so the lamps are off — no dynamic lights. */
  towers(a) {
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x6d7076, roughness: 0.55, metalness: 0.8 });
    const headMat = new THREE.MeshStandardMaterial({ color: 0x33363b, roughness: 0.5, metalness: 0.7 });
    const lampMat = new THREE.MeshStandardMaterial({ color: 0x9aa3ad, roughness: 0.15, metalness: 0.9 });
    const footMat = new THREE.MeshStandardMaterial({ color: 0x8b8a85, roughness: 0.9 });
    for (const [sx, sz] of [[1, 1], [-1, 1], [-1, -1], [1, -1]]) {
      const bx = sx * 77, bz = sz * 77, height = 24;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.6, height, 12), poleMat);
      pole.position.set(bx, height / 2, bz);
      pole.castShadow = true;
      a.add(pole);
      for (let y = 3; y < height - 2; y += 3.2) {
        a.decor(new THREE.BoxGeometry(1.8, 0.12, 0.12), poleMat, { pos: [bx, y, bz], rot: [0, Math.atan2(sx, sz) + Math.PI / 2, 0.5] });
      }
      const head = new THREE.Group();
      head.position.set(bx, height + 1, bz);
      head.lookAt(0, 0, 0);
      a.add(head);
      head.add(new THREE.Mesh(new THREE.BoxGeometry(6.5, 2.6, 1.2), headMat));
      for (let lx = -2; lx <= 2; lx++) for (let ly = -0.5; ly <= 0.5; ly += 1) {
        const lamp = new THREE.Mesh(new THREE.CircleGeometry(0.48, 20), lampMat);
        lamp.position.set(lx * 1.2, ly * 1.1, 0.61);
        head.add(lamp);
      }
      const foot = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.5, 0.7, 14), footMat);
      foot.position.set(bx, 0.35, bz);
      foot.castShadow = true;
      a.add(foot);
    }
  },

  /** Distant industrial horizon: warehouses, silos, smokestacks, cranes and low hills — fogged into a warm haze. */
  skyline(a) {
    const n = createNoise(99);
    const boxes = [], cyls = [];
    const put = (g, x, z, y0 = 0) => { g.translate(x, y0, z); return g; };
    for (let i = 0; i < 64; i++) {
      const ang = (i / 64) * Math.PI * 2 + n.rnd() * 0.08;
      const r = 300 + n.rnd() * 240;
      const x = Math.cos(ang) * r, z = Math.sin(ang) * r;
      const kind = n.rnd();
      if (kind < 0.55) {
        const w = 30 + n.rnd() * 50, d = 24 + n.rnd() * 40, h = 10 + n.rnd() * 22;
        boxes.push(put(new THREE.BoxGeometry(w, h, d), x, z, h / 2 - 1));
        boxes.push(put(new THREE.BoxGeometry(w * 0.5, h * 0.55, d * 0.7), x + w * 0.6, z + d * 0.2, h * 0.27 - 1));
      } else if (kind < 0.8) {
        const rad = 5 + n.rnd() * 3, h = 24 + n.rnd() * 16;
        for (let k = 0; k < 3; k++) cyls.push(put(new THREE.CylinderGeometry(rad, rad, h, 18), x + k * rad * 2.1, z, h / 2 - 1));
      } else if (kind < 0.92) {
        const h = 60 + n.rnd() * 50;
        cyls.push(put(new THREE.CylinderGeometry(2.6, 4.2, h, 14), x, z, h / 2 - 1));
        boxes.push(put(new THREE.BoxGeometry(30, 14, 24), x + 18, z, 6));
      } else {
        const h = 44 + n.rnd() * 20;
        boxes.push(put(new THREE.BoxGeometry(2.2, h, 2.2), x, z, h / 2 - 1));
        boxes.push(put(new THREE.BoxGeometry(56, 2.4, 2.4), x + 18, z, h - 2));
        boxes.push(put(new THREE.BoxGeometry(2, 12, 2), x + 42, z, h - 8));
      }
    }
    const mat = new THREE.MeshStandardMaterial({ color: 0x8d8579, roughness: 0.95, metalness: 0.05 });
    a.add(new THREE.Mesh(mergeGeometries(boxes), mat));
    a.add(new THREE.Mesh(mergeGeometries(cyls), mat));
    const hillMat = new THREE.MeshStandardMaterial({ color: 0x7c705f, roughness: 1 });
    for (let i = 0; i < 16; i++) {
      const ang = (i / 16) * Math.PI * 2 + n.rnd() * 0.2;
      const hill = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), hillMat);
      hill.scale.set(140 + n.rnd() * 120, 30 + n.rnd() * 40, 100 + n.rnd() * 60);
      hill.position.set(Math.cos(ang) * 760, -4, Math.sin(ang) * 760);
      a.add(hill);
    }
  },

  signs(a) {
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x4b4e54, roughness: 0.6, metalness: 0.7 });
    const make = (z, rotY, text, sub, bg, fg) => {
      const g = new THREE.Group();
      g.position.set(0, 0, z);
      g.rotation.y = rotY;
      a.add(g);
      const board = new THREE.Mesh(new THREE.BoxGeometry(34, 8.5, 0.6), frameMat);
      board.position.y = 12; board.castShadow = true;
      g.add(board);
      for (const x of [-12, 12]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.8, 12, 0.8), frameMat);
        post.position.set(x, 6, 0.8); post.castShadow = true;
        g.add(post);
      }
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(32.6, 8.1), new THREE.MeshStandardMaterial({ map: billboardTexture(text, sub, bg, fg), roughness: 0.65, metalness: 0.05 }));
      sign.position.set(0, 12, 0.32);
      g.add(sign);
    };
    make(-(HALF + 6), 0, 'WRECKFIELD', 'NO RULES · NO REFUNDS · NO SURVIVORS', '#1c2026', '#f0b23a');
    make(HALF + 6, Math.PI, 'SALVAGE YARD 7', 'AUTHORIZED WRECKAGE ONLY · HARD HATS REQUIRED', '#d9d4c8', '#1c2026');
  },
};
