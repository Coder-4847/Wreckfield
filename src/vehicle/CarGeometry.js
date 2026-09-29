import * as THREE from 'three';

// Parametric car-body lofting. A body is a stack of superellipse cross-sections along the car's length whose
// width / bottom / top come from smooth profile curves (hood line, roofline, tumblehome, tapered nose & tail).
// Coordinates: `f` = distance forward of the car's center (mapped to -Z), y up, x right.

/** Smooth (cubic Hermite, finite-difference tangents) scalar profile through [f, value] points sorted by f. */
export function makeProfile(points) {
  const pts = [...points].sort((a, b) => a[0] - b[0]);
  const n = pts.length;
  const m = pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(n - 1, i + 1)];
    return (b[1] - a[1]) / (b[0] - a[0] || 1);
  });
  const fn = (f) => {
    if (f <= pts[0][0]) return pts[0][1];
    if (f >= pts[n - 1][0]) return pts[n - 1][1];
    let i = 0;
    while (i < n - 2 && f > pts[i + 1][0]) i++;
    const [f0, y0] = pts[i];
    const [f1, y1] = pts[i + 1];
    const h = f1 - f0;
    const t = (f - f0) / h;
    const t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * y0 + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * y1 + (t3 - t2) * h * m[i + 1];
  };
  fn.range = [pts[0][0], pts[n - 1][0]];
  fn.slope = (f) => (fn(f + 0.02) - fn(f - 0.02)) / 0.04;
  return fn;
}

const spow = (v, e) => Math.sign(v) * Math.pow(Math.abs(v), e);

/**
 * Loft a closed surface between f0 and f1.
 *  top(f), bottom(f): y extents; width(f): max half-width. `n` = superellipse exponent (2 = ellipse, 4 = boxy).
 *  `endRound` = fraction of the length over which the cross-section closes down to a point (rounded nose/tail).
 *  `groupFn(f, ringT)` may return a material index per quad (for multi-material lofts).
 */
export function loft({ f0, f1, top, bottom, width, n = 3.4, stations = 44, ring = 28, endRound = 0.045, groupFn = null }) {
  const pos = [];
  const uv = [];
  for (let j = 0; j <= stations; j++) {
    const u = j / stations;
    const f = f0 + (f1 - f0) * (0.5 - 0.5 * Math.cos(Math.PI * u)); // denser near the ends
    const edge = Math.min(u, 1 - u);
    let e = 1;
    if (edge < endRound) e = Math.sqrt(Math.max(0, 1 - Math.pow(1 - edge / endRound, 2)));
    const yt = top(f), yb = Math.min(bottom(f), yt - 0.02);
    const w = width(f) * e;
    const mid = (yt + yb) / 2;
    const hh = ((yt - yb) / 2) * e;
    for (let k = 0; k < ring; k++) {
      const phi = (k / ring) * Math.PI * 2;
      pos.push(w * spow(Math.cos(phi), 2 / n), mid + hh * spow(Math.sin(phi), 2 / n), -f);
      uv.push(u, k / ring);
    }
  }
  const idx = [];
  const groups = [];
  const ringOf = (j, k) => j * ring + (k % ring);
  let gStart = 0, gMat = null;
  for (let j = 0; j < stations; j++) {
    const u = (j + 0.5) / stations;
    const fMid = f0 + (f1 - f0) * (0.5 - 0.5 * Math.cos(Math.PI * u));
    for (let k = 0; k < ring; k++) {
      const a = ringOf(j, k), b = ringOf(j, k + 1), c = ringOf(j + 1, k), d = ringOf(j + 1, k + 1);
      const mat = groupFn ? groupFn(fMid, (k + 0.5) / ring) : 0;
      if (mat !== gMat) {
        if (gMat !== null) groups.push([gStart, idx.length - gStart, gMat]);
        gStart = idx.length;
        gMat = mat;
      }
      idx.push(a, c, b, b, c, d);
    }
  }
  if (gMat !== null) groups.push([gStart, idx.length - gStart, gMat]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  if (groupFn) for (const [s, c, m] of groups) g.addGroup(s, c, m);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

/** Half-width of a superellipse cross-section at a height fraction (0=bottom,1=top) — hugs decals to the body side. */
export function halfWidthAt(w, n, hFrac) {
  const s = hFrac * 2 - 1;
  return w * Math.pow(Math.max(0, 1 - Math.pow(Math.abs(s), n)), 1 / n);
}
