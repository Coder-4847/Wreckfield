import * as THREE from 'three';
import { radialGlowTexture, ringGlowTexture } from '../world/textures.js';
import { SEC } from './SecondaryWeapons.js';

// Pooled ordnance that isn't a plain bullet: homing missiles, proximity mines and pulse-laser beams.
// Logic runs in the fixed step (like Projectiles); visuals are interpolated per rendered frame.
// Detonations are reported through `onDetonate` so Game.js owns damage/FX/audio (one place for kill credit).

const MISSILE_POOL = 16;
const MINE_POOL = 16;
const BEAM_POOL = 8;

const FWD = new THREE.Vector3(0, 0, -1);
const DOWN = new THREE.Vector3(0, -1, 0);
const _t = new THREE.Vector3();
const _seg = new THREE.Vector3();
const _n = new THREE.Vector3();
const _p = new THREE.Vector3();
const _vel = new THREE.Vector3();
const _dir = new THREE.Vector3();

export class Ordnance {
  constructor(scene, physics, fx, { getVehicles, onDetonate, onLaserHit, onMineArm }) {
    this.scene = scene;
    this.physics = physics;
    this.fx = fx;
    this.getVehicles = getVehicles;
    this.onDetonate = onDetonate;
    this.onLaserHit = onLaserHit;
    this.onMineArm = onMineArm;
    this._buildMissiles();
    this._buildMines();
    this._buildBeams();
  }

  // ---------------------------------------------------------------------------
  // Build
  // ---------------------------------------------------------------------------
  _buildMissiles() {
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xc9ccd2, roughness: 0.45, metalness: 0.6 });
    const noseMat = new THREE.MeshStandardMaterial({ color: 0x2b2d33, roughness: 0.5, metalness: 0.5 });
    const bandMat = new THREE.MeshStandardMaterial({ color: 0xd9a21b, roughness: 0.5, metalness: 0.3 });
    const finMat = new THREE.MeshStandardMaterial({ color: 0x3a3d45, roughness: 0.55, metalness: 0.6 });
    const bodyGeo = new THREE.CylinderGeometry(0.1, 0.1, 1.1, 12).rotateX(Math.PI / 2);
    const noseGeo = new THREE.ConeGeometry(0.1, 0.34, 12).rotateX(-Math.PI / 2);
    const bandGeo = new THREE.CylinderGeometry(0.104, 0.104, 0.07, 12).rotateX(Math.PI / 2);
    const nozzleGeo = new THREE.CylinderGeometry(0.075, 0.09, 0.12, 10).rotateX(Math.PI / 2);
    const finGeo = new THREE.BoxGeometry(0.02, 0.24, 0.26);
    const flameTex = radialGlowTexture(0.0, 1.6);
    this.missiles = [];
    for (let i = 0; i < MISSILE_POOL; i++) {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(bodyGeo, bodyMat));
      const nose = new THREE.Mesh(noseGeo, noseMat);
      nose.position.z = -0.72;
      g.add(nose);
      const band = new THREE.Mesh(bandGeo, bandMat);
      band.position.z = -0.3;
      g.add(band);
      const nozzle = new THREE.Mesh(nozzleGeo, noseMat);
      nozzle.position.z = 0.6;
      g.add(nozzle);
      for (let k = 0; k < 4; k++) {
        const fin = new THREE.Mesh(finGeo, finMat);
        fin.position.z = 0.4;
        const holder = new THREE.Group();
        holder.rotation.z = (k * Math.PI) / 2;
        fin.position.y = 0.15;
        holder.add(fin);
        g.add(holder);
      }
      const flame = new THREE.Sprite(new THREE.SpriteMaterial({
        map: flameTex, color: new THREE.Color(1.0, 0.55, 0.2).multiplyScalar(3), transparent: true,
        blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
      }));
      flame.position.z = 0.95;
      flame.scale.setScalar(0.9);
      g.add(flame);
      g.visible = false;
      g.castShadow = false;
      this.scene.add(g);
      this.missiles.push({
        g, flame, active: false, pos: new THREE.Vector3(), prev: new THREE.Vector3(), dir: new THREE.Vector3(0, 0, -1),
        speed: 0, life: 0, age: 0, owner: null, ownerBody: null, target: null, trailAcc: 0,
      });
    }
  }

  _buildMines() {
    const baseMat = new THREE.MeshStandardMaterial({ color: 0x3d4033, roughness: 0.7, metalness: 0.45 });
    const plateMat = new THREE.MeshStandardMaterial({ color: 0x25271f, roughness: 0.55, metalness: 0.6 });
    const baseGeo = new THREE.CylinderGeometry(0.66, 0.74, 0.16, 20);
    const plateGeo = new THREE.CylinderGeometry(0.44, 0.5, 0.09, 20);
    const ledGeo = new THREE.SphereGeometry(0.075, 10, 8);
    const ringTex = ringGlowTexture(0.06, 1.4);
    const glowTex = radialGlowTexture(0.0, 1.8);
    this.mines = [];
    for (let i = 0; i < MINE_POOL; i++) {
      const g = new THREE.Group();
      const base = new THREE.Mesh(baseGeo, baseMat);
      base.position.y = 0.08;
      g.add(base);
      const plate = new THREE.Mesh(plateGeo, plateMat);
      plate.position.y = 0.19;
      g.add(plate);
      const ledMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.1, 0.08).multiplyScalar(3), toneMapped: false });
      const led = new THREE.Mesh(ledGeo, ledMat);
      led.position.y = 0.27;
      g.add(led);
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTex, color: new THREE.Color(1, 0.12, 0.08).multiplyScalar(2), transparent: true,
        blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
      }));
      glow.position.y = 0.3;
      glow.scale.setScalar(0.7);
      g.add(glow);
      // Trigger-radius marker: only visible once armed, so enemies can read the danger zone.
      const ring = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1),
        new THREE.MeshBasicMaterial({
          map: ringTex, color: new THREE.Color(1, 0.15, 0.1).multiplyScalar(1.6), transparent: true,
          blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false,
        }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.05;
      g.add(ring);
      g.visible = false;
      g.traverse((o) => { o.castShadow = o.isMesh && o !== ring; });
      this.scene.add(g);
      this.mines.push({
        g, ledMat, glow, ring, active: false, pos: new THREE.Vector3(), owner: null, armT: 0, life: 0, armed: false, phase: 0,
      });
    }
  }

  _buildBeams() {
    const geo = new THREE.CylinderGeometry(1, 1, 1, 10, 1, true).rotateX(Math.PI / 2).translate(0, 0, -0.5);
    this.beams = [];
    for (let i = 0; i < BEAM_POOL; i++) {
      const core = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
        color: new THREE.Color(4, 4, 4), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false,
      }));
      const halo = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
        color: new THREE.Color(0.3, 1.2, 3), transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending,
        depthWrite: false, toneMapped: false, fog: false,
      }));
      const g = new THREE.Group();
      g.add(core, halo);
      g.visible = false;
      g.renderOrder = 7;
      this.scene.add(g);
      this.beams.push({ g, core, halo, life: 0, maxLife: 1, length: 1 });
    }
    this.beamCursor = 0;
  }

  // ---------------------------------------------------------------------------
  // Spawning
  // ---------------------------------------------------------------------------
  fireMissile(owner, pos, dir, target) {
    let m = this.missiles.find((x) => !x.active);
    if (!m) m = this.missiles[0];
    m.active = true;
    m.pos.copy(pos);
    m.prev.copy(pos);
    m.dir.copy(dir).normalize();
    m.speed = SEC.missileLaunchSpeed;
    m.life = SEC.missileLife;
    m.age = 0;
    m.owner = owner;
    m.ownerBody = owner.body;
    m.target = target ?? null;
    m.trailAcc = 0;
    m.g.visible = true;
  }

  dropMine(owner, pos) {
    const mine = this.mines.filter((x) => x.active && x.owner === owner);
    if (mine.length >= SEC.mineMax) {
      mine.sort((a, b) => a.life - b.life)[0].active = false; // recycle the oldest
    }
    let m = this.mines.find((x) => !x.active);
    if (!m) m = this.mines[0];
    // Settle onto the ground under the drop point.
    _p.copy(pos);
    _p.y += 1.5;
    const hit = this.physics.castRay(_p, DOWN, 5, owner.body, 1);
    m.pos.set(pos.x, hit ? hit.point.y : pos.y - 0.5, pos.z);
    m.active = true;
    m.owner = owner;
    m.armT = SEC.mineArmTime;
    m.armed = false;
    m.life = SEC.mineLife;
    m.phase = Math.random() * 6;
    m.g.position.copy(m.pos);
    m.g.visible = true;
    const r = SEC.mineTrigger * 2;
    m.ring.scale.set(r, r, 1);
  }

  /** Hitscan beam. Returns nothing; damage is applied by the onLaserHit callback. */
  fireLaser(owner, origin, dir, color = null) {
    const range = SEC.laserRange;
    const hit = this.physics.castRay(origin, dir, range, owner.body, 1);
    const dist = hit ? hit.distance : range;
    const b = this.beams[this.beamCursor];
    this.beamCursor = (this.beamCursor + 1) % this.beams.length;
    b.g.position.copy(origin);
    _t.copy(origin).add(_seg.copy(dir).multiplyScalar(dist));
    b.g.lookAt(_t);
    b.length = dist;
    b.life = b.maxLife = SEC.laserBeamTime;
    b.g.visible = true;
    if (color) b.halo.material.color.setRGB(color[0], color[1], color[2]);
    if (hit) {
      _n.set(hit.normal.x, hit.normal.y, hit.normal.z);
      this.onLaserHit?.(_t.clone(), _n.clone(), this.physics.getEntity(hit.collider), owner);
    } else {
      this.onLaserHit?.(_t.clone(), null, null, owner);
    }
  }

  clear() {
    for (const m of this.missiles) { m.active = false; m.g.visible = false; }
    for (const m of this.mines) { m.active = false; m.g.visible = false; }
    for (const b of this.beams) { b.life = 0; b.g.visible = false; }
  }

  // ---------------------------------------------------------------------------
  // Simulation (fixed step)
  // ---------------------------------------------------------------------------
  update(dt) {
    const vehicles = this.getVehicles();
    for (const m of this.missiles) if (m.active) this._stepMissile(m, dt, vehicles);
    for (const m of this.mines) if (m.active) this._stepMine(m, dt, vehicles);
  }

  _detonateMissile(m, pos) {
    m.active = false;
    m.g.visible = false;
    this.onDetonate({ kind: 'missile', pos: pos.clone(), radius: SEC.missileRadius, damage: SEC.missileDamage, knock: SEC.missileKnock, lift: 4, owner: m.owner });
  }

  _stepMissile(m, dt, vehicles) {
    m.prev.copy(m.pos);
    m.life -= dt;
    m.age += dt;
    if (m.life <= 0) { this._detonateMissile(m, m.pos); return; }

    // Guidance: a limited turn rate makes it dodgeable, and it only starts tracking after clearing the launcher.
    const tgt = m.target;
    if (tgt && !tgt.health.dead && m.age > 0.3) {
      _t.copy(tgt.currPos);
      _t.y += 0.5;
      _t.sub(m.pos);
      const d = _t.length();
      if (d > 0.1) {
        _t.divideScalar(d);
        const ang = Math.acos(Math.min(1, Math.max(-1, m.dir.dot(_t))));
        if (ang > 1e-4) m.dir.lerp(_t, Math.min(1, (SEC.missileTurnRate * dt) / ang)).normalize();
      }
    } else if (tgt?.health.dead) {
      m.target = null;
    }
    m.speed = Math.min(SEC.missileSpeed, m.speed + SEC.missileAccel * dt);

    _seg.copy(m.dir).multiplyScalar(m.speed * dt);
    const segLen = _seg.length();
    const hit = this.physics.castRay(m.pos, m.dir, segLen, m.ownerBody, 1);
    if (hit) {
      _p.set(hit.point.x, hit.point.y, hit.point.z).addScaledVector(m.dir, -0.25);
      this._detonateMissile(m, _p);
      return;
    }
    m.pos.add(_seg);

    // Proximity fuse on any other live vehicle (after a short arming distance).
    if (m.age > 0.2) {
      const r2 = SEC.missileFuse * SEC.missileFuse;
      for (const v of vehicles) {
        if (v === m.owner || v.health.dead) continue;
        if (v.currPos.distanceToSquared(m.pos) < r2) { this._detonateMissile(m, m.pos); return; }
      }
    }

    // Smoke trail (grey, soft) — emitted at ~70 Hz regardless of fixed-step rate.
    m.trailAcc += dt * 70;
    while (m.trailAcc >= 1) {
      m.trailAcc -= 1;
      _vel.copy(m.dir).multiplyScalar(-2).add(_n.set((Math.random() - 0.5) * 0.6, 0.2 + Math.random() * 0.3, (Math.random() - 0.5) * 0.6));
      _p.copy(m.pos).addScaledVector(m.dir, -0.9);
      this.fx.smoke.emit(_p, _vel, { color: [0.72, 0.72, 0.75], size: 0.35, grow: 1.9, life: 1.1 + Math.random() * 0.5, alpha: 0.32 });
    }
  }

  _stepMine(m, dt, vehicles) {
    m.life -= dt;
    if (m.life <= 0) { m.active = false; m.g.visible = false; return; }
    if (!m.armed) {
      m.armT -= dt;
      if (m.armT <= 0) {
        m.armed = true;
        this.onMineArm?.(m);
      }
      return;
    }
    const trig = SEC.mineTrigger;
    for (const v of vehicles) {
      if (v === m.owner || v.health.dead || v.health.invuln > 0) continue;
      const dx = v.currPos.x - m.pos.x, dz = v.currPos.z - m.pos.z, dy = v.currPos.y - m.pos.y;
      if (dx * dx + dz * dz < trig * trig && Math.abs(dy) < 2.4) {
        m.active = false;
        m.g.visible = false;
        _p.copy(m.pos);
        _p.y += 0.3;
        this.onDetonate({ kind: 'mine', pos: _p.clone(), radius: SEC.mineRadius, damage: SEC.mineDamage, knock: SEC.mineKnock, lift: SEC.mineLaunch, owner: m.owner });
        return;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Visuals (per rendered frame)
  // ---------------------------------------------------------------------------
  syncVisual(alpha, dt, time) {
    for (const m of this.missiles) {
      if (!m.active) { m.g.visible = false; continue; }
      m.g.visible = true;
      m.g.position.lerpVectors(m.prev, m.pos, alpha);
      m.g.quaternion.setFromUnitVectors(FWD, m.dir);
      m.flame.scale.setScalar(0.75 + Math.random() * 0.35);
    }
    for (const m of this.mines) {
      if (!m.active) { m.g.visible = false; continue; }
      const blink = m.armed
        ? (Math.sin(time * 9 + m.phase) > 0 ? 1 : 0.15)
        : (Math.sin(time * 3 + m.phase) > 0.6 ? 0.8 : 0.1);
      m.ledMat.color.setRGB(3 * blink, 0.3 * blink, 0.25 * blink);
      m.glow.material.opacity = blink * 0.9;
      m.ring.visible = m.armed;
      m.ring.material.opacity = 0.25 + 0.2 * blink;
    }
    for (const b of this.beams) {
      if (b.life <= 0) { b.g.visible = false; continue; }
      b.life -= dt;
      const t = Math.max(0, b.life / b.maxLife);
      b.g.visible = b.life > 0;
      const w = 0.03 + 0.05 * t;
      b.core.scale.set(w, w, b.length);
      b.halo.scale.set(w * 4.5, w * 4.5, b.length);
      b.halo.material.opacity = 0.6 * t;
      b.core.material.opacity = t;
    }
  }
}
