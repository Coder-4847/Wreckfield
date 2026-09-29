import * as THREE from 'three';
import { radialGlowTexture } from './textures.js';

// Camera-local weather: a fixed pool of particles living in a box around the focus point (the player), wrapping
// as the focus moves. rain = falling streaks, snow = drifting flakes, dust = big slow soft motes.

const BOX = 46;    // half-extent in x/z (m)
const HEIGHT = 34; // m

export class Weather {
  constructor(scene, kind, { count = 1400, wind = [0, 0] } = {}) {
    this.kind = kind;
    this.wind = wind;
    this.count = count;
    this.pos = new Float32Array(count * 3);
    this.vel = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      this.pos[i * 3] = (Math.random() * 2 - 1) * BOX;
      this.pos[i * 3 + 1] = Math.random() * HEIGHT;
      this.pos[i * 3 + 2] = (Math.random() * 2 - 1) * BOX;
      const k = kind === 'rain' ? 26 + Math.random() * 8 : kind === 'snow' ? 1.6 + Math.random() * 1.4 : 0.15 + Math.random() * 0.3;
      this.vel[i * 3] = wind[0] + (kind === 'dust' ? (Math.random() - 0.5) * 0.6 : (Math.random() - 0.5) * (kind === 'snow' ? 0.8 : 0.3));
      this.vel[i * 3 + 1] = -k;
      this.vel[i * 3 + 2] = wind[1] + (kind === 'dust' ? (Math.random() - 0.5) * 0.6 : (Math.random() - 0.5) * (kind === 'snow' ? 0.8 : 0.3));
    }
    this.focus = new THREE.Vector3();
    if (kind === 'rain') {
      // two verts per drop (a short streak along the fall direction)
      this.line = new Float32Array(count * 6);
      const g = new THREE.BufferGeometry();
      this.attr = new THREE.BufferAttribute(this.line, 3).setUsage(THREE.DynamicDrawUsage);
      g.setAttribute('position', this.attr);
      g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
      this.obj = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xaab8c8, transparent: true, opacity: 0.32, depthWrite: false, fog: true }));
    } else {
      const g = new THREE.BufferGeometry();
      this.attr = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
      g.setAttribute('position', this.attr);
      g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
      const snow = kind === 'snow';
      this.obj = new THREE.Points(g, new THREE.PointsMaterial({
        map: radialGlowTexture(0, 1.4), color: snow ? 0xffffff : 0xd9c19a, size: snow ? 0.22 : 2.4,
        transparent: true, opacity: snow ? 0.85 : 0.16, depthWrite: false, sizeAttenuation: true, fog: true,
      }));
    }
    this.obj.frustumCulled = false;
    this.obj.renderOrder = 9;
    scene.add(this.obj);
    this.scene = scene;
  }

  update(dt, focus) {
    const P = this.pos, V = this.vel, n = this.count;
    const fx = focus.x, fz = focus.z;
    const rain = this.kind === 'rain';
    for (let i = 0; i < n; i++) {
      const j = i * 3;
      P[j] += V[j] * dt; P[j + 1] += V[j + 1] * dt; P[j + 2] += V[j + 2] * dt;
      if (this.kind === 'snow') P[j] += Math.sin(P[j + 1] * 0.6 + i) * 0.4 * dt;
      // wrap horizontally around the focus, and recycle at the ground / top
      if (P[j] < fx - BOX) P[j] += BOX * 2; else if (P[j] > fx + BOX) P[j] -= BOX * 2;
      if (P[j + 2] < fz - BOX) P[j + 2] += BOX * 2; else if (P[j + 2] > fz + BOX) P[j + 2] -= BOX * 2;
      if (P[j + 1] < 0) { P[j + 1] += HEIGHT; }
      else if (P[j + 1] > HEIGHT) P[j + 1] -= HEIGHT;
      if (rain) {
        const o = i * 6;
        this.line[o] = P[j]; this.line[o + 1] = P[j + 1]; this.line[o + 2] = P[j + 2];
        this.line[o + 3] = P[j] - V[j] * 0.035; this.line[o + 4] = P[j + 1] - V[j + 1] * 0.035; this.line[o + 5] = P[j + 2] - V[j + 2] * 0.035;
      }
    }
    this.attr.needsUpdate = true;
    if (rain) this.obj.geometry.setDrawRange(0, n * 2);
  }

  dispose() {
    this.scene.remove(this.obj);
    this.obj.geometry.dispose();
    this.obj.material.dispose();
  }
}
