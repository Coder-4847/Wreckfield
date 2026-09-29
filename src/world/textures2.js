import { canvas, tex, heightToNormal, createNoise } from './textures.js';

// Procedural material textures for the extra maps (rock, sand, snow, ice, brick, wood, building facades, painted
// markings). Everything is memoized: switching maps back and forth never regenerates a texture.

const cache = new Map();
export const memo = (key, fn) => {
  if (!cache.has(key)) cache.set(key, fn());
  return cache.get(key);
};

const clamp255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);

/** Generic noise-shaded albedo + normal. `shade(u,v,n)` returns [r,g,b] and writes height via `hOut`. */
function shadedTexture(seed, S, shadeFn, normalStrength = 2, repeat = [1, 1]) {
  const n = createNoise(seed);
  const c = canvas(S);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(S, S);
  const d = img.data;
  const h = new Float32Array(S * S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = x / S, v = y / S;
      const out = shadeFn(u, v, n);
      const i = (y * S + x) * 4;
      d[i] = clamp255(out[0]); d[i + 1] = clamp255(out[1]); d[i + 2] = clamp255(out[2]); d[i + 3] = 255;
      h[y * S + x] = out[3] ?? 0.5;
    }
  }
  ctx.putImageData(img, 0, 0);
  return {
    map: tex(c, { repeat }),
    normalMap: tex(heightToNormal(h, S, S, normalStrength), { srgb: false, repeat }),
  };
}

/** Wind-rippled desert sand. */
export function sandTextures() {
  return memo('sand', () => shadedTexture(71, 512, (u, v, n) => {
    const big = n.fbm(u, v, 5, 4);
    const ripple = Math.sin((u * 46 + big * 7.5) * Math.PI * 2) * 0.5 + 0.5;
    const grain = n.value(u * 256, v * 256, 256);
    const k = 0.82 + (big - 0.5) * 0.32 + ripple * 0.08 + (grain - 0.5) * 0.1;
    return [214 * k, 178 * k, 128 * k, ripple * 0.6 + big * 0.4];
  }, 1.4));
}

/** Layered sedimentary rock (quarry cliffs, boulders): straight strata, weathered ledges, vertical fractures. */
export function rockTextures(tint = [168, 118, 82], seed = 12) {
  return memo(`rock:${tint}:${seed}`, () => shadedTexture(seed, 512, (u, v, n) => {
    const warp = (n.fbm(u, v, 3, 3) - 0.5) * 0.035;
    const vv = v + warp;
    // strata: many thin layers of varying tone, a few thick dark/light beds
    const layer = Math.floor(vv * 46);
    const layerTone = n.value(layer * 0.37, 0.5, 64) - 0.5;
    const bed = Math.sin(vv * Math.PI * 2 * 5 + n.value(u * 3, 0.3, 3) * 2) * 0.5 + 0.5;
    const seam = Math.abs(((vv * 46) % 1) - 0.5) > 0.46 ? -0.16 : 0;
    const frac = n.value(u * 40, v * 3, 40) > 0.88 ? -0.24 : 0;
    const grain = n.value(u * 220, v * 220, 220) - 0.5;
    const k = 0.88 + layerTone * 0.3 + bed * 0.16 + seam + frac + grain * 0.1 + (n.fbm(u, v, 10, 4) - 0.5) * 0.18;
    return [tint[0] * k, tint[1] * k, tint[2] * k, 0.5 + layerTone * 0.6 + seam * 2 + frac * 2 + grain * 0.3];
  }, 2.6));
}

export function snowTextures() {
  return memo('snow', () => shadedTexture(31, 512, (u, v, n) => {
    const big = n.fbm(u, v, 6, 4);
    const sparkle = n.value(u * 300, v * 300, 300) > 0.965 ? 22 : 0;
    const k = 0.9 + (big - 0.5) * 0.14;
    return [236 * k + sparkle, 242 * k + sparkle, 252 * k + sparkle, big];
  }, 0.9));
}

/** Frozen lake: pale blue with white cracks + trapped air bubbles. Returns map + roughnessMap. */
export function iceTextures() {
  return memo('ice', () => {
    const S = 512;
    const n = createNoise(88);
    const c = canvas(S);
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(S / 2, S / 2, 10, S / 2, S / 2, S * 0.75);
    g.addColorStop(0, '#a9cfe6'); g.addColorStop(1, '#7fa8c4');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
    for (let i = 0; i < 1400; i++) {
      ctx.fillStyle = `rgba(255,255,255,${0.02 + n.rnd() * 0.06})`;
      ctx.beginPath(); ctx.arc(n.rnd() * S, n.rnd() * S, 1 + n.rnd() * 5, 0, 7); ctx.fill();
    }
    ctx.lineCap = 'round';
    for (let k = 0; k < 46; k++) {
      let x = n.rnd() * S, y = n.rnd() * S;
      ctx.strokeStyle = `rgba(240,250,255,${0.25 + n.rnd() * 0.4})`;
      ctx.lineWidth = 0.6 + n.rnd() * 1.6;
      ctx.beginPath(); ctx.moveTo(x, y);
      let a = n.rnd() * 6.28;
      for (let s = 0; s < 9; s++) {
        a += (n.rnd() - 0.5) * 1.1;
        x += Math.cos(a) * (10 + n.rnd() * 26); y += Math.sin(a) * (10 + n.rnd() * 26);
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    const map = tex(c, { wrap: false });
    return { map };
  });
}

export function brickTextures(tint = [150, 74, 56]) {
  return memo(`brick:${tint}`, () => {
    const S = 512;
    const n = createNoise(5);
    const h = new Float32Array(S * S);
    const c = canvas(S);
    const ctx = c.getContext('2d');
    const bw = 64, bh = 28;
    ctx.fillStyle = '#4a4540';
    ctx.fillRect(0, 0, S, S);
    for (let row = 0; row * bh < S; row++) {
      for (let col = -1; col * bw < S + bw; col++) {
        const x = col * bw + (row % 2 ? bw / 2 : 0), y = row * bh;
        const k = 0.75 + n.rnd() * 0.4;
        ctx.fillStyle = `rgb(${tint[0] * k | 0},${tint[1] * k | 0},${tint[2] * k | 0})`;
        ctx.fillRect(x + 2, y + 2, bw - 4, bh - 4);
      }
    }
    for (let i = 0; i < 4000; i++) {
      ctx.fillStyle = `rgba(0,0,0,${n.rnd() * 0.1})`;
      ctx.fillRect(n.rnd() * S, n.rnd() * S, 1 + n.rnd() * 3, 1 + n.rnd() * 2);
    }
    const img = ctx.getImageData(0, 0, S, S).data;
    for (let i = 0; i < S * S; i++) h[i] = (img[i * 4] + img[i * 4 + 1]) / 510;
    return { map: tex(c), normalMap: tex(heightToNormal(h, S, S, 2.4), { srgb: false }) };
  });
}

export function plankTextures(tint = [124, 92, 62]) {
  return memo(`plank:${tint}`, () => shadedTexture(19, 512, (u, v, n) => {
    const plank = Math.floor(u * 8);
    const edge = Math.abs(((u * 8) % 1) - 0.5) > 0.47 ? 0.45 : 1;
    const grain = n.value(u * 8, v * 60 + plank * 9, 64) * 0.5 + n.value(u * 24, v * 220, 220) * 0.5;
    const k = (0.62 + grain * 0.5 + (n.rnd() * 0.02)) * edge * (0.85 + ((plank * 37) % 7) * 0.03);
    return [tint[0] * k, tint[1] * k, tint[2] * k, grain * edge];
  }, 1.2));
}

/**
 * Building facade tile: a grid of windows (cols x rows per tile). Returns albedo + emissive (lit windows).
 * kind: 'glass' (dark curtain wall), 'concrete' (punched windows), 'brick'. lit = fraction of windows lit.
 */
export function facadeTextures(kind = 'concrete', lit = 0.32, seed = 3) {
  return memo(`facade:${kind}:${lit}:${seed}`, () => {
    const W = 512, H = 512;
    const n = createNoise(seed);
    const c = canvas(W, H), e = canvas(W, H);
    const ctx = c.getContext('2d'), ectx = e.getContext('2d');
    ectx.fillStyle = '#000'; ectx.fillRect(0, 0, W, H);
    const wall = kind === 'glass' ? '#1d242c' : kind === 'brick' ? '#6b3f33' : '#7d7a74';
    ctx.fillStyle = wall; ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < 6000; i++) {
      ctx.fillStyle = `rgba(${n.rnd() < 0.5 ? '0,0,0' : '255,255,255'},${n.rnd() * 0.05})`;
      ctx.fillRect(n.rnd() * W, n.rnd() * H, 1 + n.rnd() * 4, 1 + n.rnd() * 4);
    }
    const cols = 4, rows = 6;
    const cw = W / cols, rh = H / rows;
    for (let r = 0; r < rows; r++) {
      for (let cIdx = 0; cIdx < cols; cIdx++) {
        const wx = cIdx * cw + cw * 0.14, wy = r * rh + rh * 0.16;
        const ww = cw * 0.72, wh = rh * 0.62;
        const on = n.rnd() < lit;
        if (kind === 'glass') {
          ctx.fillStyle = on ? '#3b4a55' : '#0f161d';
          ctx.fillRect(wx - cw * 0.14, wy - rh * 0.08, cw, rh);
          ctx.strokeStyle = '#0a0d10'; ctx.lineWidth = 3; ctx.strokeRect(wx - cw * 0.14, wy - rh * 0.08, cw, rh);
        } else {
          ctx.fillStyle = on ? '#43504f' : '#111820';
          ctx.fillRect(wx, wy, ww, wh);
          ctx.strokeStyle = '#2b2a28'; ctx.lineWidth = 4; ctx.strokeRect(wx, wy, ww, wh);
          ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(wx, wy + wh, ww, 5); // sill
        }
        if (on) {
          const warm = n.rnd() < 0.72;
          ectx.fillStyle = warm ? `rgb(255,${190 + (n.rnd() * 40) | 0},${110 + (n.rnd() * 50) | 0})` : `rgb(170,${210 + (n.rnd() * 30) | 0},255)`;
          ectx.globalAlpha = 0.45 + n.rnd() * 0.5;
          if (kind === 'glass') ectx.fillRect(wx - cw * 0.1, wy - rh * 0.04, cw * 0.92, rh * 0.88);
          else ectx.fillRect(wx + 3, wy + 3, ww - 6, wh - 6);
          ectx.globalAlpha = 1;
        }
      }
    }
    return { map: tex(c), emissiveMap: tex(e) };
  });
}

/**
 * Painted ground markings decal: a transparent (2048²) texture covering the arena. `draw(ctx, m)` receives a
 * 2D context and a metres->pixels helper `m = { px, toX(x), toY(z), S }`.
 */
export function markingsTexture(half, draw, key) {
  return memo(`marks:${key}`, () => {
    const S = 2048;
    const px = S / (half * 2);
    const c = canvas(S);
    const ctx = c.getContext('2d');
    draw(ctx, { px, S, toX: (x) => (x + half) * px, toY: (z) => (z + half) * px });
    // wear: punch holes in the paint
    const img = ctx.getImageData(0, 0, S, S);
    const d = img.data;
    const n = createNoise(key.length * 7 + 1);
    for (let y = 0; y < S; y += 2) {
      for (let x = 0; x < S; x += 2) {
        const i = (y * S + x) * 4;
        if (d[i + 3] === 0) continue;
        const w = n.value(x / 14, y / 14, 256) * 0.6 + n.value(x / 3, y / 3, 256) * 0.4;
        const a = Math.min(1, Math.max(0.2, (w - 0.15) * 1.7));
        for (const o of [0, 4, S * 4, S * 4 + 4]) if (d[i + o + 3]) d[i + o + 3] *= a;
      }
    }
    ctx.putImageData(img, 0, 0);
    return tex(c, { wrap: false });
  });
}

/** Simple tiled dirt / packed-earth ground. */
export function dirtTextures(tint = [120, 96, 70], seed = 41) {
  return memo(`dirt:${tint}:${seed}`, () => shadedTexture(seed, 512, (u, v, n) => {
    const big = n.fbm(u, v, 7, 5), fine = n.value(u * 200, v * 200, 200);
    const k = 0.7 + (big - 0.5) * 0.5 + (fine - 0.5) * 0.18;
    return [tint[0] * k, tint[1] * k, tint[2] * k, big * 0.7 + fine * 0.3];
  }, 1.8));
}

/** Tileable choppy-water normal map (sea / harbor basin). Animated by scrolling `offset`. */
export function waterNormal() {
  return memo('waterNormal', () => {
    const S = 256;
    const n = createNoise(303);
    const h = new Float32Array(S * S);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const u = x / S, v = y / S;
        h[y * S + x] = n.fbm(u, v, 6, 5) * 0.7 + n.value(u * 32, v * 32, 32) * 0.3;
      }
    }
    return tex(heightToNormal(h, S, S, 3.2), { srgb: false });
  });
}

/** Soft warm light-pool decal (street lamps, floodlights): white radial falloff, tinted by the material colour. */
export function poolTexture() {
  return memo('pool', () => {
    const S = 128;
    const c = canvas(S);
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.45)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
    return tex(c, { wrap: false });
  });
}

/** Rain-soaked asphalt roughness: mostly damp, with many mirror-like puddles (G channel). */
export function wetRoughness() {
  return memo('wetRough', () => {
    const S = 512;
    const n = createNoise(29);
    const c = canvas(S);
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(S, S);
    const d = img.data;
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const u = x / S, v = y / S;
        const p = n.fbm(u, v, 5, 5, 0.55);
        const pud = Math.min(1, Math.max(0, (p - 0.5) / 0.06));
        const detail = n.value(u * 64, v * 64, 64);
        const rough = Math.max(0.03, Math.min(1, 0.6 - pud * 0.55 + (detail - 0.5) * 0.1));
        const val = rough * 255, i = (y * S + x) * 4;
        d[i] = val; d[i + 1] = val; d[i + 2] = val; d[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return tex(c, { srgb: false, wrap: false });
  });
}
