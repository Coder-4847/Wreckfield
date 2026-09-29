import * as THREE from 'three';
import { createNoise } from './textures.js';

// Supply crates: physical hard-cases with a painted icon plate, sitting on a ground marking with a faint
// beacon column so they read from across the arena. Each kind has its own crate color + icon.

export const PICKUP_TYPES = {
  health: { color: '#4fd16a', body: '#d9dde2', label: 'REPAIR KIT', respawnDelay: 11, radius: 0.62 },
  boost: { color: '#3aa7ff', body: '#1f4f8f', label: 'NITRO CELL', respawnDelay: 10, radius: 0.58 },
  overcharge: { color: '#ffd23a', body: '#4a4630', label: 'OVERCHARGE', respawnDelay: 15, radius: 0.6 },
  missile: { color: '#ff8a3c', body: '#4f5a3a', label: 'HOMING MISSILE', respawnDelay: 20, radius: 0.6 },
  mine: { color: '#ff4b4b', body: '#4a4d3f', label: 'PROXIMITY MINES', respawnDelay: 20, radius: 0.6 },
  scatter: { color: '#ffc04a', body: '#5a4a32', label: 'FLAK SCATTER', respawnDelay: 20, radius: 0.6 },
  laser: { color: '#5cd6ff', body: '#2f3a44', label: 'PULSE LASER', respawnDelay: 22, radius: 0.6 },
};

const SECONDARY_KINDS = new Set(['missile', 'mine', 'scatter', 'laser']);
export const isSecondaryKind = (k) => SECONDARY_KINDS.has(k);

function drawIcon(ctx, kind) {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 12;
  if (kind === 'health') {
    const a = 60, w = 21;
    ctx.beginPath();
    ctx.moveTo(-w, -a); ctx.lineTo(w, -a); ctx.lineTo(w, -w); ctx.lineTo(a, -w);
    ctx.lineTo(a, w); ctx.lineTo(w, w); ctx.lineTo(w, a); ctx.lineTo(-w, a);
    ctx.lineTo(-w, w); ctx.lineTo(-a, w); ctx.lineTo(-a, -w); ctx.lineTo(-w, -w);
    ctx.closePath(); ctx.fill();
  } else if (kind === 'boost') {
    ctx.beginPath();
    ctx.moveTo(-6, -66); ctx.lineTo(44, -8); ctx.lineTo(8, -8);
    ctx.lineTo(24, 66); ctx.lineTo(-44, 6); ctx.lineTo(-8, 6);
    ctx.closePath(); ctx.fill();
  } else if (kind === 'overcharge') {
    ctx.beginPath();
    for (let i = 0; i < 12; i++) {
      const a0 = (i / 12) * Math.PI * 2;
      const r = i % 2 === 0 ? 66 : 30;
      const x = Math.cos(a0) * r, y = Math.sin(a0) * r;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath(); ctx.fill();
  } else if (kind === 'missile') {
    ctx.beginPath();
    ctx.moveTo(0, -70); ctx.quadraticCurveTo(24, -40, 20, 22); ctx.lineTo(-20, 22); ctx.quadraticCurveTo(-24, -40, 0, -70);
    ctx.fill();
    ctx.beginPath(); ctx.moveTo(-20, 8); ctx.lineTo(-44, 40); ctx.lineTo(-20, 34); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(20, 8); ctx.lineTo(44, 40); ctx.lineTo(20, 34); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-10, 34); ctx.lineTo(10, 34); ctx.lineTo(0, 66); ctx.closePath(); ctx.fill();
  } else if (kind === 'mine') {
    ctx.beginPath(); ctx.arc(0, 0, 30, 0, Math.PI * 2); ctx.fill();
    for (let i = 0; i < 8; i++) {
      const a0 = (i / 8) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a0) * 38, Math.sin(a0) * 38);
      ctx.lineTo(Math.cos(a0) * 64, Math.sin(a0) * 64);
      ctx.stroke();
    }
  } else if (kind === 'scatter') {
    for (const a0 of [-0.5, -0.25, 0, 0.25, 0.5]) {
      ctx.beginPath();
      ctx.moveTo(-58, 0);
      ctx.lineTo(Math.cos(a0) * 62, Math.sin(a0) * 62);
      ctx.stroke();
    }
    ctx.beginPath(); ctx.arc(-58, 0, 9, 0, Math.PI * 2); ctx.fill();
  } else {
    // laser: emitter lens + beam
    ctx.beginPath(); ctx.arc(-34, 0, 24, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(-34, 0, 9, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-6, 0); ctx.lineTo(66, 0); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(48, -18); ctx.lineTo(66, 0); ctx.lineTo(48, 18); ctx.stroke();
  }
}

function crateTexture(kind, def) {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d');
  const n = createNoise(kind.length * 17 + 3);
  ctx.fillStyle = def.body;
  ctx.fillRect(0, 0, S, S);
  // worn paint speckle
  for (let i = 0; i < 700; i++) {
    ctx.fillStyle = `rgba(${n.rnd() < 0.5 ? '0,0,0' : '255,255,255'},${0.03 + n.rnd() * 0.06})`;
    ctx.fillRect(n.rnd() * S, n.rnd() * S, 1 + n.rnd() * 4, 1 + n.rnd() * 2);
  }
  // reinforcement frame + accent bands
  ctx.strokeStyle = 'rgba(0,0,0,0.45)';
  ctx.lineWidth = 8;
  ctx.strokeRect(6, 6, S - 12, S - 12);
  ctx.fillStyle = def.color;
  ctx.fillRect(14, 14, S - 28, 16);
  ctx.fillRect(14, S - 30, S - 28, 16);
  // icon plate
  ctx.fillStyle = 'rgba(245,246,248,0.94)';
  ctx.beginPath();
  ctx.roundRect(46, 46, S - 92, S - 92, 22);
  ctx.fill();
  ctx.save();
  ctx.translate(S / 2, S / 2);
  ctx.scale(0.86, 0.86);
  ctx.fillStyle = def.color;
  ctx.strokeStyle = def.color;
  // darker outline pass for contrast on the white plate
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = 4;
  drawIcon(ctx, kind);
  ctx.restore();
  // rivets
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  for (const [x, y] of [[26, 40], [S - 26, 40], [26, S - 40], [S - 26, S - 40]]) {
    ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

let beaconAlpha = null;
function beaconAlphaMap() {
  if (beaconAlpha) return beaconAlpha;
  const c = document.createElement('canvas');
  c.width = 4; c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 64);
  g.addColorStop(0, '#000'); g.addColorStop(0.85, '#fff'); g.addColorStop(1, '#fff');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 4, 64);
  beaconAlpha = new THREE.CanvasTexture(c);
  return beaconAlpha;
}

function groundMarkTexture(color) {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d');
  ctx.strokeStyle = color;
  ctx.lineWidth = 6;
  ctx.globalAlpha = 0.75;
  ctx.beginPath(); ctx.arc(S / 2, S / 2, S / 2 - 8, 0, Math.PI * 2); ctx.stroke();
  ctx.lineWidth = 3;
  ctx.globalAlpha = 0.5;
  ctx.beginPath(); ctx.arc(S / 2, S / 2, S / 2 - 22, 0, Math.PI * 2); ctx.stroke();
  // corner ticks
  ctx.globalAlpha = 0.85;
  ctx.lineWidth = 6;
  for (let i = 0; i < 4; i++) {
    const a0 = (i * Math.PI) / 2 + Math.PI / 4;
    ctx.beginPath();
    ctx.moveTo(S / 2 + Math.cos(a0) * (S / 2 - 8), S / 2 + Math.sin(a0) * (S / 2 - 8));
    ctx.lineTo(S / 2 + Math.cos(a0) * (S / 2 - 24), S / 2 + Math.sin(a0) * (S / 2 - 24));
    ctx.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Pickup {
  constructor(physics, scene, position, kind, id = 0) {
    this.physics = physics; this.scene = scene;
    this.spawnPos = position.clone(); this.kind = kind; this.id = id;
    this.isPickup = true; this.def = PICKUP_TYPES[kind];
    this.available = true; this.respawnTimer = 0; this.bob = Math.random() * Math.PI * 2;
    this.onCollected = null;
    this._buildBody(); this._buildVisual();
  }

  _buildBody() {
    const R = this.physics.R, world = this.physics.world;
    const bodyDesc = R.RigidBodyDesc.fixed().setTranslation(this.spawnPos.x, this.spawnPos.y + 0.9, this.spawnPos.z);
    this.body = world.createRigidBody(bodyDesc);
    const desc = R.ColliderDesc.ball(this.def.radius + 0.35).setSensor(true).setActiveEvents(R.ActiveEvents.COLLISION_EVENTS);
    this.collider = world.createCollider(desc, this.body);
    this.physics.registerCollider(this.collider, this);
  }

  _buildVisual() {
    const group = new THREE.Group();
    group.position.copy(this.spawnPos);
    this.scene.add(group); this.group = group;
    const color = new THREE.Color(this.def.color);

    // Painted ground marking (normal blending — it's paint, not a light).
    const pad = new THREE.Mesh(
      new THREE.PlaneGeometry(2.7, 2.7),
      new THREE.MeshBasicMaterial({ map: groundMarkTexture(this.def.color), transparent: true, depthWrite: false, fog: true }),
    );
    pad.rotation.x = -Math.PI / 2; pad.position.y = 0.035; pad.renderOrder = 1;
    group.add(pad); this.pad = pad;

    // Faint beacon column (additive) so crates are findable from across the map.
    const beacon = new THREE.Mesh(
      new THREE.CylinderGeometry(0.28, 0.34, 3.6, 14, 1, true),
      new THREE.MeshBasicMaterial({
        color: color.clone().multiplyScalar(1.3), alphaMap: beaconAlphaMap(), transparent: true, opacity: 0.22,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false,
      }),
    );
    beacon.position.y = 1.8;
    group.add(beacon); this.beacon = beacon;

    const item = new THREE.Group();
    item.position.y = 0.9;
    group.add(item); this.item = item;

    const faceMat = new THREE.MeshStandardMaterial({ map: crateTexture(this.kind, this.def), roughness: 0.6, metalness: 0.35 });
    const plainMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(this.def.body).multiplyScalar(0.7), roughness: 0.7, metalness: 0.4 });
    const crate = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.72, 0.95), [faceMat, faceMat, plainMat, plainMat, faceMat, faceMat]);
    crate.castShadow = true;
    item.add(crate);
    // Corner guards + handle for a rugged, real-object silhouette.
    const guardMat = new THREE.MeshStandardMaterial({ color: 0x1b1d21, roughness: 0.55, metalness: 0.7 });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const guard = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.76, 0.12), guardMat);
      guard.position.set(sx * 0.47, 0, sz * 0.47);
      item.add(guard);
    }
    const handle = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.025, 6, 14, Math.PI), guardMat);
    handle.position.y = 0.36;
    item.add(handle);
  }

  _setVisible(v) {
    this.item.visible = v;
    this.beacon.visible = v;
    this.pad.material.opacity = v ? 1 : 0.25;
  }

  /** Remove from the scene and physics world (map change). */
  dispose() {
    this.physics.unregisterCollider(this.collider);
    this.physics.world.removeRigidBody(this.body); // also removes its collider
    this.scene.remove(this.group);
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) { m.map?.dispose(); m.dispose(); }
      }
    });
  }

  collect() {
    if (!this.available) return false;
    this.available = false;
    this.respawnTimer = this.def.respawnDelay;
    this._setVisible(false);
    return true;
  }

  respawn() {
    this.available = true;
    this._setVisible(true);
    this.materializeT = 0;
  }

  update(dt) {
    if (!this.available) {
      this.respawnTimer -= dt;
      if (this.respawnTimer <= 0) this.respawn();
      return;
    }
    this.bob += dt;
    this.item.position.y = 0.9 + Math.sin(this.bob * 1.6) * 0.1;
    this.item.rotation.y += dt * 0.9;
    this.beacon.material.opacity = 0.18 + Math.sin(this.bob * 2.2) * 0.05;
    if (this.materializeT !== undefined && this.materializeT < 1) {
      this.materializeT = Math.min(1, this.materializeT + dt * 2.5);
      const s = Math.sin(this.materializeT * Math.PI * 0.5);
      this.item.scale.setScalar(s);
      this.beacon.material.opacity = 0.5 * (1 - this.materializeT) + 0.18;
      if (this.materializeT >= 1) this.materializeT = undefined;
    }
  }
}
