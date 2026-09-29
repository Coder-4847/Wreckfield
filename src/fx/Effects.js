import * as THREE from 'three';
import { radialGlowTexture, ringGlowTexture } from '../world/textures.js';

// Lightweight pooled particle systems (CPU simulated, one draw call each):
//   Smoke  — soft point sprites, normal blending (tire smoke, dust, damage smoke later)
//   Sparks — velocity-stretched additive line segments (impacts, scraping)
//   Flash  — additive glow sprites (impact / spawn flashes)
//   SkidMarks — ring-buffer ribbon quads laid on the ground

const _v = new THREE.Vector3();
const _r = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const _size = new THREE.Vector2();

class Smoke {
  constructor(max = 1400) {
    this.max = max;
    this.count = 0;
    this.cursor = 0;
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.alpha = new Float32Array(max);
    this.size = new Float32Array(max);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.size0 = new Float32Array(max);
    this.grow = new Float32Array(max);
    this.alpha0 = new Float32Array(max);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uMap: { value: radialGlowTexture(0.0, 1.4) }, uScale: { value: 800 } },
      vertexShader: /* glsl */ `
        attribute vec3 aColor; attribute float aAlpha; attribute float aSize;
        varying vec3 vColor; varying float vAlpha;
        uniform float uScale;
        void main(){
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * uScale / max(0.1, -mv.z);
          gl_Position = projectionMatrix * mv;
          vColor = aColor; vAlpha = aAlpha;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap;
        varying vec3 vColor; varying float vAlpha;
        void main(){
          float a = texture2D(uMap, gl_PointCoord).a * vAlpha;
          if (a < 0.003) discard;
          gl_FragColor = vec4(vColor, a);
        }`,
    });
    this.points = new THREE.Points(g, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
    this.geometry = g;
  }

  emit(p, v, { color = [0.6, 0.56, 0.68], size = 1.2, grow = 2.5, life = 1.6, alpha = 0.35 } = {}) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
    this.count = Math.min(this.max, this.count + 1);
    this.pos[i * 3] = p.x; this.pos[i * 3 + 1] = p.y; this.pos[i * 3 + 2] = p.z;
    this.vel[i * 3] = v.x; this.vel[i * 3 + 1] = v.y; this.vel[i * 3 + 2] = v.z;
    this.col[i * 3] = color[0]; this.col[i * 3 + 1] = color[1]; this.col[i * 3 + 2] = color[2];
    this.life[i] = life;
    this.maxLife[i] = life;
    this.size0[i] = size;
    this.grow[i] = grow;
    this.alpha0[i] = alpha;
  }

  update(dt) {
    const drag = Math.exp(-1.8 * dt);
    for (let i = 0; i < this.count; i++) {
      if (this.life[i] <= 0) { this.alpha[i] = 0; continue; }
      this.life[i] -= dt;
      const t = 1 - Math.max(0, this.life[i]) / this.maxLife[i];
      this.vel[i * 3] *= drag;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * drag + 0.9 * dt; // buoyancy
      this.vel[i * 3 + 2] *= drag;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.size[i] = this.size0[i] + this.grow[i] * Math.sqrt(t);
      // quick fade-in, long fade-out
      this.alpha[i] = this.alpha0[i] * Math.min(1, t * 8) * (1 - t) * (1 - t);
    }
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.aAlpha.needsUpdate = true;
    this.geometry.attributes.aSize.needsUpdate = true;
    this.geometry.attributes.aColor.needsUpdate = true;
    this.geometry.setDrawRange(0, this.count);
  }
}

class Sparks {
  constructor(max = 900) {
    this.max = max;
    this.cursor = 0;
    this.count = 0;
    this.p = new Float32Array(max * 3);
    this.v = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.c = new Float32Array(max * 3);
    const g = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(new Float32Array(max * 6), 3).setUsage(THREE.DynamicDrawUsage);
    this.colAttr = new THREE.BufferAttribute(new Float32Array(max * 6), 3).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.posAttr);
    g.setAttribute('color', this.colAttr);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    this.geometry = g;
    this.lines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({
      vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    }));
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 4;
  }

  burst(pos, normal, count, { speed = 9, spread = 0.9, color = [4, 2.2, 0.8], life = 0.55, up = 0.4 } = {}) {
    for (let n = 0; n < count; n++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % this.max;
      this.count = Math.min(this.max, this.count + 1);
      _v.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(spread);
      _v.add(normal);
      _v.y += up;
      _v.normalize().multiplyScalar(speed * (0.35 + Math.random() * 0.9));
      this.p[i * 3] = pos.x; this.p[i * 3 + 1] = pos.y; this.p[i * 3 + 2] = pos.z;
      this.v[i * 3] = _v.x; this.v[i * 3 + 1] = _v.y; this.v[i * 3 + 2] = _v.z;
      const l = life * (0.5 + Math.random() * 0.8);
      this.life[i] = l;
      this.maxLife[i] = l;
      const k = 0.7 + Math.random() * 0.6;
      this.c[i * 3] = color[0] * k; this.c[i * 3 + 1] = color[1] * k; this.c[i * 3 + 2] = color[2] * k;
    }
  }

  update(dt) {
    const P = this.posAttr.array, C = this.colAttr.array;
    for (let i = 0; i < this.count; i++) {
      const o = i * 6;
      if (this.life[i] <= 0) {
        C[o] = C[o + 1] = C[o + 2] = C[o + 3] = C[o + 4] = C[o + 5] = 0;
        continue;
      }
      this.life[i] -= dt;
      const j = i * 3;
      this.v[j + 1] -= 22 * dt;
      this.v[j] *= 1 - 1.5 * dt;
      this.v[j + 2] *= 1 - 1.5 * dt;
      this.p[j] += this.v[j] * dt;
      this.p[j + 1] += this.v[j + 1] * dt;
      this.p[j + 2] += this.v[j + 2] * dt;
      if (this.p[j + 1] < 0.02) {
        this.p[j + 1] = 0.02;
        this.v[j + 1] *= -0.35;
        this.v[j] *= 0.7;
        this.v[j + 2] *= 0.7;
      }
      const t = Math.max(0, this.life[i] / this.maxLife[i]);
      const stretch = 0.028;
      P[o] = this.p[j]; P[o + 1] = this.p[j + 1]; P[o + 2] = this.p[j + 2];
      P[o + 3] = this.p[j] - this.v[j] * stretch;
      P[o + 4] = this.p[j + 1] - this.v[j + 1] * stretch;
      P[o + 5] = this.p[j + 2] - this.v[j + 2] * stretch;
      C[o] = this.c[j] * t; C[o + 1] = this.c[j + 1] * t; C[o + 2] = this.c[j + 2] * t;
      C[o + 3] = this.c[j] * t * 0.15; C[o + 4] = this.c[j + 1] * t * 0.1; C[o + 5] = this.c[j + 2] * t * 0.1;
    }
    this.posAttr.needsUpdate = true;
    this.colAttr.needsUpdate = true;
    this.geometry.setDrawRange(0, this.count * 2);
  }
}

class Flashes {
  constructor(scene, max = 32) {
    const tex = radialGlowTexture(0.05, 2.2);
    this.pool = [];
    for (let i = 0; i < max; i++) {
      const m = new THREE.SpriteMaterial({ map: tex, color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
      const s = new THREE.Sprite(m);
      s.visible = false;
      s.renderOrder = 6;
      scene.add(s);
      this.pool.push({ s, life: 0, maxLife: 1, size: 1, color: new THREE.Color() });
    }
    this.cursor = 0;
  }

  spawn(pos, color, size = 3, life = 0.18) {
    const f = this.pool[this.cursor];
    this.cursor = (this.cursor + 1) % this.pool.length;
    f.s.position.copy(pos);
    f.life = f.maxLife = life;
    f.size = size;
    f.color.set(color).multiplyScalar(3);
    f.s.visible = true;
  }

  update(dt) {
    for (const f of this.pool) {
      if (f.life <= 0) { f.s.visible = false; continue; }
      f.life -= dt;
      const t = Math.max(0, f.life / f.maxLife);
      f.s.scale.setScalar(f.size * (1.2 - t * 0.2));
      f.s.material.color.copy(f.color).multiplyScalar(t * t);
    }
  }
}

class SkidMarks {
  constructor(maxQuads = 2400) {
    this.max = maxQuads;
    this.cursor = 0;
    this.pos = new Float32Array(maxQuads * 6 * 3);
    this.col = new Float32Array(maxQuads * 6 * 4);
    const g = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.colAttr = new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.posAttr);
    g.setAttribute('color', this.colAttr);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    this.mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    this.tracks = new Map();
    this.dirty = false;
  }

  /** Feed a wheel contact each frame. intensity 0 ends the current streak. */
  add(id, point, normal, intensity, width = 0.3) {
    let tr = this.tracks.get(id);
    if (!tr) {
      tr = { last: new THREE.Vector3(), l: new THREE.Vector3(), r: new THREE.Vector3(), a: 0, active: false };
      this.tracks.set(id, tr);
    }
    if (intensity < 0.05) { tr.active = false; return; }
    const p = _v.copy(point).addScaledVector(normal, 0.02);
    if (!tr.active) {
      tr.active = true;
      tr.last.copy(p);
      tr.a = 0;
      tr.pending = true;
      return;
    }
    const d = p.distanceTo(tr.last);
    if (d < 0.35) return;
    if (d > 4) { tr.active = false; return; } // teleport / respawn
    _r.subVectors(p, tr.last).cross(normal).normalize().multiplyScalar(width / 2);
    const nl = p.clone().add(_r), nr = p.clone().sub(_r);
    if (tr.pending) {
      tr.l.copy(tr.last).add(_r);
      tr.r.copy(tr.last).sub(_r);
      tr.pending = false;
    }
    const a = Math.min(0.85, 0.25 + intensity * 0.7);
    this._quad(tr.l, tr.r, nl, nr, tr.a, a);
    tr.l.copy(nl); tr.r.copy(nr); tr.last.copy(p); tr.a = a;
  }

  _quad(l0, r0, l1, r1, a0, a1) {
    const q = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
    const P = this.pos, C = this.col;
    const verts = [[l0, a0], [r0, a0], [r1, a1], [l0, a0], [r1, a1], [l1, a1]];
    for (let k = 0; k < 6; k++) {
      const [v, a] = verts[k];
      const pi = (q * 6 + k) * 3, ci = (q * 6 + k) * 4;
      P[pi] = v.x; P[pi + 1] = v.y; P[pi + 2] = v.z;
      C[ci] = 0.015; C[ci + 1] = 0.012; C[ci + 2] = 0.02; C[ci + 3] = a;
    }
    this.dirty = true;
  }

  update() {
    if (!this.dirty) return;
    this.posAttr.needsUpdate = true;
    this.colAttr.needsUpdate = true;
    this.dirty = false;
  }
}

class Shockwaves {
  constructor(scene, max = 6) {
    const tex = ringGlowTexture();
    this.pool = [];
    for (let i = 0; i < max; i++) {
      const m = new THREE.MeshBasicMaterial({
        map: tex, color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending,
        depthWrite: false, toneMapped: false, fog: false, side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), m);
      mesh.rotation.x = -Math.PI / 2;
      mesh.visible = false;
      mesh.renderOrder = 2;
      scene.add(mesh);
      this.pool.push({ mesh, life: 0, maxLife: 1, maxRadius: 6, color: new THREE.Color() });
    }
    this.cursor = 0;
  }

  spawn(pos, color, maxRadius = 6, life = 0.6) {
    const w = this.pool[this.cursor];
    this.cursor = (this.cursor + 1) % this.pool.length;
    w.mesh.position.copy(pos);
    w.mesh.position.y += 0.06;
    w.life = w.maxLife = life;
    w.maxRadius = maxRadius;
    w.color.set(color);
    w.mesh.visible = true;
  }

  update(dt) {
    for (const w of this.pool) {
      if (!w.mesh.visible) continue;
      w.life -= dt;
      if (w.life <= 0) { w.mesh.visible = false; continue; }
      const t = 1 - w.life / w.maxLife;
      const r = w.maxRadius * (1 - Math.pow(1 - t, 2.2)) * 2; // *2: plane geometry is unit (1x1), scale = diameter
      w.mesh.scale.set(r, r, 1);
      w.mesh.material.color.copy(w.color).multiplyScalar((1 - t) * (1 - t) * 2.5);
    }
  }
}

/** Additive flame sprites with a heat ramp (white-yellow core → orange → dull red → gone). */
class Fire {
  constructor(max = 900) {
    this.max = max;
    this.count = 0;
    this.cursor = 0;
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.t = new Float32Array(max);
    this.size = new Float32Array(max);
    this.heat = new Float32Array(max);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.size0 = new Float32Array(max);
    this.grow = new Float32Array(max);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aT', new THREE.BufferAttribute(this.t, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aHeat', new THREE.BufferAttribute(this.heat, 1).setUsage(THREE.DynamicDrawUsage));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uMap: { value: radialGlowTexture(0.0, 1.2) }, uScale: { value: 800 } },
      vertexShader: /* glsl */ `
        attribute float aT; attribute float aSize; attribute float aHeat;
        varying float vT; varying float vHeat;
        uniform float uScale;
        void main(){
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * uScale / max(0.1, -mv.z);
          gl_Position = projectionMatrix * mv;
          vT = aT; vHeat = aHeat;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap;
        varying float vT; varying float vHeat;
        void main(){
          if (vT >= 1.0) discard;
          float a = texture2D(uMap, gl_PointCoord).a;
          vec3 hot = vec3(1.7, 1.25, 0.6), mid = vec3(1.35, 0.48, 0.1), cool = vec3(0.32, 0.06, 0.02);
          vec3 col = vT < 0.22 ? mix(hot, mid, vT / 0.22) : mix(mid, cool, (vT - 0.22) / 0.78);
          float fade = min(1.0, vT * 14.0) * pow(1.0 - vT, 1.6);
          a *= fade * vHeat * 0.55;
          if (a < 0.004) discard;
          gl_FragColor = vec4(col, a);
        }`,
    });
    this.points = new THREE.Points(g, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    this.geometry = g;
    this.t.fill(1);
  }

  emit(p, v, { size = 1, grow = 1.6, life = 0.7, heat = 1 } = {}) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
    this.count = Math.min(this.max, this.count + 1);
    this.pos[i * 3] = p.x; this.pos[i * 3 + 1] = p.y; this.pos[i * 3 + 2] = p.z;
    this.vel[i * 3] = v.x; this.vel[i * 3 + 1] = v.y; this.vel[i * 3 + 2] = v.z;
    this.life[i] = this.maxLife[i] = life;
    this.size0[i] = size;
    this.grow[i] = grow;
    this.heat[i] = heat;
    this.t[i] = 0;
  }

  update(dt) {
    const drag = Math.exp(-2.6 * dt);
    for (let i = 0; i < this.count; i++) {
      if (this.life[i] <= 0) { this.t[i] = 1; continue; }
      this.life[i] -= dt;
      const t = 1 - Math.max(0, this.life[i]) / this.maxLife[i];
      this.t[i] = t;
      this.vel[i * 3] *= drag;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * drag + 5.5 * dt; // hot gas rises
      this.vel[i * 3 + 2] *= drag;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.size[i] = (this.size0[i] + this.grow[i] * Math.sqrt(t)) * (1 - t * 0.35);
    }
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.aT.needsUpdate = true;
    this.geometry.attributes.aSize.needsUpdate = true;
    this.geometry.attributes.aHeat.needsUpdate = true;
    this.geometry.setDrawRange(0, this.count);
  }
}

/**
 * Flying wreckage: body-panel shards (in the victim's paint), dark chassis bits and torn-off wheels. Simple CPU
 * rigid-ish bodies (gravity, spin, bounce, slide) colliding with the static world via short physics ray casts, so
 * pieces land on ramps / decks / roofs instead of falling through. Burning pieces trail fire and smoke. Three
 * InstancedMeshes = three draw calls regardless of how much is flying.
 */
class Debris {
  constructor(scene, physics) {
    this.physics = physics;
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0.55 });
    const shard = new THREE.IcosahedronGeometry(0.5, 0);
    shard.scale(1, 0.35, 0.8);
    const panel = new THREE.BoxGeometry(1, 0.06, 0.7);
    const wheel = new THREE.CylinderGeometry(0.42, 0.42, 0.34, 18).rotateZ(Math.PI / 2);
    const rubber = new THREE.MeshStandardMaterial({ color: 0x141416, roughness: 0.9, metalness: 0.05 });
    this.kinds = {
      shard: this._pool(scene, shard, mat, 72, 0.18),
      panel: this._pool(scene, panel, mat.clone(), 28, 0.05),
      wheel: this._pool(scene, wheel, rubber, 8, 0.42),
    };
  }

  _pool(scene, geo, mat, n, radius) {
    const mesh = new THREE.InstancedMesh(geo, mat, n);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    const white = new THREE.Color(1, 1, 1);
    for (let i = 0; i < n; i++) mesh.setColorAt(i, white);
    scene.add(mesh);
    const items = Array.from({ length: n }, () => ({
      alive: false, pos: new THREE.Vector3(), vel: new THREE.Vector3(), quat: new THREE.Quaternion(),
      axis: new THREE.Vector3(1, 0, 0), spin: 0, scale: new THREE.Vector3(1, 1, 1), life: 0, burn: 0, rest: false, trail: 0,
    }));
    return { mesh, items, cursor: 0, radius, dirty: true };
  }

  spawn(kind, pos, vel, color, { scale = 1, life = 9, burn = 0 } = {}) {
    const P = this.kinds[kind];
    const it = P.items[P.cursor];
    const idx = P.cursor;
    P.cursor = (P.cursor + 1) % P.items.length;
    it.alive = true;
    it.rest = false;
    it.pos.copy(pos);
    it.vel.copy(vel);
    it.quat.setFromEuler(new THREE.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6));
    it.axis.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
    it.spin = 4 + Math.random() * 10;
    if (kind === 'wheel') it.scale.setScalar(1);
    else it.scale.set(scale * (0.6 + Math.random() * 0.8), scale * (0.7 + Math.random() * 0.6), scale * (0.6 + Math.random() * 0.8));
    it.life = life * (0.8 + Math.random() * 0.4);
    it.burn = burn;
    it.trail = 0;
    // scorched: blast-blackened, a little of the original paint showing through
    P.mesh.setColorAt(idx, kind === 'wheel' ? _c.set(color) : _c.set(color).lerp(_soot, 0.5 + Math.random() * 0.3));
    P.mesh.instanceColor.needsUpdate = true;
  }

  update(dt, fx) {
    for (const P of Object.values(this.kinds)) {
      const { items, mesh, radius } = P;
      let any = false;
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (!it.alive) { mesh.setMatrixAt(i, _zero); continue; }
        any = true;
        it.life -= dt;
        if (it.life <= 0) { it.alive = false; mesh.setMatrixAt(i, _zero); continue; }
        if (!it.rest) {
          it.vel.y -= 16 * dt;
          const step = it.vel.length() * dt;
          // walls / props in the direction of travel
          if (step > 1e-4) {
            _d.copy(it.vel).normalize();
            const hit = this.physics.castRayStatic(it.pos, _d, step + radius);
            if (hit !== null && Math.abs(_d.y) < 0.8) {
              it.vel.x *= -0.35; it.vel.z *= -0.35;
              it.spin *= 0.6;
            }
          }
          it.pos.addScaledVector(it.vel, dt);
          // ground / deck below
          _o.set(it.pos.x, it.pos.y + 1.2, it.pos.z);
          const down = this.physics.castRayStatic(_o, DOWN, 1.2 + radius + 0.05);
          if (down !== null) {
            const floor = _o.y - down + radius * 0.6;
            if (it.pos.y < floor) {
              it.pos.y = floor;
              if (it.vel.y < 0) it.vel.y *= -0.32;
              it.vel.x *= 0.72; it.vel.z *= 0.72;
              it.spin *= 0.65;
              if (Math.abs(it.vel.y) < 1.2 && it.vel.x * it.vel.x + it.vel.z * it.vel.z < 0.5) {
                it.rest = true;
                // settle flat-ish
                if (P !== this.kinds.wheel) it.quat.slerp(_flat.setFromEuler(_e.set(0, Math.random() * 6, 0)), 0.7);
              }
            }
          }
          if (it.pos.y < -5) it.alive = false;
          _q.setFromAxisAngle(it.axis, it.spin * dt);
          it.quat.premultiply(_q);
        }
        // burning pieces trail fire + smoke
        if (it.burn > 0) {
          it.burn -= dt;
          it.trail += dt * (it.rest ? 10 : 34);
          while (it.trail >= 1) {
            it.trail -= 1;
            _v.set((Math.random() - 0.5) * 0.6, 0.6 + Math.random(), (Math.random() - 0.5) * 0.6);
            fx.fire.emit(it.pos, _v, { size: 0.35 + Math.random() * 0.3, grow: 0.6, life: 0.35 + Math.random() * 0.25, heat: 0.9 });
            if (Math.random() < 0.35) fx.smoke.emit(it.pos, _v.set(0, 1.2, 0), { color: [0.07, 0.065, 0.07], size: 0.5, grow: 2.2, life: 1.4, alpha: 0.35 });
          }
        }
        const shrink = Math.min(1, it.life / 1.2); // sink/shrink away at end of life
        _s.copy(it.scale).multiplyScalar(shrink);
        _m.compose(it.pos, it.quat, _s);
        mesh.setMatrixAt(i, _m);
      }
      if (any || P.dirty) {
        mesh.instanceMatrix.needsUpdate = true;
        P.dirty = any;
      }
    }
  }
}

/** Charred scorch decals left where cars blew up; fade out over ~40 s. */
class Scorches {
  constructor(scene, physics, max = 10) {
    this.physics = physics;
    const tex = radialGlowTexture(0.25, 1.4);
    this.pool = [];
    for (let i = 0; i < max; i++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({
        map: tex, color: 0x050403, transparent: true, opacity: 0, depthWrite: false,
        polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6,
      }));
      m.rotation.x = -Math.PI / 2;
      m.visible = false;
      m.renderOrder = 1;
      scene.add(m);
      this.pool.push({ m, life: 0 });
    }
    this.cursor = 0;
  }

  spawn(pos, size = 7) {
    const s = this.pool[this.cursor];
    this.cursor = (this.cursor + 1) % this.pool.length;
    _o.set(pos.x, pos.y + 2, pos.z);
    const d = this.physics.castRayStatic(_o, DOWN, 8);
    s.m.position.set(pos.x, (d !== null ? _o.y - d : 0) + 0.03, pos.z);
    s.m.rotation.z = Math.random() * 6;
    s.m.scale.setScalar(size * (0.85 + Math.random() * 0.3));
    s.life = 40;
    s.m.visible = true;
  }

  update(dt) {
    for (const s of this.pool) {
      if (!s.m.visible) continue;
      s.life -= dt;
      if (s.life <= 0) { s.m.visible = false; continue; }
      s.m.material.opacity = 0.85 * Math.min(1, s.life / 10);
    }
  }
}

const _zero = new THREE.Matrix4().makeScale(0, 0, 0);
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _flat = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _d = new THREE.Vector3();
const _o = new THREE.Vector3();
const _c = new THREE.Color();
const _w = new THREE.Vector3();
const _cv = new THREE.Vector3();
const _soot = new THREE.Color(0x141210);
const DOWN = new THREE.Vector3(0, -1, 0);
const rnd = (a, b) => a + Math.random() * (b - a);

export class Effects {
  constructor(scene, physics) {
    this.scene = scene;
    this.smoke = new Smoke();
    this.sparks = new Sparks();
    this.fire = new Fire();
    this.flashes = new Flashes(scene);
    this.skids = new SkidMarks();
    this.shockwaves = new Shockwaves(scene);
    this.debris = new Debris(scene, physics);
    this.scorches = new Scorches(scene, physics);
    this.timers = [];
    // One shared explosion light (always in the scene so materials never recompile; dark when idle).
    this.boomLight = new THREE.PointLight(0xff9a48, 0, 32, 1.6);
    this.boomLight.userData.energy = 0;
    scene.add(this.boomLight);
    scene.add(this.skids.mesh, this.smoke.points, this.fire.points, this.sparks.lines);
  }

  /** Run `fn` after `delay` seconds of game time (respects slow-mo; cleared with `clear()`). */
  after(delay, fn) {
    this.timers.push({ t: delay, fn });
  }

  clear() {
    this.timers.length = 0;
  }

  /** Remove all lingering wreckage (debris, scorch decals, pending pops) — new match / map switch. */
  reset() {
    this.clear();
    for (const P of Object.values(this.debris.kinds)) {
      for (const it of P.items) it.alive = false;
      P.dirty = true;
    }
    for (const s of this.scorches.pool) s.m.visible = false;
    this.boomLight.userData.energy = 0;
  }

  _light(pos, energy) {
    if (energy < this.boomLight.userData.energy * 0.5) return; // keep the bigger, fresher blast lit
    this.boomLight.position.set(pos.x, pos.y + 1.5, pos.z);
    this.boomLight.userData.energy = energy;
  }

  /** Short flame burst (muzzle-ish / secondary pops / fuel gush). */
  fireBurst(pos, count, { speed = 5, size = 1.2, life = 0.7, up = 0.5, vel = null } = {}) {
    for (let i = 0; i < count; i++) {
      _v.set(Math.random() - 0.5, Math.random() * 0.8 + up, Math.random() - 0.5).normalize().multiplyScalar(speed * rnd(0.3, 1));
      if (vel) _v.addScaledVector(vel, 0.35);
      _w.set(pos.x + (Math.random() - 0.5) * 0.8, pos.y + Math.random() * 0.4, pos.z + (Math.random() - 0.5) * 0.8);
      this.fire.emit(_w, _v, { size: size * rnd(0.7, 1.3), grow: size * 1.6, life: life * rnd(0.7, 1.3), heat: 1 });
    }
  }

  /**
   * A car being destroyed: white-hot flash, expanding fireball, shrapnel, a torn-off wheel or two, burning body panels
   * in the car's paint, a ground scorch, a rolling black smoke column and delayed secondary (fuel) pops.
   * opts: { paint, vel (car velocity), wheels: [world positions of wheels that come off], scale }
   */
  wreck(pos, { paint = '#777', vel = null, wheels = [], scale = 1 } = {}) {
    const cv = _cv.set(0, 0, 0);
    if (vel) cv.copy(vel).clampLength(0, 14);
    this.flashes.spawn(pos, '#ffe2b0', 7 * scale, 0.22);
    this.flashes.spawn(pos, '#ff6a1a', 12 * scale, 0.45);
    this.shockwaves.spawn(pos, '#ff9a40', 10 * scale, 0.75);
    this._light(pos, 70 * scale);
    // fireball: a dense core that rolls upward and a looser outer shell
    for (let i = 0; i < 48 * scale; i++) {
      const core = i < 20;
      _v.set(Math.random() - 0.5, Math.random() * 0.9 + 0.15, Math.random() - 0.5).normalize().multiplyScalar(rnd(core ? 1.5 : 4, core ? 4 : 10) * scale);
      _v.addScaledVector(cv, 0.3);
      _w.set(pos.x + _v.x * 0.08, pos.y + 0.3 + _v.y * 0.05, pos.z + _v.z * 0.08);
      this.fire.emit(_w, _v, { size: rnd(core ? 1.6 : 0.9, core ? 2.4 : 1.6) * scale, grow: (core ? 3 : 2) * scale, life: rnd(0.6, core ? 1.3 : 0.9), heat: 1 });
    }
    // shrapnel
    this.sparks.burst(pos, UP, Math.round(130 * scale), { speed: 22 * scale, spread: 1.7, life: 1.1, up: 0.45, color: [4.5, 2.6, 0.8] });
    // black smoke column + ground dust ring
    for (let i = 0; i < 34 * scale; i++) {
      _v.set((Math.random() - 0.5) * 3, rnd(2, 6), (Math.random() - 0.5) * 3).addScaledVector(cv, 0.2);
      _w.set(pos.x + (Math.random() - 0.5) * 2, pos.y + Math.random(), pos.z + (Math.random() - 0.5) * 2);
      const k = rnd(0.04, 0.1);
      this.smoke.emit(_w, _v, { color: [k, k * 0.92, k * 0.9], size: rnd(1.4, 2.4) * scale, grow: 7 * scale, life: rnd(2.6, 4.2), alpha: 0.95 });
    }
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2;
      _v.set(Math.cos(a) * rnd(6, 10), rnd(0.2, 1), Math.sin(a) * rnd(6, 10));
      _w.set(pos.x, pos.y - 0.4, pos.z);
      this.smoke.emit(_w, _v, { color: [0.45, 0.4, 0.36], size: 1.2, grow: 4, life: rnd(1.2, 2), alpha: 0.3 });
    }
    // wreckage
    for (let i = 0; i < 14; i++) {
      _v.set((Math.random() - 0.5) * 16, rnd(5, 13), (Math.random() - 0.5) * 16).addScaledVector(cv, 0.5);
      _w.set(pos.x + (Math.random() - 0.5) * 1.6, pos.y + 0.4, pos.z + (Math.random() - 0.5) * 3);
      this.debris.spawn('shard', _w, _v, i % 3 === 0 ? '#23252a' : paint, { scale: rnd(0.55, 1.05), burn: Math.random() < 0.45 ? rnd(1, 3) : 0 });
    }
    for (let i = 0; i < 4; i++) {
      _v.set((Math.random() - 0.5) * 12, rnd(6, 11), (Math.random() - 0.5) * 12).addScaledVector(cv, 0.5);
      _w.set(pos.x, pos.y + 0.6, pos.z);
      this.debris.spawn('panel', _w, _v, paint, { scale: rnd(0.7, 1.1), burn: rnd(0.8, 2.2) });
    }
    for (const wp of wheels) {
      _d.set(wp.x - pos.x, 0, wp.z - pos.z).normalize();
      _v.copy(_d).multiplyScalar(rnd(6, 10)).addScaledVector(cv, 0.6);
      _v.y = rnd(6, 9);
      this.debris.spawn('wheel', wp, _v, '#ffffff', { life: 12, burn: rnd(1.5, 3) });
    }
    this.scorches.spawn(pos, 8 * scale);
    // delayed secondary pops (fuel tank / ammo cook-off)
    const p0 = pos.clone();
    this.after(0.32, () => {
      _w.set(p0.x + rnd(-1, 1), p0.y + 0.4, p0.z + rnd(-1, 1));
      this.flashes.spawn(_w, '#ffa040', 5 * scale, 0.25);
      this.fireBurst(_w, 26, { speed: 7, size: 1.4 * scale, life: 0.8, up: 0.9 });
      this.sparks.burst(_w, UP, 40, { speed: 12, spread: 1.2, life: 0.8, up: 0.6 });
      this._light(_w, 45 * scale);
      this.onPop?.(_w, 0.6);
    });
    this.after(0.85, () => {
      _w.set(p0.x + rnd(-1.2, 1.2), p0.y + 0.3, p0.z + rnd(-1.2, 1.2));
      this.flashes.spawn(_w, '#ff8a30', 3.5 * scale, 0.2);
      this.fireBurst(_w, 16, { speed: 5, size: 1.1 * scale, life: 0.7, up: 1.2 });
      this.sparks.burst(_w, UP, 30, { speed: 9, spread: 1.4, life: 0.9, up: 0.8, color: [4, 2, 0.5] });
      this._light(_w, 28 * scale);
      this.onPop?.(_w, 0.4);
    });
  }

  /** Steady fire + smoke from a burning wreck (call per frame with dt). */
  burn(pos, dt, intensity = 1) {
    const n = Math.random() < dt * 60 * intensity ? 2 : 1;
    for (let i = 0; i < n; i++) {
      _v.set((Math.random() - 0.5) * 1.2, rnd(1.2, 2.6), (Math.random() - 0.5) * 1.2);
      _w.set(pos.x + (Math.random() - 0.5) * 1.4, pos.y + rnd(0.1, 0.5), pos.z + (Math.random() - 0.5) * 2.4);
      this.fire.emit(_w, _v, { size: rnd(0.6, 1.2) * intensity, grow: 1.2, life: rnd(0.4, 0.8), heat: 0.95 });
    }
    // thick oily smoke column rising off the fire
    this._burnSmoke = (this._burnSmoke ?? 0) + dt * 16 * intensity;
    while (this._burnSmoke >= 1) {
      this._burnSmoke -= 1;
      _v.set((Math.random() - 0.5) * 0.8, rnd(2.5, 4), (Math.random() - 0.5) * 0.8);
      _w.set(pos.x + (Math.random() - 0.5) * 1.2, pos.y + rnd(0.8, 1.4), pos.z + (Math.random() - 0.5) * 1.2);
      const k = rnd(0.035, 0.08);
      this.smoke.emit(_w, _v, { color: [k, k * 0.95, k * 0.92], size: rnd(0.9, 1.4), grow: 6.5, life: rnd(2.6, 3.8), alpha: 0.8 });
    }
    this._light(pos, Math.max(this.boomLight.userData.energy, 7 * intensity));
  }

  /** Composed "boom": flash + shockwave ring + spark shrapnel + billowing smoke. Reused for target kills etc. */
  explosion(pos, { color = '#ffb020', smokeColor = [0.5, 0.42, 0.3], scale = 1 } = {}) {
    this.flashes.spawn(pos, color, 8 * scale, 0.3);
    this.shockwaves.spawn(pos, color, 5.5 * scale, 0.55);
    this._light(pos, 50 * scale);
    this.fireBurst(pos, Math.round(26 * scale), { speed: 7 * scale, size: 1.1 * scale, life: 0.6, up: 0.4 });
    this.sparks.burst(pos, UP, Math.round(46 * scale), { speed: 13 * scale, spread: 1.3, life: 0.7, up: 0.6, color: [4.5, 2.4, 0.6] });
    const smokeCount = Math.round(14 * scale);
    for (let i = 0; i < smokeCount; i++) {
      const a = (i / smokeCount) * Math.PI * 2;
      const r = 0.3 + Math.random() * 1.2 * scale;
      _v.set(Math.cos(a) * (2 + Math.random() * 2) * scale, 2 + Math.random() * 3, Math.sin(a) * (2 + Math.random() * 2) * scale);
      this.smoke.emit(
        { x: pos.x + Math.cos(a) * r, y: pos.y + Math.random() * 0.6, z: pos.z + Math.sin(a) * r },
        _v,
        { color: [0.55, 0.32, 0.12], size: 1.4 * scale, grow: 5 * scale, life: 1.8 + Math.random() * 1.2, alpha: 0.4 },
      );
    }
  }

  update(dt, camera, renderer) {
    // Point size scale so smoke `size` is in world meters.
    const h = renderer.getDrawingBufferSize(_size).y;
    const scale = h / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
    this.smoke.material.uniforms.uScale.value = scale;
    this.fire.material.uniforms.uScale.value = scale;
    for (let i = this.timers.length - 1; i >= 0; i--) {
      const t = this.timers[i];
      t.t -= dt;
      if (t.t <= 0) {
        this.timers.splice(i, 1);
        t.fn();
      }
    }
    this.smoke.update(dt);
    this.fire.update(dt);
    this.sparks.update(dt);
    this.flashes.update(dt);
    this.shockwaves.update(dt);
    this.debris.update(dt, this);
    this.scorches.update(dt);
    this.skids.update();
    // explosion light: fast flicker-decay
    const L = this.boomLight;
    L.userData.energy *= Math.exp(-dt * 5.5);
    if (L.userData.energy < 0.5) L.userData.energy = 0;
    L.intensity = L.userData.energy * (0.85 + Math.random() * 0.3);
  }
}
