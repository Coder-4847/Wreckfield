import * as THREE from 'three';
import { PRIMARY } from './PrimaryWeapons.js';

// Roof-mounted forward-firing primary weapon (see PrimaryWeapons.js for the six types). One per vehicle (player and
// AI). Fire-rate gated; spawns projectiles through the shared Projectiles pool (or a hitscan beam via `onBeam`) and
// reports each shot back via `onFire` for muzzle FX/audio.
//
// Aim assist: the cannon sits above the height of a car's hull, so a perfectly level shot would sail over an
// enemy car. If an enemy is inside a narrow forward cone, the shot is pitched to hit its center (vertical
// auto-aim, standard for car combat), and optionally nudged horizontally by up to `aimAssist` radians.

const VERT_CONE = 0.2;   // rad (~11°) horizontal cone in which vertical auto-aim engages
const MAX_PITCH = 0.35;
const MAX_RANGE = 140;
const OVERCHARGE_TRACER = [1.0, 0.35, 0.28]; // overcharged rounds glow red-hot instead of the default warm tracer

const _pos = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _flat = new THREE.Vector3();
const _to = new THREE.Vector3();
const _best = new THREE.Vector3();
const _tf = new THREE.Vector3();
const _base = new THREE.Vector3();
const _up = new THREE.Vector3();
const _up2 = new THREE.Vector3();
const _side = new THREE.Vector3();

export class Weapon {
  constructor(owner, projectiles, { onFire, onBeam, getTargets, aimAssist = 0 } = {}) {
    this.owner = owner; // a Vehicle (or anything with .cfg, .body, .getMuzzleWorld, .applyRecoil)
    this.projectiles = projectiles;
    this.onFire = onFire ?? null;
    this.onBeam = onBeam ?? null;
    this.getTargets = getTargets ?? null;
    this.aimAssist = aimAssist;
    this.cooldown = 0;
    this.period = 0.2;   // seconds between the last shot and the next (for the reload readout)
    this.spin = 0;       // 0..1 chain-gun wind-up
    this.triggerHeld = false;
    this.setType('cannon');
  }

  setType(key) {
    this.key = PRIMARY[key] ? key : 'cannon';
    this.def = PRIMARY[this.key];
    this.cooldown = 0;
    this.spin = 0;
  }

  /** 0..1 readiness for the HUD: reload progress for slow weapons, wind-up for the chain gun. */
  get hudFrac() {
    if (this.def.hud === 'spin') return this.spin;
    if (this.def.hud === 'reload') return 1 - Math.min(1, this.cooldown / Math.max(0.001, this.period));
    return 1;
  }

  /** Call once per fixed step with the current fire input (held or edge — either works, rate-limited below). */
  update(dt, firing) {
    const def = this.def;
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.triggerHeld = firing;
    if (def.kind === 'spin') this.spin = Math.max(0, Math.min(1, this.spin + (firing ? dt / def.spinUp : -dt / def.spinDown)));
    if (!firing || this.cooldown > 0) return;
    const c = this.owner.cfg;
    const overcharged = this.owner.overcharge > 0;
    const rateMul = overcharged ? c.overchargeFireRateMult : 1;
    const dmgMul = overcharged ? c.overchargeDamageMult : 1;

    let rate;
    if (def.kind === 'bolt') rate = c.weaponFireRate;
    else if (def.kind === 'spin') rate = def.rateMin + (def.rateMax - def.rateMin) * this.spin * this.spin;
    else rate = def.rate;
    rate *= rateMul;
    this.period = this.cooldown = 1 / rate;

    this.owner.getMuzzleWorld(_pos, _dir);
    this._assist(_pos, _dir);
    const tracer = overcharged ? OVERCHARGE_TRACER : null;

    switch (def.kind) {
      case 'bolt':
        this.projectiles.spawn(_pos, _dir, this.owner.body, this.owner, {
          damage: c.weaponDamage * dmgMul, speed: c.weaponProjectileSpeed, life: c.weaponProjectileLife, kind: 'cannon', color: tracer,
        });
        break;
      case 'spin': {
        this._spread(_dir, def.spread * (1.6 - this.spin * 0.6));
        this.projectiles.spawn(_pos, _dir, this.owner.body, this.owner, {
          damage: def.damage * dmgMul, speed: def.speed, life: def.life, kind: 'minigun', color: tracer ?? [1.0, 0.72, 0.4],
        });
        break;
      }
      case 'pellet': {
        _base.copy(_dir);
        for (let i = 0; i < def.pellets; i++) {
          _dir.copy(_base);
          this._spread(_dir, def.spread, true);
          this.projectiles.spawn(_pos, _dir, this.owner.body, this.owner, {
            damage: def.damage * dmgMul, speed: def.speed * (0.92 + Math.random() * 0.16), life: def.life, kind: 'shotgun',
            color: tracer ?? [1.0, 0.66, 0.3],
          });
        }
        _dir.copy(_base);
        break;
      }
      case 'beam':
        this.onBeam?.(_pos, _dir, def, def.damage * dmgMul);
        break;
      case 'shell':
        this.projectiles.spawn(_pos, _dir, this.owner.body, this.owner, {
          damage: 0, speed: def.speed, life: def.life, kind: 'shell', color: [1.0, 0.55, 0.25],
        });
        break;
      case 'flame':
        this._spread(_dir, def.spread, true);
        this.projectiles.spawn(_pos, _dir, this.owner.body, this.owner, {
          damage: def.damage * dmgMul, speed: def.speed * (0.9 + Math.random() * 0.2), life: def.life * (0.85 + Math.random() * 0.3), kind: 'flame',
        });
        break;
      default: break;
    }
    if (def.kind === 'bolt') this.owner.applyRecoil?.(_dir);
    else for (let k = 0; k < Math.round((def.recoil ?? 0) + 0.4); k++) this.owner.applyRecoil?.(_dir);
    this.onFire?.(_pos, _dir, def.kind);
  }

  /** Perturb `dir` by a random angle up to `angle` (uniform disk when `disk`, else gaussian-ish jitter). */
  _spread(dir, angle, disk = false) {
    _up.set(0, 1, 0);
    _side.crossVectors(dir, _up);
    if (_side.lengthSq() < 1e-6) _side.set(1, 0, 0);
    _side.normalize();
    _up2.crossVectors(_side, dir).normalize();
    const r = disk ? Math.sqrt(Math.random()) * angle : (Math.random() + Math.random() - 1) * angle;
    const th = Math.random() * Math.PI * 2;
    dir.addScaledVector(_side, Math.cos(th) * r).addScaledVector(_up2, Math.sin(th) * r * 0.7).normalize();
  }

  /** Muzzle position + (aim-assisted) direction, for secondary weapons that fire from the same mount. */
  aim(outPos, outDir) {
    this.owner.getMuzzleWorld(outPos, outDir);
    this._assist(outPos, outDir);
  }

  _assist(pos, dir) {
    const targets = this.getTargets?.();
    if (!targets || !targets.length) return;
    _flat.set(dir.x, 0, dir.z);
    const fl = _flat.length();
    if (fl < 1e-3) return;
    _flat.divideScalar(fl);

    let found = false;
    let bestAng = VERT_CONE;
    for (const t of targets) {
      if (!t || t === this.owner || t.health?.dead) continue;
      _to.copy(t.currPos);
      _to.y += 0.3;
      _to.sub(pos);
      const hd = Math.hypot(_to.x, _to.z);
      if (hd < 1 || hd > MAX_RANGE) continue;
      const ang = Math.acos(Math.max(-1, Math.min(1, (_to.x * _flat.x + _to.z * _flat.z) / hd)));
      if (ang < bestAng) {
        bestAng = ang;
        found = true;
        _best.copy(_to);
      }
    }
    if (!found) return;

    const hd = Math.hypot(_best.x, _best.z);
    if (this.aimAssist > 0) {
      const k = Math.min(1, this.aimAssist / Math.max(bestAng, 1e-4));
      _tf.set(_best.x / hd, 0, _best.z / hd);
      _flat.lerp(_tf, k).normalize();
    }
    const pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, Math.atan2(_best.y, hd)));
    const cp = Math.cos(pitch);
    dir.set(_flat.x * cp, Math.sin(pitch), _flat.z * cp);
  }
}
