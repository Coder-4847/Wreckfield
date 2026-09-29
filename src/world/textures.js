import * as THREE from 'three';

// Procedural canvas textures. Everything is generated at load so the project ships with zero binary assets.

let maxAniso = 8;
export function setMaxAnisotropy(n) {
  maxAniso = n;
}

// ---------------------------------------------------------------------------
// Noise
// ---------------------------------------------------------------------------
function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createNoise(seed = 1) {
  const rnd = mulberry32(seed);
  const perm = new Uint8Array(256);
  for (let i = 0; i < 256; i++) perm[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [perm[i], perm[j]] = [perm[j], perm[i]];
  }
  const lat = (ix, iy, p) => {
    ix = ((ix % p) + p) % p;
    iy = ((iy % p) + p) % p;
    return perm[(perm[ix & 255] + iy) & 255] / 255;
  };
  // Tileable value noise: lattice wraps at `period`.
  const value = (x, y, p) => {
    const ix = Math.floor(x), iy = Math.floor(y);
    const fx = x - ix, fy = y - iy;
    const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
    const a = lat(ix, iy, p), b = lat(ix + 1, iy, p), c = lat(ix, iy + 1, p), d = lat(ix + 1, iy + 1, p);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  // u, v in [0,1): tileable fbm.
  const fbm = (u, v, period, octaves = 4, gain = 0.5) => {
    let sum = 0, amp = 0.5, norm = 0, p = period;
    for (let o = 0; o < octaves; o++) {
      sum += amp * value(u * p, v * p, p);
      norm += amp;
      amp *= gain;
      p *= 2;
    }
    return sum / norm;
  };
  return { rnd, value, fbm };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
export function canvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

export function tex(c, { srgb = true, repeat = [1, 1], wrap = true } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  if (wrap) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
  }
  t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = maxAniso;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

export function heightToNormal(h, w, hh, strength) {
  const c = canvas(w, hh);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, hh);
  const d = img.data;
  for (let y = 0; y < hh; y++) {
    for (let x = 0; x < w; x++) {
      const xl = (x - 1 + w) % w, xr = (x + 1) % w;
      const yu = (y - 1 + hh) % hh, yd = (y + 1) % hh;
      const dx = (h[y * w + xr] - h[y * w + xl]) * strength;
      const dy = (h[yd * w + x] - h[yu * w + x]) * strength;
      let nx = -dx, ny = dy, nz = 1;
      const l = Math.hypot(nx, ny, nz);
      nx /= l; ny /= l; nz /= l;
      const i = (y * w + x) * 4;
      d[i] = (nx * 0.5 + 0.5) * 255;
      d[i + 1] = (ny * 0.5 + 0.5) * 255;
      d[i + 2] = (nz * 0.5 + 0.5) * 255;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

export function hazardStripes(ctx, x, y, w, h, stripe = 24, colA = '#f5b400', colB = '#141018') {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.fillStyle = colB;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = colA;
  for (let i = -h; i < w + h; i += stripe * 2) {
    ctx.beginPath();
    ctx.moveTo(x + i, y + h);
    ctx.lineTo(x + i + h, y);
    ctx.lineTo(x + i + h + stripe, y);
    ctx.lineTo(x + i + stripe, y + h);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Surfaces
// ---------------------------------------------------------------------------

/** Tiled asphalt: albedo + normal. */
export function asphaltTextures(repeat) {
  const S = 512;
  const n = createNoise(7);
  const h = new Float32Array(S * S);
  const c = canvas(S);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(S, S);
  const d = img.data;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = x / S, v = y / S;
      const coarse = n.fbm(u, v, 8, 4);
      const fine = n.value(u * 128, v * 128, 128);
      let hv = coarse * 0.5 + fine * 0.5;
      let r = 58 + (coarse - 0.5) * 30 + (fine - 0.5) * 24;
      let g = 56 + (coarse - 0.5) * 28 + (fine - 0.5) * 22;
      let b = 55 + (coarse - 0.5) * 28 + (fine - 0.5) * 22;
      // Aggregate specks
      if (n.rnd() < 0.035) {
        const k = 12 + n.rnd() * 22;
        r += k; g += k; b += k * 1.1;
        hv += 0.15;
      }
      h[y * S + x] = hv;
      const i = (y * S + x) * 4;
      d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  // Hairline cracks
  ctx.strokeStyle = 'rgba(8,6,14,0.55)';
  ctx.lineWidth = 1.2;
  for (let k = 0; k < 14; k++) {
    let x = n.rnd() * S, y = n.rnd() * S;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let s = 0; s < 12; s++) {
      x += (n.rnd() - 0.5) * 30;
      y += (n.rnd() - 0.5) * 30;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  return {
    map: tex(c, { repeat: [repeat, repeat] }),
    normalMap: tex(heightToNormal(h, S, S, 2.2), { srgb: false, repeat: [repeat, repeat] }),
  };
}

/** Large non-tiling roughness map with wet puddles (low roughness = mirror-like neon reflections). */
export function puddleRoughness() {
  const S = 512;
  const n = createNoise(21);
  const c = canvas(S);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(S, S);
  const d = img.data;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = x / S, v = y / S;
      const p = n.fbm(u, v, 6, 5, 0.55);
      // Mostly dry, dusty asphalt with a few oily / damp patches (not a rain-slick neon street).
      const wet = Math.min(1, Math.max(0, (p - 0.6) / 0.07));
      const detail = n.value(u * 64, v * 64, 64);
      const rough = 0.86 - wet * 0.5 + (detail - 0.5) * 0.12;
      const val = Math.max(0, Math.min(1, rough)) * 255;
      const i = (y * S + x) * 4;
      // roughnessMap reads the G channel
      d[i] = val; d[i + 1] = val; d[i + 2] = val; d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return tex(c, { srgb: false, wrap: false });
}

/** Concrete wall panel (10m x 5m tile) with a hazard band at the base. */
export function concreteWallTextures() {
  const W = 1024, H = 512;
  const n = createNoise(3);
  const h = new Float32Array(W * H);
  const c = canvas(W, H);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(W, H);
  const d = img.data;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const u = x / W, v = y / H;
      const base = n.fbm(u, v, 8, 5);
      const pits = n.value(u * 256, v * 128, 256) > 0.93 ? -0.25 : 0;
      const stain = Math.pow(v, 3) * 0.35; // grime toward the bottom
      const hv = base + pits;
      h[y * W + x] = hv;
      const k = 0.55 + (base - 0.5) * 0.5 + pits - stain;
      const i = (y * W + x) * 4;
      d[i] = 128 * k; d[i + 1] = 123 * k; d[i + 2] = 114 * k; d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  // Panel seams
  ctx.fillStyle = 'rgba(10,8,18,0.7)';
  for (let x = 0; x < W; x += W / 4) ctx.fillRect(x, 0, 3, H);
  ctx.fillRect(0, H * 0.5, W, 2);
  // Hazard band
  hazardStripes(ctx, 0, H * 0.84, W, H * 0.16, 28);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  for (let i = 0; i < 400; i++) ctx.fillRect(n.rnd() * W, H * 0.84 + n.rnd() * H * 0.16, 2 + n.rnd() * 6, 1 + n.rnd() * 3);
  // Bolt rows
  ctx.fillStyle = 'rgba(200,190,220,0.25)';
  for (let x = 16; x < W; x += 64) {
    ctx.beginPath(); ctx.arc(x, 14, 3, 0, Math.PI * 2); ctx.fill();
  }
  // Seams in height
  for (let y = 0; y < H; y++) for (let s = 0; s < 4; s++) {
    const x = (s * W) / 4;
    for (let o = 0; o < 3; o++) h[y * W + x + o] -= 0.6;
  }
  return {
    map: tex(c),
    normalMap: tex(heightToNormal(h, W, H, 3), { srgb: false }),
  };
}

/** Plain concrete (tileable) for plinths, bases, barriers. */
export function concreteTextures(seed = 11, tint = [122, 118, 110]) {
  const S = 512;
  const n = createNoise(seed);
  const h = new Float32Array(S * S);
  const c = canvas(S);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(S, S);
  const d = img.data;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = x / S, v = y / S;
      const base = n.fbm(u, v, 8, 5);
      const fine = n.value(u * 128, v * 128, 128);
      h[y * S + x] = base * 0.7 + fine * 0.3;
      const k = 0.6 + (base - 0.5) * 0.55 + (fine - 0.5) * 0.12;
      const i = (y * S + x) * 4;
      d[i] = tint[0] * k; d[i + 1] = tint[1] * k; d[i + 2] = tint[2] * k; d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return { map: tex(c), normalMap: tex(heightToNormal(h, S, S, 2), { srgb: false }) };
}

/** Corrugated shipping container side. */
export function containerTextures(color, label, seed = 5) {
  const W = 1024, H = 256;
  const n = createNoise(seed);
  const col = new THREE.Color(color);
  const h = new Float32Array(W * H);
  const c = canvas(W, H);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(W, H);
  const d = img.data;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const u = x / W, v = y / H;
      const ridge = Math.sin(u * Math.PI * 2 * 48);
      const ridgeH = ridge > 0 ? 1 : 0.2 + ridge * 0.2;
      const rust = n.fbm(u, v, 8, 4);
      const rustAmt = Math.max(0, (rust - 0.55) / 0.2);
      const drip = Math.pow(v, 2) * n.value(u * 64, 0.5, 64) * 0.6;
      h[y * W + x] = ridgeH;
      const shade = 0.75 + ridge * 0.18;
      let r = col.r * 255 * shade, g = col.g * 255 * shade, b = col.b * 255 * shade;
      const ra = Math.min(1, rustAmt * 0.8 + drip);
      r = r * (1 - ra) + 110 * ra; g = g * (1 - ra) + 52 * ra; b = b * (1 - ra) + 28 * ra;
      const i = (y * W + x) * 4;
      d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  // Frame edges
  ctx.fillStyle = 'rgba(20,16,24,0.85)';
  ctx.fillRect(0, 0, W, 10);
  ctx.fillRect(0, H - 12, W, 12);
  ctx.fillRect(0, 0, 10, H);
  ctx.fillRect(W - 10, 0, 10, H);
  // Stencil label
  ctx.font = '900 64px Orbitron, sans-serif';
  ctx.fillStyle = 'rgba(235,230,240,0.78)';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, 60, H * 0.42);
  ctx.font = '600 26px Rajdhani, sans-serif';
  ctx.fillText('MAX GROSS 30480 KG  ·  TARE 3750 KG', 64, H * 0.7);
  return {
    map: tex(c),
    normalMap: tex(heightToNormal(h, W, H, 1.6), { srgb: false }),
  };
}

/** Ramp surface: dark diamond plate with glowing chevrons (emissive). Uphill = -V direction (top of texture). */
export function rampTextures() {
  const W = 256, H = 512;
  const c = canvas(W, H);
  const ctx = c.getContext('2d');
  const n = createNoise(9);
  const img = ctx.createImageData(W, H);
  const d = img.data;
  const h = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      // Diamond plate pattern
      const gx = (x % 32) - 16, gy = (y % 32) - 16;
      const diag = Math.abs(gx + gy) < 3 && Math.abs(gx - gy) < 14 && (Math.floor(x / 32) + Math.floor(y / 32)) % 2 === 0;
      const diag2 = Math.abs(gx - gy) < 3 && Math.abs(gx + gy) < 14 && (Math.floor(x / 32) + Math.floor(y / 32)) % 2 === 1;
      const bump = diag || diag2 ? 1 : 0;
      const k = 0.5 + n.value(x / 16, y / 16, 16) * 0.25 + bump * 0.2;
      h[y * W + x] = bump;
      const i = (y * W + x) * 4;
      d[i] = 58 * k; d[i + 1] = 56 * k; d[i + 2] = 70 * k; d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  // Side hazard rails
  hazardStripes(ctx, 0, 0, 18, H, 14);
  hazardStripes(ctx, W - 18, 0, 18, H, 14);

  const e = canvas(W, H);
  const ectx = e.getContext('2d');
  ectx.fillStyle = '#000';
  ectx.fillRect(0, 0, W, H);
  const drawChevrons = (g) => {
    g.lineWidth = 18;
    g.lineJoin = 'miter';
    for (let y = 60; y < H; y += 128) {
      g.beginPath();
      g.moveTo(W * 0.22, y + 40);
      g.lineTo(W * 0.5, y);
      g.lineTo(W * 0.78, y + 40);
      g.stroke();
    }
  };
  ectx.strokeStyle = '#e8b923';
  drawChevrons(ectx);
  ctx.strokeStyle = '#e2b52a'; // painted safety-yellow chevrons
  drawChevrons(ctx);
  return {
    map: tex(c),
    emissiveMap: tex(e),
    normalMap: tex(heightToNormal(h, W, H, 1.5), { srgb: false }),
  };
}

/** Floor markings over the whole arena (single non-tiling texture): painted lines with worn alpha. */
export function arenaMarkings(half, { loopRadius, plinthRing, spawns, chamfer }) {
  const S = 2048;
  const px = S / (half * 2); // pixels per meter
  const toPx = (m) => (m + half) * px;
  const n = createNoise(33);

  const paint = canvas(S);
  const p = paint.getContext('2d');

  // Faint 10m survey grid
  p.strokeStyle = 'rgba(160,150,200,0.12)';
  p.lineWidth = 2;
  for (let m = -half + 10; m < half; m += 10) {
    p.beginPath(); p.moveTo(toPx(m), 0); p.lineTo(toPx(m), S); p.stroke();
    p.beginPath(); p.moveTo(0, toPx(m)); p.lineTo(S, toPx(m)); p.stroke();
  }

  // Outer border line following the chamfered walls
  const inset = 3;
  const e = half - inset;
  const ch = chamfer;
  const border = [
    [-e + ch, -e], [e - ch, -e], [e, -e + ch], [e, e - ch],
    [e - ch, e], [-e + ch, e], [-e, e - ch], [-e, -e + ch],
  ];
  const poly = (ctx) => {
    ctx.beginPath();
    border.forEach(([x, z], i) => (i ? ctx.lineTo(toPx(x), toPx(z)) : ctx.moveTo(toPx(x), toPx(z))));
    ctx.closePath();
  };
  p.strokeStyle = 'rgba(236,232,220,0.85)';
  p.lineWidth = 0.35 * px;
  poly(p); p.stroke();

  // Racing loop: dashed white ring
  p.strokeStyle = 'rgba(235,235,245,0.75)';
  p.lineWidth = 0.4 * px;
  p.setLineDash([4 * px, 3 * px]);
  p.beginPath(); p.arc(toPx(0), toPx(0), loopRadius * px, 0, Math.PI * 2); p.stroke();
  p.setLineDash([]);

  // Plinth ring
  p.strokeStyle = 'rgba(232,184,40,0.9)';
  p.lineWidth = 0.5 * px;
  p.beginPath(); p.arc(toPx(0), toPx(0), plinthRing * px, 0, Math.PI * 2); p.stroke();

  // Axis lanes (yellow, dashed) from plinth ring to border
  p.strokeStyle = 'rgba(255,190,40,0.7)';
  p.lineWidth = 0.3 * px;
  p.setLineDash([2 * px, 2 * px]);
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    for (const off of [-6, 6]) {
      p.beginPath();
      const ox = dz !== 0 ? off : 0, oz = dx !== 0 ? off : 0;
      p.moveTo(toPx(dx * (plinthRing + 2) + ox), toPx(dz * (plinthRing + 2) + oz));
      p.lineTo(toPx(dx * (half - 6) + ox), toPx(dz * (half - 6) + oz));
      p.stroke();
    }
  }
  p.setLineDash([]);

  // Spawn pads
  spawns.forEach((s, i) => {
    const cx = toPx(s.x), cz = toPx(s.z);
    const sz = 7 * px;
    p.save();
    p.translate(cx, cz);
    p.rotate(-s.yaw);
    p.fillStyle = 'rgba(255,176,32,0.12)';
    p.fillRect(-sz / 2, -sz / 2, sz, sz);
    p.strokeStyle = 'rgba(255,176,32,0.95)';
    p.lineWidth = 0.3 * px;
    p.strokeRect(-sz / 2, -sz / 2, sz, sz);
    p.font = `900 ${2.2 * px}px Orbitron, sans-serif`;
    p.fillStyle = 'rgba(255,190,60,0.9)';
    p.textAlign = 'center';
    p.textBaseline = 'middle';
    p.fillText(`P${i + 1}`, 0, 0);
    p.restore();
  });

  // Tire scuffs / grime
  for (let k = 0; k < 90; k++) {
    const r = 10 + n.rnd() * (half - 14);
    const a0 = n.rnd() * Math.PI * 2;
    const len = 0.1 + n.rnd() * 0.5;
    p.strokeStyle = `rgba(6,4,10,${0.12 + n.rnd() * 0.22})`;
    p.lineWidth = (0.25 + n.rnd() * 0.2) * px;
    for (const o of [-0.8, 0.8]) {
      p.beginPath();
      p.arc(toPx(0), toPx(0), (r + o) * px, a0, a0 + len);
      p.stroke();
    }
  }

  // Wear: punch holes in the paint using noise
  const img = p.getImageData(0, 0, S, S);
  const d = img.data;
  for (let y = 0; y < S; y += 1) {
    for (let x = 0; x < S; x += 1) {
      const i = (y * S + x) * 4;
      if (d[i + 3] === 0) continue;
      const w = n.value(x / 12, y / 12, 256) * 0.6 + n.value(x / 3, y / 3, 256) * 0.4;
      d[i + 3] *= Math.min(1, Math.max(0.15, (w - 0.2) * 1.6));
    }
  }
  p.putImageData(img, 0, 0);

  return { map: tex(paint, { wrap: false }) };
}

/** Plinth top: emblem with the arena name. */
export function plinthTopTextures() {
  const S = 1024;
  const c = canvas(S);
  const ctx = c.getContext('2d');
  const n = createNoise(44);
  const base = concreteTextures(44, [112, 108, 100]).map.image;
  ctx.drawImage(base, 0, 0, S, S);
  hazardStripes(ctx, 0, 0, S, 36, 26);
  hazardStripes(ctx, 0, S - 36, S, 36, 26);
  hazardStripes(ctx, 0, 0, 36, S, 26);
  hazardStripes(ctx, S - 36, 0, 36, S, 26);

  const drawEmblem = (ctx2, stroke, fill) => {
    ctx2.save();
    ctx2.translate(S / 2, S / 2);
    ctx2.strokeStyle = stroke;
    ctx2.lineWidth = 14;
    ctx2.beginPath(); ctx2.arc(0, 0, 360, 0, Math.PI * 2); ctx2.stroke();
    ctx2.lineWidth = 5;
    ctx2.beginPath(); ctx2.arc(0, 0, 330, 0, Math.PI * 2); ctx2.stroke();
    // W mark
    ctx2.lineWidth = 34;
    ctx2.lineJoin = 'round';
    ctx2.lineCap = 'round';
    ctx2.beginPath();
    ctx2.moveTo(-190, -150); ctx2.lineTo(-95, 110); ctx2.lineTo(0, -40); ctx2.lineTo(95, 110); ctx2.lineTo(190, -150);
    ctx2.stroke();
    ctx2.fillStyle = fill;
    ctx2.font = '900 64px Orbitron, sans-serif';
    ctx2.textAlign = 'center';
    ctx2.fillText('WRECKFIELD', 0, 240);
    ctx2.restore();
  };
  drawEmblem(ctx, 'rgba(232,184,40,0.92)', 'rgba(238,234,224,0.92)');
  // grime
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  for (let i = 0; i < 1500; i++) ctx.fillRect(n.rnd() * S, n.rnd() * S, 2 + n.rnd() * 10, 1 + n.rnd() * 3);
  return { map: tex(c, { wrap: false }) };
}

/** Painted billboard face: solid background, heavy title, subtitle, weathered edges and grime. */
export function billboardTexture(text, sub, bg = '#1c2026', fg = '#f0b23a') {
  const W = 1024, H = 256;
  const n = createNoise(text.length * 13 + 5);
  const c = canvas(W, H);
  const ctx = c.getContext('2d');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = fg;
  ctx.lineWidth = 8;
  ctx.strokeRect(14, 14, W - 28, H - 28);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = fg;
  ctx.font = '700 128px Rajdhani, Orbitron, sans-serif';
  ctx.fillText(text, W / 2, H * 0.4);
  if (sub) {
    ctx.font = '600 38px Rajdhani, sans-serif';
    ctx.globalAlpha = 0.9;
    ctx.fillText(sub, W / 2, H * 0.8);
    ctx.globalAlpha = 1;
  }
  // grime streaks + speckle
  for (let i = 0; i < 380; i++) {
    ctx.fillStyle = `rgba(0,0,0,${0.03 + n.rnd() * 0.08})`;
    ctx.fillRect(n.rnd() * W, n.rnd() * H, 1 + n.rnd() * 3, 6 + n.rnd() * 40);
  }
  const t = tex(c, { wrap: false });
  return t;
}

export function hazardTexture(repeatX = 1) {
  const c = canvas(256, 64);
  hazardStripes(c.getContext('2d'), 0, 0, 256, 64, 22);
  return tex(c, { repeat: [repeatX, 1] });
}

/** Radial gradient (white center → transparent) for glows, underglow decals, light pools. */
export function radialGlowTexture(inner = 0.0, falloff = 1.6) {
  const S = 128;
  const c = canvas(S);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(S, S);
  const d = img.data;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const dx = (x + 0.5) / S * 2 - 1, dy = (y + 0.5) / S * 2 - 1;
      const r = Math.hypot(dx, dy);
      const a = r < inner ? 1 : Math.pow(Math.max(0, 1 - (r - inner) / (1 - inner)), falloff);
      const i = (y * S + x) * 4;
      d[i] = 255; d[i + 1] = 255; d[i + 2] = 255; d[i + 3] = a * 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return tex(c, { wrap: false, srgb: false });
}

/** Thin bright ring on transparent — ground-plane shockwave decal (expanding + fading over its lifetime). */
export function ringGlowTexture(thickness = 0.16, falloff = 2.2) {
  const S = 256;
  const c = canvas(S);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(S, S);
  const d = img.data;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const dx = (x + 0.5) / S * 2 - 1, dy = (y + 0.5) / S * 2 - 1;
      const r = Math.hypot(dx, dy);
      const d0 = Math.abs(r - (1 - thickness)) / thickness;
      const a = Math.pow(Math.max(0, 1 - Math.min(1, d0)), falloff);
      const i = (y * S + x) * 4;
      d[i] = 255; d[i + 1] = 255; d[i + 2] = 255; d[i + 3] = a * 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return tex(c, { wrap: false, srgb: false });
}

/** Boost pad: dark plate, hazard-cyan side rails, glowing directional chevrons (emissive) pointing toward -V —
 * same "uphill = -V" forward convention as rampTextures, so Arena.js orients it with the pad's forward vector. */
export function boostPadTexture() {
  const W = 256, H = 256;
  const c = canvas(W, H);
  const ctx = c.getContext('2d');
  const n = createNoise(51);
  const img = ctx.createImageData(W, H);
  const d = img.data;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const k = 0.42 + n.value(x / 24, y / 24, 24) * 0.15;
      const i = (y * W + x) * 4;
      d[i] = 30 * k; d[i + 1] = 28 * k; d[i + 2] = 42 * k; d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  hazardStripes(ctx, 0, 0, W, 14, 12, '#e2b52a', '#0a0a0c');
  hazardStripes(ctx, 0, H - 14, W, 14, 12, '#e2b52a', '#0a0a0c');

  const e = canvas(W, H);
  const ectx = e.getContext('2d');
  ectx.fillStyle = '#000';
  ectx.fillRect(0, 0, W, H);
  const drawChevrons = (g, stroke) => {
    g.strokeStyle = stroke;
    g.lineWidth = 20;
    g.lineJoin = 'miter';
    g.lineCap = 'butt';
    for (let y = H - 10; y > -40; y -= 64) {
      g.beginPath();
      g.moveTo(W * 0.2, y);
      g.lineTo(W * 0.5, y - 40);
      g.lineTo(W * 0.8, y);
      g.stroke();
    }
  };
  drawChevrons(ectx, '#ffc21a');
  drawChevrons(ctx, '#f2c230');
  return { map: tex(c, { wrap: false }) };
}

/** Hazard-zone ring decal (ground plane): diagonal hazard stripes masked to a ring band, white RGB so the
 * caller's material.color tints it (same tint-via-material convention as ringGlowTexture). */
export function hazardZoneTexture(thickness = 0.3, falloff = 1.8) {
  const S = 256;
  const c = canvas(S);
  const ctx = c.getContext('2d');
  hazardStripes(ctx, 0, 0, S, S, 20, '#ffffff', '#000000');
  const img = ctx.getImageData(0, 0, S, S);
  const d = img.data;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const dx = (x + 0.5) / S * 2 - 1, dy = (y + 0.5) / S * 2 - 1;
      const r = Math.hypot(dx, dy);
      const d0 = Math.abs(r - (1 - thickness)) / thickness;
      const ring = Math.pow(Math.max(0, 1 - Math.min(1, d0)), falloff);
      const i = (y * S + x) * 4;
      const stripe = d[i] / 255; // white stripe = 1, dark gap = 0 (from hazardStripes' colA/colB)
      d[i] = 255; d[i + 1] = 255; d[i + 2] = 255;
      d[i + 3] = stripe * ring * 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return tex(c, { wrap: false, srgb: false });
}

/** Tire sidewall/tread texture. */
export function tireTexture() {
  const W = 256, H = 64;
  const c = canvas(W, H);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#16141a';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#0a090c';
  for (let x = 0; x < W; x += 16) {
    ctx.beginPath();
    ctx.moveTo(x, 0); ctx.lineTo(x + 8, H / 2); ctx.lineTo(x, H); ctx.lineTo(x + 6, H); ctx.lineTo(x + 14, H / 2); ctx.lineTo(x + 6, 0);
    ctx.fill();
  }
  return tex(c);
}
