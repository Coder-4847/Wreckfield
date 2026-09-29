import * as THREE from 'three';

// Roof-mounted forward-firing cannon. One per vehicle (player and AI). Fire-rate gated; spawns projectiles
// through the shared Projectiles pool and reports each shot back via `onFire` for muzzle FX/audio.
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

export class Weapon {
  constructor(owner, projectiles, { onFire, getTargets, aimAssist = 0 } = {}) {
    this.owner = owner; // a Vehicle (or anything with .cfg, .body, .getMuzzleWorld, .applyRecoil)
    this.projectiles = projectiles;
    this.onFire = onFire ?? null;
    this.getTargets = getTargets ?? null;
    this.aimAssist = aimAssist;
    this.cooldown = 0;
    this.triggerHeld = false;
  }

  /** Call once per fixed step with the current fire input (held or edge — either works, rate-limited below). */
  update(dt, firing) {
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.triggerHeld = firing;
    if (!firing || this.cooldown > 0) return;
    const c = this.owner.cfg;
    const overcharged = this.owner.overcharge > 0;
    const fireRate = overcharged ? c.weaponFireRate * c.overchargeFireRateMult : c.weaponFireRate;
    const damage = overcharged ? c.weaponDamage * c.overchargeDamageMult : c.weaponDamage;
    this.cooldown = 1 / fireRate;

    this.owner.getMuzzleWorld(_pos, _dir);
    this._assist(_pos, _dir);
    this.projectiles.spawn(_pos, _dir, this.owner.body, this.owner, {
      damage,
      speed: c.weaponProjectileSpeed,
      life: c.weaponProjectileLife,
      kind: 'cannon',
      color: overcharged ? OVERCHARGE_TRACER : null,
    });
    this.owner.applyRecoil?.(_dir);
    this.onFire?.(_pos, _dir);
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
