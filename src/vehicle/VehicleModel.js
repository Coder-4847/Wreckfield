import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { radialGlowTexture, tireTexture } from '../world/textures.js';
import { makeProfile, loft, halfWidthAt } from './CarGeometry.js';
import { CAR_TYPES, stationMount } from './CarTypes.js';
import { buildWeaponStation, STATION } from './WeaponStation.js';

// Visual model for a combat car: lofted PBR body (see CarTypes for the five silhouettes), glass greenhouse,
// wheels with brake discs, a roof-mounted remote weapon station, per-loadout hardpoints, and fake damage states.
// Local frame matches the physics body: +X right, +Y up, -Z forward.

let sharedGlow = null;
let sharedTire = null;

const SOOT = new THREE.Color(0x1d1a19);
const _tmpV = new THREE.Vector3();

/**
 * Merge every static mesh under `root` (recursively, skipping the `dynamic` subtrees and sprites) into one mesh per
 * material, parented to `root`. Materials are shared, so runtime material tweaks (damage, lamps) still apply.
 */
function mergeStatic(root, dynamic = new Set()) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const buckets = new Map();
  const remove = [];
  const visit = (obj) => {
    for (const ch of obj.children) {
      if (dynamic.has(ch) || ch.isSprite) continue;
      if (ch.isMesh && !Array.isArray(ch.material) && !ch.isInstancedMesh && ch.visible) {
        const g = ch.geometry.index ? ch.geometry.toNonIndexed() : ch.geometry.clone();
        g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, ch.matrixWorld));
        let b = buckets.get(ch.material);
        if (!b) buckets.set(ch.material, (b = { geos: [], cast: false, order: ch.renderOrder }));
        b.geos.push(g);
        b.cast ||= ch.castShadow;
        remove.push(ch);
      }
      visit(ch);
    }
  };
  visit(root);
  for (const [mat, b] of buckets) {
    if (b.geos.length < 2) { b.geos[0].dispose(); continue; } // nothing to gain; keep the original mesh
    const withUv = b.geos.every((g) => g.attributes.uv);
    for (const g of b.geos) {
      if (!g.attributes.normal) g.computeVertexNormals();
      for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && !(withUv && k === 'uv')) g.deleteAttribute(k);
    }
    const merged = mergeGeometries(b.geos);
    b.geos.forEach((g) => g.dispose());
    if (!merged) continue;
    for (const ch of remove) {
      if (ch.material === mat) {
        ch.parent.remove(ch);
        ch.geometry.dispose();
      }
    }
    const m = new THREE.Mesh(merged, mat);
    m.castShadow = b.cast;
    m.receiveShadow = true;
    m.renderOrder = b.order;
    root.add(m);
  }
}

/** Thin strip following a polyline on a surface; `half` is the constant half-width offset. Faces `outward`. */
function ribbonGeo(pts, half, outward) {
  const pos = [];
  for (const p of pts) pos.push(p.x - half.x, p.y - half.y, p.z - half.z, p.x + half.x, p.y + half.y, p.z + half.z);
  const idx = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  // flip winding if the strip faces inward
  const n = new THREE.Vector3().fromBufferAttribute(g.attributes.normal, 0);
  if (n.dot(outward) < 0) {
    for (let i = 0; i < idx.length; i += 3) [idx[i + 1], idx[i + 2]] = [idx[i + 2], idx[i + 1]];
    g.setIndex(idx);
    g.computeVertexNormals();
  }
  return g;
}

function numberTexture(number) {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#f1f2f4';
  ctx.beginPath(); ctx.arc(S / 2, S / 2, S / 2 - 4, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#15171a';
  ctx.lineWidth = 6;
  ctx.stroke();
  ctx.fillStyle = '#15171a';
  ctx.font = `900 ${S * 0.5}px Rajdhani, Orbitron, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(number, S / 2, S / 2 + 4);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export class VehicleModel {
  constructor(cfg, { type = 'coupe', paint, accent = '#e5e7ea', glow = '#ffb060', number = '07', headlights = true } = {}) {
    this.cfg = cfg;
    this.type = type;
    this.spec = CAR_TYPES[type] ?? CAR_TYPES.coupe;
    this.root = new THREE.Group();
    this.root.name = 'Vehicle';
    this.body = new THREE.Group();
    this.root.add(this.body);
    this.wheelGroups = [];
    this.brakeLight = 0;
    this._boostGlow = 0;
    this._damage = { pct: 1 };
    this._muzzleFlashDecay = 0;
    this._paint = new THREE.Color(paint ?? this.spec.paint);
    this._build(accent, glow, number, headlights);
  }

  // ---------------------------------------------------------------------------
  _mesh(geo, mat, x = 0, y = 0, z = 0, parent = this.body) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    parent.add(m);
    return m;
  }

  _build(accent, glow, number, headlights) {
    sharedGlow ??= radialGlowTexture(0.0, 1.8);
    sharedTire ??= tireTexture();
    const spec = this.spec;
    const P = (pts) => makeProfile(pts);

    // ---- Materials ----------------------------------------------------------------------------------------
    const paintMat = new THREE.MeshPhysicalMaterial({ color: this._paint, metalness: 0.55, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.06 });
    this.paintMat = paintMat;
    const glass = new THREE.MeshPhysicalMaterial({ color: 0x0b1118, metalness: 0.2, roughness: 0.04, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 1.7 });
    const trim = new THREE.MeshStandardMaterial({ color: 0x111316, metalness: 0.25, roughness: 0.65 });
    const darkMetal = new THREE.MeshStandardMaterial({ color: 0x2a2d33, metalness: 0.85, roughness: 0.4 });
    const chrome = new THREE.MeshStandardMaterial({ color: 0xc8ccd2, metalness: 1, roughness: 0.16 });
    const accentMat = new THREE.MeshStandardMaterial({ color: accent, metalness: 0.3, roughness: 0.5 });
    this.trim = trim;

    // ---- Body + greenhouse --------------------------------------------------------------------------------
    const bTop = P(spec.body.top), bBot = P(spec.body.bottom), bW = P(spec.body.width);
    const [bf0, bf1] = bTop.range;
    this.bodyProf = { top: bTop, bottom: bBot, width: bW, n: spec.body.n };
    const bodyGeo = loft({ f0: bf0, f1: bf1, top: bTop, bottom: bBot, width: bW, n: spec.body.n, stations: 56, ring: 30 });
    const bodyMesh = this._mesh(bodyGeo, paintMat);
    bodyMesh.updateMatrixWorld(true);
    // Surface probe: fire a ray at the body shell to find where (and facing which way) to attach lamps, mirrors,
    // arches — works for every silhouette without hand-placed coordinates.
    const rc = new THREE.Raycaster();
    const surf = (o, d) => {
      rc.set(o, d.normalize());
      const h = rc.intersectObject(bodyMesh, false)[0];
      if (!h) return null;
      const n = h.face.normal.clone();
      if (n.dot(d) > 0) n.negate();
      return { p: h.point.clone(), n };
    };
    const V = (x, y, z) => new THREE.Vector3(x, y, z);
    const attach = (obj, hit, off = 0.004, parent = this.body) => {
      obj.position.copy(hit.p).addScaledVector(hit.n, off);
      obj.lookAt(_tmpV.copy(obj.position).add(hit.n));
      parent.add(obj);
      return obj;
    };

    const cRoof = P(spec.cabin.roof), cW = P(spec.cabin.width);
    const [cf0, cf1] = cRoof.range;
    this.roofProf = cRoof;
    const cabinGeo = loft({
      f0: cf0, f1: cf1, n: spec.cabin.n, stations: 40, ring: 28, endRound: 0.06,
      top: cRoof, bottom: (f) => bTop(f) - 0.03, width: cW,
      // Flat roof panel gets body paint; sloped windshield/rear glass and the side glass stay dark.
      groupFn: (f, t) => (Math.sin(t * Math.PI * 2) > 0.8 && Math.abs(cRoof.slope(f)) < 0.3 ? 1 : 0),
    });
    this._mesh(cabinGeo, [glass, paintMat]);

    // Skid plate / underbody
    this._mesh(new THREE.BoxGeometry(1.5, 0.08, bf1 - bf0 - 0.5), trim, 0, bBot(0) - 0.02, -(bf0 + bf1) / 2);

    const nose = bf1, tail = bf0;
    const yAt = (f, frac) => bBot(f) + (bTop(f) - bBot(f)) * frac;
    const sideX = (f, y) => halfWidthAt(bW(f), spec.body.n, (y - bBot(f)) / Math.max(0.05, bTop(f) - bBot(f)));

    // Rocker panels + accent stripe + door number roundels
    this.numberMats = [];
    for (const s of [-1, 1]) {
      this._mesh(new THREE.BoxGeometry(0.07, 0.085, 2.3), trim, s * (bW(0) - 0.045), bBot(0) + 0.06, 0.1);
      const stripeY = yAt(-0.1, 0.42);
      this._mesh(new THREE.BoxGeometry(0.014, 0.045, 1.9), accentMat, s * (sideX(-0.1, stripeY) + 0.004), stripeY, 0.1);
      const decalMat = new THREE.MeshBasicMaterial({ map: numberTexture(number), transparent: true, toneMapped: true, polygonOffset: true, polygonOffsetFactor: -2 });
      this.numberMats.push(decalMat);
      const decal = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.4), decalMat);
      const dy = yAt(0.15, 0.62);
      decal.position.set(s * (sideX(0.15, dy) + 0.006), dy, -0.15);
      decal.rotation.y = s * Math.PI / 2;
      this.body.add(decal);
      // Door mirror on the shoulder at the base of the A-pillar: short arm + egg-shaped housing + mirror glass.
      const fm = cf1 - 0.32;
      const mh = surf(V(s * 2, bTop(fm) - 0.04, -fm), V(-s, 0, 0));
      if (mh) {
        const arm = this._mesh(new THREE.BoxGeometry(0.12, 0.022, 0.05), trim, mh.p.x + s * 0.05, mh.p.y + 0.035, mh.p.z);
        arm.rotation.z = s * 0.35;
        const housing = this._mesh(new THREE.SphereGeometry(1, 14, 10), paintMat, mh.p.x + s * 0.13, mh.p.y + 0.075, mh.p.z + 0.02);
        housing.scale.set(0.075, 0.05, 0.045);
        const mglass = this._mesh(new THREE.CircleGeometry(1, 16), glass, mh.p.x + s * 0.13, mh.p.y + 0.075, mh.p.z + 0.063);
        mglass.scale.set(0.066, 0.042, 1);
      }
      // Greenhouse definition: body-coloured B-pillar and a chrome belt line under the side glass.
      const cabBot = (f) => bTop(f) - 0.03;
      const cabX = (f, t) => halfWidthAt(cW(f), spec.cabin.n, t);
      const fb = cf0 + (cf1 - cf0) * (spec.cabin.bPillar ?? 0.42);
      const pillarPts = [];
      for (let t = 0.04; t <= 0.9; t += 0.086) pillarPts.push(V(s * (cabX(fb, t) + 0.006), cabBot(fb) + (cRoof(fb) - cabBot(fb)) * t, -fb));
      this._mesh(ribbonGeo(pillarPts, V(0, 0, 0.055), V(s, 0, 0)), paintMat);
      const beltPts = [];
      for (let f = cf0 + 0.12; f <= cf1 - 0.14; f += (cf1 - cf0) / 24) beltPts.push(V(s * (cabX(f, 0.05) + 0.007), cabBot(f) + (cRoof(f) - cabBot(f)) * 0.05, -f));
      this._mesh(ribbonGeo(beltPts, V(0, 0.012, 0), V(s, 0, 0)), chrome);
    }

    // ---- Front & rear fascia: grille, lamps ------------------------------------------------------------------
    this.headMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.97, 0.9).multiplyScalar(2.2), toneMapped: false });
    this.tailMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.04, 0.05).multiplyScalar(2), toneMapped: false });
    this.frontPiece = new THREE.Group();
    this.body.add(this.frontPiece);
    const noseY = yAt(nose - 0.15, 0.5);
    const grilleW = Math.min(1.0, bW(nose - 0.2) * 1.2);
    this._mesh(new THREE.BoxGeometry(grilleW, 0.14, 0.1), trim, 0, noseY - 0.02, -(nose - 0.06), this.frontPiece);
    const lampGlass = new THREE.MeshPhysicalMaterial({ color: 0x06080a, metalness: 0.7, roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.03 });
    const unit = (w, h) => new THREE.Mesh(new THREE.CircleGeometry(1, 28).scale(w, h, 1), lampGlass);
    for (const s of [-1, 1]) {
      // Headlight: glossy black housing on the body surface, twin projector lenses, LED DRL with an outer hook.
      const hy = yAt(nose - 0.4, 0.7);
      const hh = surf(V(s * bW(nose - 0.4) * 0.6, hy, -(nose + 1.5)), V(0, 0, 1));
      if (hh) {
        const g = attach(new THREE.Group(), hh, 0.006, this.frontPiece);
        g.add(unit(0.2, 0.072));
        for (const lx of [-0.075, 0.035]) {
          const lens = new THREE.Mesh(new THREE.CircleGeometry(0.03, 18), this.headMat);
          lens.position.set(lx * -s, -0.008, 0.002);
          g.add(lens);
        }
        const drl = new THREE.Mesh(new THREE.PlaneGeometry(0.32, 0.016), this.headMat);
        drl.position.set(0, 0.048, 0.003);
        g.add(drl);
        const hook = new THREE.Mesh(new THREE.PlaneGeometry(0.016, 0.07), this.headMat);
        hook.position.set(-s * 0.158, 0.018, 0.003);
        g.add(hook);
      }
      // Tail lamp: black housing + red LED strips (the centre light bar below joins them).
      const ty = yAt(tail + 0.2, 0.74);
      const th = surf(V(s * bW(tail + 0.2) * 0.62, ty, -tail + 1.5), V(0, 0, -1));
      if (th) {
        const g = attach(new THREE.Group(), th, 0.006);
        g.add(unit(0.2, 0.06));
        for (const ly of [0.022, -0.018]) {
          const strip = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.014), this.tailMat);
          strip.position.set(0, ly, 0.003);
          g.add(strip);
        }
      }
    }
    // License plate recesses (front + rear) — small detail that sells "real car"
    const plateMat = new THREE.MeshStandardMaterial({ color: 0xd9dbd6, roughness: 0.5, metalness: 0.2 });
    const fp = surf(V(0, yAt(nose - 0.1, 0.35), -(nose + 1.5)), V(0, 0, 1));
    if (fp) attach(new THREE.Mesh(new THREE.PlaneGeometry(0.44, 0.1), plateMat), fp, 0.008, this.frontPiece);
    const rp = surf(V(0, yAt(tail + 0.1, 0.42), -tail + 1.5), V(0, 0, -1));
    if (rp) attach(new THREE.Mesh(new THREE.PlaneGeometry(0.44, 0.1), plateMat), rp, 0.008);
    this._surf = surf;
    const tailY = yAt(tail + 0.12, 0.72);
    this._mesh(new THREE.BoxGeometry(bW(tail + 0.15) * 1.7, 0.05, 0.05), this.tailMat, 0, tailY, -(tail + 0.02));
    this._mesh(new THREE.BoxGeometry(bW(tail + 0.15) * 1.75, 0.13, 0.06), trim, 0, tailY, -(tail + 0.05));
    // Exhaust tips
    const pipeGeo = new THREE.CylinderGeometry(0.06, 0.065, 0.2, 14).rotateX(Math.PI / 2);
    this._exhaustNormal = new THREE.Color(0x1a1512);
    this._exhaustBoost = new THREE.Color(0.55, 0.85, 1).multiplyScalar(3.6);
    this.exhaustMat = new THREE.MeshBasicMaterial({ color: this._exhaustNormal.clone(), toneMapped: false });
    for (const s of [-1, 1]) {
      const px = s * 0.55, py = bBot(tail + 0.2) + 0.04;
      this._mesh(pipeGeo, chrome, px, py, -(tail - 0.02));
      const inner = new THREE.Mesh(new THREE.CircleGeometry(0.048, 14), this.exhaustMat);
      inner.position.set(px, py, -(tail - 0.125));
      inner.rotation.y = Math.PI;
      this.body.add(inner);
    }

    // ---- Type-specific extras -------------------------------------------------------------------------------
    this.aero = new THREE.Group(); // spoilers/wings — can droop when damaged
    this.body.add(this.aero);
    const ex = {
      spoilerGT: () => {
        const wing = this._mesh(new THREE.BoxGeometry(1.7, 0.035, 0.32), darkMetal, 0, bTop(tail + 0.3) + 0.28, -(tail + 0.3), this.aero);
        wing.rotation.x = 0.08;
        for (const s of [-1, 1]) {
          this._mesh(new THREE.BoxGeometry(0.04, 0.26, 0.14), darkMetal, s * 0.5, bTop(tail + 0.3) + 0.15, -(tail + 0.3), this.aero);
          this._mesh(new THREE.BoxGeometry(0.03, 0.18, 0.4), darkMetal, s * 0.86, bTop(tail + 0.3) + 0.28, -(tail + 0.3), this.aero);
        }
      },
      splitter: () => this._mesh(new THREE.BoxGeometry(bW(nose - 0.2) * 1.8, 0.03, 0.22), trim, 0, bBot(nose - 0.15) + 0.015, -(nose - 0.12), this.frontPiece),
      diffuser: () => this._mesh(new THREE.BoxGeometry(1.4, 0.1, 0.3), trim, 0, bBot(tail + 0.1) + 0.02, -(tail + 0.1)),
      hoodVent: () => this._mesh(new THREE.BoxGeometry(0.5, 0.02, 0.5), trim, 0, bTop(1.2) + 0.008, -1.2),
      hoodScoop: () => {
        const scoop = this._mesh(new THREE.BoxGeometry(0.44, 0.13, 0.62), paintMat, 0, bTop(1.3) + 0.06, -1.3);
        scoop.rotation.x = 0.1;
        this._mesh(new THREE.BoxGeometry(0.36, 0.09, 0.05), trim, 0, bTop(1.3) + 0.06, -1.61);
      },
      ducktail: () => this._mesh(new THREE.BoxGeometry(1.5, 0.05, 0.3), paintMat, 0, bTop(tail + 0.3) + 0.04, -(tail + 0.3), this.aero),
      racingStripes: () => {
        for (const s of [-1, 1]) {
          const hood = this._mesh(new THREE.BoxGeometry(0.17, 0.006, 1.7), accentMat, s * 0.13, bTop(1.4) + 0.006, -1.45);
          hood.castShadow = false;
          const roof = this._mesh(new THREE.BoxGeometry(0.17, 0.006, 0.9), accentMat, s * 0.13, spec.cabin.roof[2][1] + 0.005, 0.35);
          roof.castShadow = false;
        }
      },
      bumperBar: () => this._mesh(new THREE.BoxGeometry(1.5, 0.07, 0.07), chrome, 0, bBot(nose - 0.1) + 0.12, -(nose + 0.02), this.frontPiece),
      roofRails: () => {
        for (const s of [-1, 1]) this._mesh(new THREE.BoxGeometry(0.05, 0.05, 2.3), darkMetal, s * cW(-0.4) * 0.8, cRoof(-0.4) + 0.06, 0.45);
      },
      bullBar: () => {
        const bx = 0.5;
        for (const s of [-1, 1]) this._mesh(new THREE.BoxGeometry(0.06, 0.5, 0.06), darkMetal, s * bx, bBot(nose) + 0.28, -(nose + 0.08), this.frontPiece);
        this._mesh(new THREE.BoxGeometry(1.1, 0.06, 0.06), darkMetal, 0, bBot(nose) + 0.52, -(nose + 0.08), this.frontPiece);
        this._mesh(new THREE.BoxGeometry(1.1, 0.06, 0.06), darkMetal, 0, bBot(nose) + 0.1, -(nose + 0.08), this.frontPiece);
      },
      sideSteps: () => {
        for (const s of [-1, 1]) this._mesh(new THREE.BoxGeometry(0.16, 0.035, 1.6), darkMetal, s * (bW(0) + 0.02), bBot(0) + 0.05, -0.1);
      },
      roofLightBar: () => {
        this._mesh(new THREE.BoxGeometry(0.9, 0.05, 0.09), trim, 0, cRoof(0.6) + 0.04, -0.6);
        this._mesh(new THREE.BoxGeometry(0.85, 0.028, 0.02), this.headMat, 0, cRoof(0.6) + 0.055, -0.65);
      },
      bedWalls: () => {
        const len = -0.6 - tail; // bed spans f in [tail, -0.6]
        const cz = -(tail + (-0.6 - tail) / 2);
        const wy = bTop(-1.3) + 0.14;
        for (const s of [-1, 1]) this._mesh(new THREE.BoxGeometry(0.06, 0.28, len), paintMat, s * (bW(-1.3) - 0.03), wy, cz);
        this._mesh(new THREE.BoxGeometry(bW(-1.3) * 2 - 0.05, 0.28, 0.06), paintMat, 0, wy, -(tail + 0.03));
        this._mesh(new THREE.BoxGeometry(bW(-1.3) * 2 - 0.05, 0.28, 0.06), paintMat, 0, wy, -(-0.6 - 0.03));
      },
      rollBar: () => {
        const y0 = bTop(-0.7) + 0.02;
        for (const s of [-1, 1]) this._mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.52, 8), darkMetal, s * 0.72, y0 + 0.26, 0.85);
        this._mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.44, 8).rotateZ(Math.PI / 2), darkMetal, 0, y0 + 0.52, 0.85);
      },
      roofWing: () => {
        const wing = this._mesh(new THREE.BoxGeometry(1.35, 0.035, 0.34), darkMetal, 0, cRoof(-1.55) + 0.14, 1.72, this.aero);
        wing.rotation.x = -0.1;
        for (const s of [-1, 1]) this._mesh(new THREE.BoxGeometry(0.04, 0.14, 0.2), darkMetal, s * 0.5, cRoof(-1.55) + 0.06, 1.72, this.aero);
      },
      rallyLights: () => {
        for (const s of [-0.34, -0.12, 0.12, 0.34]) {
          this._mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.06, 12).rotateX(Math.PI / 2), trim, s, bTop(1.7) + 0.04, -1.72);
          this._mesh(new THREE.CircleGeometry(0.045, 12), this.headMat, s, bTop(1.7) + 0.04, -1.755);
        }
      },
      mudflaps: () => {
        for (const s of [-1, 1]) this._mesh(new THREE.BoxGeometry(0.02, 0.2, 0.22), trim, s * 0.88, bBot(-1.4) - 0.05, 1.72);
      },
    };
    for (const name of spec.extras) ex[name]?.();

    // ---- Remote weapon station: low-profile, bolted flat onto the roof (see WeaponStation.js) --------------------
    const mount = stationMount(this.type);
    const station = buildWeaponStation({
      armor: new THREE.MeshStandardMaterial({ color: 0x3a3e43, metalness: 0.55, roughness: 0.48 }),
      gunmetal: new THREE.MeshStandardMaterial({ color: 0x2c2f34, metalness: 0.9, roughness: 0.32 }),
      dark: trim,
      accent: accentMat,
      can: new THREE.MeshStandardMaterial({ color: 0x4a5139, metalness: 0.35, roughness: 0.6 }),
      glass: new THREE.MeshPhysicalMaterial({ color: 0x0a1620, metalness: 0.3, roughness: 0.05, clearcoat: 1, envMapIntensity: 2 }),
      lens: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.25, 0.75, 1).multiplyScalar(1.4), toneMapped: false }),
    }, (geo, mat, x, y, z, parent) => this._mesh(geo, mat, x, y, z, parent));
    station.root.position.set(0, mount.y - 0.005, -mount.f);
    station.root.scale.setScalar(STATION.scale);
    this.body.add(station.root);
    this.turret = station.root;
    this.swivel = station.swivel;
    this.recoil = station.recoil;
    this.variants = station.variants;
    this.muzzleGroup = station.muzzle;
    this._spinAngle = 0;
    this.spinRate = 0;
    this._recoilKick = 0;
    this._kickScale = 1;
    const swivel = station.swivel;
    // Muzzle flash (additive sprite — no dynamic light so 4 cars don't burn shader cost)
    this.muzzleFlash = new THREE.Sprite(new THREE.SpriteMaterial({
      map: sharedGlow, color: new THREE.Color(1, 0.72, 0.35).multiplyScalar(3.5), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    }));
    this.muzzleFlash.position.z = -0.18;
    this.muzzleFlash.scale.setScalar(0.01);
    station.muzzle.add(this.muzzleFlash);

    // ---- Secondary hardpoints (shown per equipped weapon) --------------------------------------------------
    this.loadout = {};
    const podMat = new THREE.MeshStandardMaterial({ color: 0x5b6349, metalness: 0.6, roughness: 0.5 });
    const mk = (name, parent = this.body) => { const g = new THREE.Group(); g.visible = false; parent.add(g); this.loadout[name] = g; return g; };
    {
      const g = mk('missile'); // twin rear-roof missile pods
      const ry = cRoof(-0.7) + 0.09;
      for (const s of [-1, 1]) {
        this._mesh(new THREE.BoxGeometry(0.2, 0.18, 0.78), podMat, s * 0.46, ry, 0.72, g);
        this._mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.06, 10).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xe0762a, roughness: 0.5 }), s * 0.46, ry, 0.3, g);
      }
    }
    {
      const g = mk('mine'); // rear mine dispenser
      this._mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.42, 14).rotateX(Math.PI / 2), darkMetal, 0, bBot(tail + 0.2) + 0.13, -(tail - 0.1), g);
      this._mesh(new THREE.CylinderGeometry(0.115, 0.115, 0.05, 14).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xc23a30, roughness: 0.5 }), 0, bBot(tail + 0.2) + 0.13, -(tail - 0.28), g);
    }
    {
      const g = mk('scatter', swivel); // flak pod on the cradle roof: 2x2 short launch tubes in a frame
      const podBody = new THREE.MeshStandardMaterial({ color: 0x4a4f45, metalness: 0.5, roughness: 0.55 });
      this._mesh(new THREE.BoxGeometry(0.22, 0.16, 0.36), podBody, 0, 0.33, -0.02, g);
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
        this._mesh(new THREE.CylinderGeometry(0.038, 0.038, 0.12, 12).rotateX(Math.PI / 2), darkMetal, sx * 0.055, 0.33 + sy * 0.042, -0.24, g);
      }
      this._mesh(new THREE.BoxGeometry(0.23, 0.02, 0.1), new THREE.MeshStandardMaterial({ color: 0xd99b2b, roughness: 0.5 }), 0, 0.42, -0.12, g);
    }
    {
      const g = mk('laser', swivel); // sleek emitter module with cooling fins + glowing aperture
      const shell = new THREE.MeshStandardMaterial({ color: 0xd4d8dd, metalness: 0.6, roughness: 0.25 });
      this._mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.5, 16).rotateX(Math.PI / 2), shell, 0, 0.32, -0.12, g);
      for (let i = 0; i < 5; i++) this._mesh(new THREE.BoxGeometry(0.17, 0.012, 0.03), darkMetal, 0, 0.32, 0.02 - i * 0.05, g);
      this._mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.02, 16).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.3, 0.85, 1).multiplyScalar(2.4), toneMapped: false }), 0, 0.32, -0.375, g);
    }

    // ---- Head / brake light housings: real headlight beam only on the player's car ----------------------------
    if (headlights) {
      const spot = new THREE.SpotLight(0xfff2dc, 40, 60, 0.42, 0.85, 1.4);
      spot.position.set(0, 0.15, -(nose - 0.2));
      spot.target.position.set(0, -1.2, -(nose + 12));
      this.body.add(spot, spot.target);
      this.headlight = spot;
    }

    // ---- Contact shadow blob (replaces neon underglow) ----------------------------------------------------------
    this.underglowMat = new THREE.MeshBasicMaterial({
      map: sharedGlow, color: 0x000000, transparent: true, opacity: 0.55, depthWrite: false, fog: false,
    });
    const sh = new THREE.Mesh(new THREE.PlaneGeometry(2.7, 5.4), this.underglowMat);
    sh.rotation.x = -Math.PI / 2;
    sh.position.y = -0.62;
    sh.renderOrder = 2;
    this.body.add(sh);

    // ---- Wheels ---------------------------------------------------------------------------------------------------
    this._wellMat = new THREE.MeshStandardMaterial({ color: 0x050506, roughness: 0.95, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 });
    this._buildWheels(spec.wheelTrim, chrome, darkMetal, bW, bTop, bBot, spec.body.n);

    // ---- Batch: collapse the dozens of static parts into one mesh per material per rigid group -------------------
    const loadoutGroups = Object.values(this.loadout);
    mergeStatic(this.body, new Set([this.frontPiece, this.aero, station.root, ...loadoutGroups]));
    mergeStatic(this.frontPiece);
    mergeStatic(this.aero);
    mergeStatic(station.root, new Set([station.swivel]));
    mergeStatic(station.swivel, new Set([station.recoil, ...loadoutGroups]));
    const variantGroups = ['cannon', 'minigun', 'shotgun', 'sniper', 'breacher', 'flame'].map((k) => station.variants[k]);
    mergeStatic(station.recoil, new Set([station.muzzle, ...variantGroups]));
    for (const g of variantGroups) mergeStatic(g, new Set([station.variants.minigunSpinner]));
    mergeStatic(station.variants.minigunSpinner);
    for (const g of loadoutGroups) mergeStatic(g);
    for (const w of this.wheelGroups) {
      mergeStatic(w.spin);
      mergeStatic(w.steer, new Set([w.spin]));
    }
  }

  _buildWheels(trimKind, chrome, darkMetal, bW, bTop, bBot, bodyN) {
    const r = this.cfg.wheelRadius;
    const W = this.cfg.wheelWidth;
    const styles = {
      sport: { rim: 0x8f949c, spokes: 5, double: true, caliper: 0xc9251c, rimR: 0.66 },
      muscle: { rim: 0xc4c8ce, spokes: 5, double: false, caliper: 0x1c1f24, rimR: 0.7 },
      offroad: { rim: 0x2b2e33, spokes: 6, double: false, caliper: 0xd1a51a, rimR: 0.6 },
      rally: { rim: 0xc7a13a, spokes: 6, double: true, caliper: 0xd8dade, rimR: 0.64 },
    };
    const st = styles[trimKind] ?? styles.sport;
    const tireMat = new THREE.MeshStandardMaterial({ color: 0xffffff, map: sharedTire, roughness: 0.92, metalness: 0 });
    const sideMat = new THREE.MeshStandardMaterial({ color: 0x141517, roughness: 0.85 });
    const rimMat = new THREE.MeshStandardMaterial({ color: st.rim, metalness: 0.95, roughness: 0.24 });
    const rimBaseMat = new THREE.MeshStandardMaterial({ color: 0x17191c, metalness: 0.6, roughness: 0.5 });
    const discMat = new THREE.MeshStandardMaterial({ color: 0x6b6f76, metalness: 0.9, roughness: 0.4 });
    const caliperMat = new THREE.MeshStandardMaterial({ color: st.caliper, metalness: 0.4, roughness: 0.4 });
    const tireGeo = new THREE.CylinderGeometry(r, r, W, 36, 1).rotateZ(Math.PI / 2);
    const rimGeo = new THREE.CylinderGeometry(r * st.rimR, r * st.rimR, W * 0.22, 28).rotateZ(Math.PI / 2);
    const lipGeo = new THREE.TorusGeometry(r * st.rimR, 0.018, 8, 40).rotateY(Math.PI / 2);
    const spokeGeo = new THREE.BoxGeometry(0.05, r * st.rimR * 1.95, st.double ? 0.045 : 0.075);
    const discGeo = new THREE.CylinderGeometry(r * 0.5, r * 0.5, 0.035, 26).rotateZ(Math.PI / 2);
    const hubGeo = new THREE.CylinderGeometry(0.07, 0.07, 0.1, 12).rotateZ(Math.PI / 2);
    const caliperGeo = new THREE.BoxGeometry(0.06, 0.2, 0.14);

    this.wheelGroups = [];
    for (const w of this.cfg.wheels) {
      const outer = Math.sign(w.pos[0]);
      const g = new THREE.Group();
      const visX = w.pos[0] * 0.93; // tuck the visual wheel toward the fender line
      g.position.set(visX, w.pos[1], w.pos[2]);
      const steer = new THREE.Group();
      const spin = new THREE.Group();
      g.add(steer);
      steer.add(spin);
      const tire = new THREE.Mesh(tireGeo, [tireMat, sideMat, sideMat]);
      tire.castShadow = true;
      spin.add(tire);
      const rim = new THREE.Mesh(rimGeo, rimBaseMat); // dark recessed barrel; the bright part is the lip + spokes
      rim.position.x = outer * W * 0.36;
      spin.add(rim);
      const lip = new THREE.Mesh(lipGeo, rimMat);
      lip.position.x = outer * W * 0.5;
      spin.add(lip);
      for (let k = 0; k < st.spokes; k++) {
        const spoke = new THREE.Mesh(spokeGeo, rimMat);
        spoke.position.x = outer * W * 0.5;
        spoke.rotation.x = (k / st.spokes) * Math.PI;
        spin.add(spoke);
        if (st.double) {
          const s2 = spoke.clone();
          s2.rotation.x += 0.16;
          spin.add(s2);
        }
      }
      const hub = new THREE.Mesh(hubGeo, darkMetal);
      hub.position.x = outer * W * 0.52;
      spin.add(hub);
      // Brake disc rotates with the wheel; the caliper stays with the steering knuckle.
      const disc = new THREE.Mesh(discGeo, discMat);
      disc.position.x = outer * W * 0.18;
      spin.add(disc);
      const caliper = new THREE.Mesh(caliperGeo, caliperMat);
      caliper.position.set(outer * W * 0.16, r * 0.3, w.front ? -r * 0.1 : r * 0.1);
      steer.add(caliper);
      this.root.add(g);
      this.wheelGroups.push({ g, steer, spin, front: w.front, baseY: w.pos[1] });

      // Wheel arch: a dark well band on the body side around the upper tyre (reads as a cut-out arch), plus a thin
      // paint-coloured lip on its outer edge. Placed on the actual body skin found by ray cast.
      const restY = w.pos[1] - (this.cfg.suspTravel - 0.125);
      const hit = this._surf(new THREE.Vector3(outer * 2, restY + r * 0.6, w.pos[2]), new THREE.Vector3(-outer, 0, 0));
      const skinX = hit ? Math.abs(hit.p.x) : Math.abs(visX) + W * 0.5;
      const well = new THREE.Mesh(new THREE.RingGeometry(r * 0.99, r + 0.09, 32, 1, 0, Math.PI), this._wellMat);
      well.position.set(outer * (skinX + 0.004), restY, w.pos[2]);
      well.rotation.y = outer * Math.PI / 2;
      this.body.add(well);
      const archLip = new THREE.Mesh(new THREE.TorusGeometry(r + 0.095, 0.014, 6, 30, Math.PI).rotateY(Math.PI / 2), this.paintMat);
      archLip.position.set(outer * (skinX + 0.006), restY, w.pos[2]);
      this.body.add(archLip);
    }
  }

  // ---------------------------------------------------------------------------
  /** Sync visuals with the (interpolated) physics state. */
  update(pos, quat, vehicle, dt) {
    this.root.position.copy(pos);
    this.root.quaternion.copy(quat);
    for (let i = 0; i < this.wheelGroups.length; i++) {
      const wg = this.wheelGroups[i];
      const ws = vehicle.wheels[i];
      wg.g.position.y = wg.baseY - ws.suspLen;
      wg.steer.rotation.y = wg.front ? -vehicle.steer : 0;
      wg.spin.rotation.x = -ws.spin;
    }
    const braking = vehicle.brake > 0.05 || vehicle.handbrake || vehicle.drive < 0;
    this.brakeLight += ((braking ? 1 : 0) - this.brakeLight) * Math.min(1, dt * 18);
    if (this._wrecked) {
      this._wreckTime += dt;
      this.tailMat.color.setRGB(0.02, 0, 0);
      this.headMat.color.setRGB(0.03, 0.03, 0.03);
    } else {
      const flick = this._damage.pct < 0.3 && Math.random() < (0.3 - this._damage.pct) * 0.6 ? 0.15 : 1;
      this.tailMat.color.setRGB(1, 0.03, 0.05).multiplyScalar((1.6 + this.brakeLight * 4.4) * flick);
      this.headMat.color.setRGB(1, 0.97, 0.9).multiplyScalar(2.2 * flick);
    }

    // Contact shadow tightens/fades with ride height
    const grounded = vehicle.wheels.reduce((s, w) => s + (w.grounded ? 1 : 0), 0) / 4;
    const target = 0.15 + grounded * 0.45;
    this.underglowMat.opacity += (target - this.underglowMat.opacity) * Math.min(1, dt * 6);

    // Afterburner glow in the tailpipes while boosting
    this._boostGlow += ((vehicle.boosting ? 1 : 0) - this._boostGlow) * Math.min(1, dt * 10);
    this.exhaustMat.color.copy(this._exhaustNormal).lerp(this._exhaustBoost, this._boostGlow);

    // Cannon recoil: sharp kick back, spring return
    this._recoilKick = Math.max(0, this._recoilKick - dt * 0.9);
    this.recoil.position.z = this._recoilKick * this._kickScale;
    if (this.spinRate > 0.02 || this._spinAngle % (Math.PI / 3) > 0.01) {
      this._spinAngle += dt * (this.spinRate * 42);
      this.variants.minigunSpinner.rotation.z = this._spinAngle;
    }

    if (this._muzzleFlashDecay > 0) {
      this._muzzleFlashDecay = Math.max(0, this._muzzleFlashDecay - dt);
      const k = this._muzzleFlashDecay / 0.06;
      this.muzzleFlash.scale.setScalar(0.25 + 1.1 * k);
      this.muzzleFlash.material.opacity = k;
    } else {
      this.muzzleFlash.scale.setScalar(0.001);
    }
  }

  /**
   * Destroyed state: burnt-out shell (charred, glowing embers that cool over time), lamps dead, the weapon station
   * knocked askew, the spoiler bent, and the wheels in `lost` torn off (Effects throws them as debris).
   */
  setWrecked(on, lost = []) {
    if (on === !!this._wrecked && !on) return;
    this._wrecked = on;
    this._wreckTime = 0;
    this.wheelGroups.forEach((w, i) => { w.g.visible = !on || !lost.includes(i); });
    this.swivel.rotation.set(on ? -0.28 : 0, on ? (Math.random() - 0.5) * 1.2 : 0, on ? 0.22 : 0);
    this.aero.rotation.set(on ? 0.35 : 0, 0, on ? 0.3 : 0);
    this.aero.position.y = on ? -0.12 : 0;
    this.frontPiece.rotation.x = on ? 0.35 : 0;
    this.frontPiece.position.y = on ? -0.08 : 0;
    this.muzzleFlash.scale.setScalar(0.001);
    if (this.headlight) {
      if (on) { this._hlIntensity = this.headlight.intensity; this.headlight.intensity = 0; }
      else if (this._hlIntensity !== undefined) this.headlight.intensity = this._hlIntensity;
    }
    if (!on) {
      this.paintMat.emissive.setRGB(0, 0, 0);
      this.trim.color.setHex(0x111316);
    } else {
      this.trim.color.setHex(0x0a0a0a);
    }
  }

  get wrecked() {
    return !!this._wrecked;
  }

  /** World position of wheel i (for throwing it as debris). */
  wheelWorld(i, out) {
    return this.wheelGroups[i].g.getWorldPosition(out);
  }

  /** Fake damage: soot-darkened paint, drooping aero/fascia, flickering lamps, embers when nearly dead. */
  setDamage(pct, time) {
    if (this._wrecked) {
      // Burnt shell: near-black, matte; embers glow orange in patches and slowly cool.
      const m = this.paintMat;
      m.color.copy(this._paint).lerp(SOOT, 0.93);
      m.roughness = 0.95;
      m.clearcoat = 0;
      const cool = Math.max(0, 1 - this._wreckTime / 4);
      const flick = 0.55 + 0.45 * Math.sin(time * 11) * Math.sin(time * 7.3);
      m.emissive.setRGB(0.5, 0.1, 0.015).multiplyScalar(cool * flick * 0.28);
      return;
    }
    this._damage.pct = pct;
    const k = 1 - pct;
    const m = this.paintMat;
    m.color.copy(this._paint).lerp(SOOT, Math.min(0.85, k * 0.8));
    m.roughness = 0.32 + k * 0.45;
    m.clearcoat = Math.max(0.1, 1 - k * 1.1);
    if (pct < 0.2 && pct > 0) {
      const glow = (0.2 - pct) / 0.2;
      m.emissive.setRGB(0.5, 0.12, 0.02).multiplyScalar(glow * (0.55 + 0.45 * Math.sin(time * 9)));
    } else {
      m.emissive.setRGB(0, 0, 0);
    }
    const droop = pct < 0.6 ? (0.6 - pct) / 0.6 : 0;
    this.aero.rotation.z = droop * 0.22;
    this.aero.position.y = -droop * 0.05;
    this.frontPiece.rotation.x = pct < 0.4 ? (0.4 - pct) * 0.5 : 0;
    this.frontPiece.position.y = pct < 0.4 ? -(0.4 - pct) * 0.1 : 0;
  }

  /** Show the hardpoint model for the equipped secondary weapon (or none). */
  setLoadout(kind) {
    if (this._loadoutKind === kind) return;
    this._loadoutKind = kind;
    for (const [k, g] of Object.entries(this.loadout)) g.visible = k === kind;
  }

  /** Repaint the door roundel number (e.g. a different driver). */
  setNumber(number) {
    for (const mat of this.numberMats) {
      mat.map?.dispose();
      mat.map = numberTexture(number);
      mat.needsUpdate = true;
    }
  }

  /** Call once when the weapon fires — briefly lights the muzzle. */
  flashMuzzle(kind = 'bolt') {
    if (kind === 'flame') return; // the stream itself is the effect
    this._muzzleFlashDecay = kind === 'shell' ? 0.12 : kind === 'pellet' ? 0.09 : 0.06;
    this._recoilKick = kind === 'shell' ? 0.2 : kind === 'pellet' ? 0.11 : kind === 'beam' ? 0.13 : kind === 'spin' ? 0.02 : 0.06;
  }

  /** Show the barrel assembly for a primary weapon and re-seat the muzzle flash. */
  setPrimary(key) {
    if (this._primary === key) return;
    this._primary = key;
    const all = ['cannon', 'minigun', 'shotgun', 'sniper', 'breacher', 'flame'];
    for (const k of all) this.variants[k].visible = false;
    (this.variants[key] ?? this.variants.cannon).visible = true;
    const tip = { cannon: -1.14, minigun: -1.23, shotgun: -1.1, sniper: -1.36, breacher: -1.14, flame: -1.16 }[key] ?? -1.14;
    this.muzzleGroup.position.z = tip;
    const col = { sniper: [0.45, 0.85, 1.0], flame: [1.0, 0.5, 0.18], breacher: [1.0, 0.62, 0.3] }[key] ?? [1, 0.72, 0.35];
    this.muzzleFlash.material.color.setRGB(col[0] * 3.5, col[1] * 3.5, col[2] * 3.5);
    this._kickScale = key === 'minigun' ? 0.5 : 1;
  }

  dispose() {
    this.root.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const mt of mats) mt.dispose();
      }
    });
  }
}

