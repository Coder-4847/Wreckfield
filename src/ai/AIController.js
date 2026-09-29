import * as THREE from 'three';

// AI driver for a Vehicle. Produces the same control shape the player's Input does
// ({throttle, brake, steer, handbrake, fire}), so the AI drives the exact same physics car.
//
// Layers:
//  1. Perception — the target's position/velocity and line of sight are sampled every `reaction` seconds (not
//     every frame), then dead-reckoned in between. This is the main "human-like" difficulty knob.
//  2. Behaviour — a small state machine picks a *desired direction*:
//       engage  : drive at the target's predicted intercept point (the gun is fixed forward, so pointing the car
//                 at the target IS aiming), with a smooth wobble of amplitude `aimError`.
//       pass    : at close range, non-rammers swerve past instead of colliding, then loop back (jousting passes).
//       retreat : when low on health, disengage and weave away for a few seconds.
//       unstick : wedged against something -> reverse with opposite lock.
//  3. Context steering — score 16 directions around the car: interest = alignment with the desired direction,
//     danger = proximity of static obstacles along a horizontal ray. Pick the best, refined by parabolic
//     interpolation. If the exact desired direction is clear, use it directly (keeps aim precise).
//  4. Control mapping — signed heading error -> steer; throttle/handbrake from error + speed (handbrake drift
//     turns when the target is behind at speed).
//  5. Fire control — fires in bursts only with line of sight, in range, and inside an aim cone (which widens at
//     close range where the car is physically large).

// Difficulty tiers: purely numeric tuning. Driver identity (name/number/livery/behavioral archetype) is a
// separate, fixed roster (see Game.js's AI_ROSTER) — a match's difficulty scales every bot on the roster at once
// rather than picking a single named opponent, since Phase 5 is a free-for-all against the whole roster.
export const AI_PROFILES = {
  easy: {
    label: 'ROOKIE',
    blurb: 'Slow reactions, sloppy aim. Learn the ropes.',
    reaction: 0.42, aimError: 0.14, lead: 0.25, fireCone: 0.13, fireRange: 55,
    burstLen: [0.3, 0.7], burstPause: [0.8, 1.6],
    aggression: 0.3, preferredRange: 26, passRange: 9, retreatHealth: 0.35,
    steerGain: 1.7, throttleScale: 0.82,
  },
  normal: {
    label: 'BRAWLER',
    blurb: 'Leads its shots and trades paint. A fair fight.',
    reaction: 0.22, aimError: 0.06, lead: 0.65, fireCone: 0.08, fireRange: 70,
    burstLen: [0.6, 1.2], burstPause: [0.35, 0.9],
    aggression: 0.55, preferredRange: 20, passRange: 8, retreatHealth: 0.25,
    steerGain: 2.1, throttleScale: 0.95,
  },
  hard: {
    label: 'WARLORD',
    blurb: 'Near-instant reactions, deadly leads, loves to ram.',
    reaction: 0.1, aimError: 0.025, lead: 0.95, fireCone: 0.055, fireRange: 85,
    burstLen: [0.9, 1.8], burstPause: [0.15, 0.45],
    aggression: 0.85, preferredRange: 16, passRange: 7, retreatHealth: 0.15,
    steerGain: 2.5, throttleScale: 1.0,
  },
};

// Behavioral archetypes: deltas layered on top of a difficulty tier's numeric profile, so "how hard" (difficulty)
// and "how it fights" (archetype) are independent knobs. aggression/retreatHealth deltas are additive (clamped);
// range deltas are multiplicative fractions of the base value.
export const AI_ARCHETYPES = {
  balanced: { label: 'BALANCED', mod: {} },
  aggressive: {
    label: 'AGGRESSIVE',
    mod: { aggression: 0.18, retreatHealth: -0.08, preferredRangeMul: -0.3, passRangeMul: -0.25 },
  },
  defensive: {
    label: 'DEFENSIVE',
    mod: { aggression: -0.18, retreatHealth: 0.1, preferredRangeMul: 0.35, passRangeMul: 0.2 },
  },
};

/** Merge a difficulty tier's numeric profile with an archetype's behavioral deltas. */
export function buildAIProfile(difficultyKey, archetypeKey) {
  const base = AI_PROFILES[difficultyKey];
  const arch = AI_ARCHETYPES[archetypeKey] ?? AI_ARCHETYPES.balanced;
  const m = arch.mod;
  return {
    ...base,
    aggression: clamp(base.aggression + (m.aggression ?? 0), 0.05, 0.98),
    retreatHealth: clamp(base.retreatHealth + (m.retreatHealth ?? 0), 0.05, 0.6),
    preferredRange: base.preferredRange * (1 + (m.preferredRangeMul ?? 0)),
    passRange: base.passRange * (1 + (m.passRangeMul ?? 0)),
  };
}

const WEAPON_KINDS = new Set(['missile', 'mine', 'scatter', 'laser']);
const N_DIRS = 16;
const UP = new THREE.Vector3(0, 1, 0);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const rand = (a, b) => a + Math.random() * (b - a);

const _pos = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _to = new THREE.Vector3();
const _aim = new THREE.Vector3();
const _des = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _org = new THREE.Vector3();
const _mz = new THREE.Vector3();
const _md = new THREE.Vector3();
const _tnow = new THREE.Vector3();
const _side = new THREE.Vector3();
const _org2 = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _pk = new THREE.Vector3();
const _hzTo = new THREE.Vector3();

// Routing ring around the central plinth (r=12 + ramps to r=24, plinth ring r=31). Waypoints are placed on a
// circle clamped between the plinth and the container stacks (r=62) so orbiting never snags either.
const ROUTE_MIN_R = 34;
const ROUTE_MAX_R = 52;
const ROUTE_STEP = 0.65; // rad of orbit per waypoint

/** Signed yaw angle (rad) from flat vector a to flat vector b; + = b is to the right of a. */
function signedAngle(a, b) {
  const crossY = a.z * b.x - a.x * b.z;
  return Math.atan2(-crossY, a.x * b.x + a.z * b.z);
}

export class AIController {
  constructor(vehicle, physics, profile, { getPickups, getHazards, getNav } = {}) {
    this.getNav = getNav || null;
    this.navWp = null;
    this.navTimer = 0;
    this._dt = 0;
    this.v = vehicle;
    this.physics = physics;
    this.profile = { ...profile };
    this.getPickups = getPickups || null;
    this.getHazards = getHazards || null;
    this.controls = { throttle: 0, brake: 0, steer: 0, handbrake: false, lookBack: false, fire: false, fire2: false, boost: false };
    this.secondaryType = null; // set by Game each step from the bot's current secondary weapon (or null)
    this.dirs = Array.from({ length: N_DIRS }, () => ({ dir: new THREE.Vector3(), danger: 0, interest: 0 }));
    this.chosen = new THREE.Vector3(0, 0, -1);
    this.desired = new THREE.Vector3(0, 0, -1);
    this.paused = false;
    this.reset();
  }

  setProfile(profile) {
    Object.assign(this.profile, profile);
  }

  reset() {
    this.time = 0;
    this.mode = 'engage';
    this.modeTimer = 0;
    this.perceiveTimer = 0;
    this.seenPos = new THREE.Vector3();
    this.seenVel = new THREE.Vector3();
    this.seenTime = -10;
    this.hasLOS = false;
    this.steerTimer = 0;
    this.stuckTime = 0;
    this.unstickSteer = 1;
    this.bursting = false;
    this.burstTimer = 0;
    this.burstCooldown = rand(0.3, 0.8);
    this.retreatCooldown = 0;
    this.passSide = 1;
    this.closeDecided = false;
    this.phase = [rand(0, 10), rand(0, 10)];
    this.lastSteerSign = 1;
    this.chosenDanger = 0;
    this.pathBlocked = false;
    this.secTimer = rand(1, 2.5);
  }

  // ---------------------------------------------------------------------------
  _perceive(target) {
    if (!target || target.health.dead) {
      this.hasLOS = false;
      return;
    }
    this.seenPos.copy(target.currPos);
    this.seenVel.copy(target.velocity);
    this.seenTime = this.time;

    // Line of sight from our muzzle to the target's center.
    this.v.getMuzzleWorld(_mz, _md);
    _dir.copy(target.currPos);
    _dir.y += 0.3;
    _dir.sub(_mz);
    const d = _dir.length();
    if (d < 0.5) {
      this.hasLOS = true;
      return;
    }
    _dir.divideScalar(d);
    const hit = this.physics.castRay(_mz, _dir, d, this.v.body);
    this.hasLOS = !hit || this.physics.getEntity(hit.collider) === target;

    // Is the *driving* line to the target blocked by static geometry (at hull height)? If so, route around.
    _a.copy(this.v.currPos);
    _a.y -= 0.2;
    _b.copy(target.currPos);
    _b.y -= 0.2;
    _dir.subVectors(_b, _a);
    const dd = _dir.length();
    if (dd > 2) {
      _dir.divideScalar(dd);
      const blockedAt = this.physics.castRayStatic(_a, _dir, dd);
      this.pathBlocked = blockedAt !== null && blockedAt < dd - 2;
    } else {
      this.pathBlocked = false;
    }
  }

  /**
   * Next waypoint on a route around static obstacles toward `targetPos`. Uses the map's navigation graph when available
   * (re-planned a few times a second); otherwise falls back to an orbit step around the arena center.
   */
  _routeWaypoint(out, targetPos) {
    const arena = this.getNav?.();
    if (arena?.nav?.nodes.length) {
      this.navTimer -= this._dt;
      if (this.navTimer <= 0) {
        this.navTimer = 0.3;
        this.navWp = arena.navNext(_pos, targetPos);
      }
      if (this.navWp) {
        // Passed it already? Drop it and re-plan next tick instead of doubling back.
        if (Math.hypot(this.navWp.x - _pos.x, this.navWp.z - _pos.z) < 5) this.navTimer = 0;
        return out.copy(this.navWp);
      }
      return out.copy(targetPos);
    }
    const myAng = Math.atan2(_pos.x, _pos.z);
    const tAng = Math.atan2(targetPos.x, targetPos.z);
    let delta = tAng - myAng;
    delta = Math.atan2(Math.sin(delta), Math.cos(delta)); // shortest way round
    const step = Math.sign(delta || 1) * Math.min(Math.abs(delta), ROUTE_STEP);
    const r = clamp(Math.hypot(_pos.x, _pos.z), ROUTE_MIN_R, ROUTE_MAX_R);
    const a = myAng + step;
    return out.set(Math.sin(a) * r, 0, Math.cos(a) * r);
  }

  /** Casts a horizontal feeler; returns free distance (<= look). Hits on `target` don't count (ramming is fine). */
  _feeler(origin, dir, look, target) {
    const hit = this.physics.castRay(origin, dir, look, this.v.body);
    if (!hit) return look;
    if (target && this.physics.getEntity(hit.collider) === target) return look;
    return hit.distance;
  }

  _contextSteer(desired, target) {
    const v = this.v;
    // Feelers ~0.5 m above the ground (just over the chassis floor): low enough to see ramp/kicker side edges
    // and barriers that a ride-height ray would pass over and the car would then snag on.
    _org.copy(v.currPos);
    _org.y -= 0.2;
    const look = clamp(7 + v.speed * 0.8, 7, 32);

    // Fast path: the exact desired direction is clear for the car's full width -> use it verbatim (precise aim).
    // Three parallel rays (center + both flanks) so a thin ray can't slip past something the hull would clip.
    _side.set(-desired.z, 0, desired.x).multiplyScalar(1.1);
    let free = this._feeler(_org, desired, look, target);
    if (free >= look * 0.999) free = Math.min(free, this._feeler(_org2.copy(_org).add(_side), desired, look, target));
    if (free >= look * 0.999) free = Math.min(free, this._feeler(_org2.copy(_org).sub(_side), desired, look, target));
    if (free >= look * 0.999) {
      this.chosen.copy(desired);
      this.chosenDanger = 0;
      for (const d of this.dirs) d.danger = 0;
      return;
    }

    for (let i = 0; i < N_DIRS; i++) {
      const slot = this.dirs[i];
      slot.dir.copy(_fwd).applyAxisAngle(UP, (i / N_DIRS) * Math.PI * 2);
      const dist = this._feeler(_org, slot.dir, look, target);
      slot.danger = dist >= look ? 0 : clamp(1 - (dist - 1.5) / (look - 1.5), 0, 1);
      slot.interest = Math.max(0, slot.dir.dot(desired)) + 0.15 * Math.max(0, slot.dir.dot(_fwd));
    }
    if (this.getHazards) {
      for (const hz of this.getHazards()) {
        _hzTo.copy(hz.position).sub(_org);
        _hzTo.y = 0;
        const d = _hzTo.length();
        if (d < 1e-4 || d > hz.radius + look) continue;
        _hzTo.divideScalar(d);
        for (const slot of this.dirs) {
          const align = slot.dir.dot(_hzTo);
          if (align <= 0.3) continue; // only directions pointing roughly at the hazard
          const proximity = clamp(1 - (d - hz.radius) / look, 0, 1);
          slot.danger = Math.max(slot.danger, align * proximity * (hz.avoid ?? 1));
        }
      }
    }
    // Smear danger into neighbours so the car keeps a margin around obstacle edges.
    const smeared = this.dirs.map((d, i) => {
      const l = this.dirs[(i + N_DIRS - 1) % N_DIRS].danger;
      const r = this.dirs[(i + 1) % N_DIRS].danger;
      return Math.max(d.danger, l * 0.6, r * 0.6);
    });
    let best = 0;
    let bestScore = -Infinity;
    const scores = this.dirs.map((d, i) => {
      const s = d.interest * (1 - smeared[i]) * (1 - smeared[i]);
      if (s > bestScore) { bestScore = s; best = i; }
      return s;
    });
    // Parabolic refinement between neighbours.
    const sl = scores[(best + N_DIRS - 1) % N_DIRS];
    const sr = scores[(best + 1) % N_DIRS];
    const denom = sl - 2 * bestScore + sr;
    const offset = Math.abs(denom) > 1e-5 ? clamp((0.5 * (sl - sr)) / denom, -0.5, 0.5) : 0;
    this.chosen.copy(_fwd).applyAxisAngle(UP, ((best + offset) / N_DIRS) * Math.PI * 2);
    this.chosenDanger = smeared[best];
    this.bestScore = bestScore;
  }

  // ---------------------------------------------------------------------------
  /** Called once per fixed step. Returns the controls object (reused). */
  update(dt, target) {
    const c = this.controls;
    const v = this.v;
    const p = this.profile;
    this.time += dt;
    this._dt = dt;

    if (this.paused || v.health.dead) {
      c.throttle = 0; c.brake = 0; c.steer = 0; c.handbrake = true; c.fire = false; c.fire2 = false;
      return c;
    }

    _pos.copy(v.currPos);
    _fwd.set(0, 0, -1).applyQuaternion(v.currQuat);
    _fwd.y = 0;
    if (_fwd.lengthSq() < 1e-4) _fwd.set(0, 0, -1);
    _fwd.normalize();

    // --- Perception ---
    this.perceiveTimer -= dt;
    if (this.perceiveTimer <= 0) {
      this.perceiveTimer = p.reaction * rand(0.7, 1.3);
      this._perceive(target);
    }
    const targetAlive = target && !target.health.dead && this.seenTime > -5;
    // Dead-reckon the last sighting forward to "now".
    const age = clamp(this.time - this.seenTime, 0, 0.6);
    _tnow.copy(this.seenPos).addScaledVector(this.seenVel, age);
    _to.copy(_tnow).sub(_pos);
    _to.y = 0;
    const dist = _to.length();

    // --- Behaviour state machine ---
    this.retreatCooldown = Math.max(0, this.retreatCooldown - dt);
    if (this.modeTimer > 0) this.modeTimer -= dt;
    const hp = v.health.pct;
    if (this.mode === 'engage' && targetAlive) {
      if (hp < p.retreatHealth && this.retreatCooldown <= 0 && dist < 40) {
        this.mode = 'retreat';
        this.modeTimer = rand(2.5, 4);
      } else if (dist < p.passRange) {
        if (!this.closeDecided) {
          this.closeDecided = true;
          if (Math.random() > p.aggression) {
            this.mode = 'pass';
            this.modeTimer = rand(1.0, 1.6);
            this.passSide = signedAngle(_fwd, _to) > 0 ? -1 : 1; // pass on the side we're already offset to
          }
        }
      } else if (dist > p.passRange * 2) {
        this.closeDecided = false;
      }
    } else if (this.mode !== 'engage' && this.modeTimer <= 0) {
      if (this.mode === 'retreat') this.retreatCooldown = rand(6, 10);
      this.mode = 'engage';
      this.closeDecided = dist < p.passRange * 2;
    }

    // --- Desired direction ---
    const projSpeed = v.cfg.weaponProjectileSpeed;
    if (!targetAlive) {
      // Target is down: cruise a lazy circle around the arena center.
      const ang = this.time * 0.15 + this.phase[0];
      _aim.set(Math.sin(ang) * 40, 0, Math.cos(ang) * 40).sub(_pos);
    } else if (this.mode === 'engage' && this.pathBlocked && !this.hasLOS) {
      // Target is behind the plinth / a stack: orbit toward it instead of pressing into the obstacle.
      this._routeWaypoint(_aim, _tnow).sub(_pos);
    } else if (this.mode === 'engage') {
      const tFlight = dist / projSpeed;
      _aim.copy(_tnow).addScaledVector(this.seenVel, tFlight * p.lead).sub(_pos);
      // Unarmed and not in a close fight: swing by a nearby weapon crate on the way.
      if (!this.secondaryType && this.getPickups && dist > 22) {
        let crate = null, crateD = 42;
        for (const pk of this.getPickups()) {
          if (!pk.available || !WEAPON_KINDS.has(pk.kind)) continue;
          const d = pk.group.position.distanceTo(_pos);
          if (d < crateD) { crateD = d; crate = pk; }
        }
        if (crate) {
          _pk.copy(crate.group.position).sub(_pos);
          _pk.y = 0;
          if (_pk.lengthSq() > 1e-4) {
            _aim.y = 0;
            _aim.normalize().lerp(_pk.normalize(), 0.65);
          }
        }
      }
    } else if (this.mode === 'pass') {
      _aim.copy(_to).applyAxisAngle(UP, this.passSide * 0.95);
    } else if (this.mode === 'retreat') {
      _aim.copy(_to).negate().applyAxisAngle(UP, Math.sin(this.time * 0.9 + this.phase[1]) * 0.7);
      if (this.getPickups) {
        let best = null, bestD = 40;
        for (const pk of this.getPickups()) {
          if (pk.kind !== 'health' || !pk.available) continue;
          const d = pk.group.position.distanceTo(_pos);
          if (d < bestD) { bestD = d; best = pk; }
        }
        if (best) {
          _pk.copy(best.group.position).sub(_pos);
          _pk.y = 0;
          if (_pk.lengthSq() > 1e-4) _aim.lerp(_pk.normalize(), 0.6);
        }
      }
    } else {
      _aim.copy(_fwd);
    }
    _aim.y = 0;
    if (_aim.lengthSq() < 1e-4) _aim.copy(_fwd);
    _aim.normalize();
    // Human-ish aim wobble (only while engaging).
    const wobble = this.mode === 'engage' && targetAlive
      ? p.aimError * (Math.sin(this.time * 1.7 + this.phase[0]) * 0.6 + Math.sin(this.time * 3.9 + this.phase[1]) * 0.4)
      : 0;
    _des.copy(_aim).applyAxisAngle(UP, wobble);
    this.desired.copy(_des);

    // --- Context steering (20 Hz) ---
    this.steerTimer -= dt;
    if (this.steerTimer <= 0) {
      this.steerTimer = 0.05;
      this._contextSteer(_des, target);
    }

    // --- Control mapping ---
    let err = signedAngle(_fwd, this.chosen);
    // Hysteresis when the goal is almost directly behind (avoids left/right dithering).
    if (Math.abs(err) > 2.6 && Math.sign(err) !== this.lastSteerSign) err = this.lastSteerSign * Math.abs(err);
    this.lastSteerSign = Math.sign(err) || 1;
    const absErr = Math.abs(err);

    c.steer = clamp(err * p.steerGain, -1, 1);
    c.handbrake = false;
    c.brake = 0;
    let throttle = p.throttleScale * (1 - 0.45 * clamp((absErr - 0.3) / 1.0, 0, 1));
    if (absErr > 1.2 && v.speed > 14) {
      throttle = 0.35;
      c.handbrake = absErr > 1.5;
    }
    // Obstacle right in the chosen path at speed: scrub speed.
    if (this.chosenDanger > 0.6 && v.speed > 10) {
      throttle = 0;
      c.brake = 0.6;
    }
    // Approach discipline: inside engagement range, bleed speed down to an aggression-scaled closing speed —
    // more time on target for the gun, and rams hurt instead of being suicidal top-speed crashes.
    if (this.mode === 'engage' && targetAlive && dist < p.preferredRange * 1.8 && absErr < 0.6) {
      const vClose = 9 + p.aggression * 16; // m/s: ~33 km/h (rookie) .. ~80 km/h (warlord)
      if (v.speed > vClose + 3) {
        throttle = 0;
        c.brake = 0.5;
      } else if (v.speed > vClose) {
        throttle *= 0.3;
      }
    }
    // Hold a shooting distance instead of blindly colliding (non-rammers only).
    if (this.mode === 'engage' && targetAlive && p.aggression < 0.7 && dist < p.preferredRange * 0.6 && absErr < 0.35) {
      throttle = Math.min(throttle, 0.4);
    }
    if (!targetAlive) throttle *= 0.6;

    // --- Stuck detection -> reverse out ---
    if (this.mode === 'unstick') {
      c.throttle = 0;
      c.brake = 1; // brake held at standstill = reverse
      c.steer = -this.unstickSteer;
      c.handbrake = false;
    } else {
      c.throttle = throttle;
      if (throttle > 0.5 && v.speed < 1.2 && v.groundedCount >= 2) this.stuckTime += dt;
      else this.stuckTime = Math.max(0, this.stuckTime - dt * 2);
      if (this.stuckTime > 1.0) {
        this.stuckTime = 0;
        this.mode = 'unstick';
        this.modeTimer = rand(0.9, 1.3);
        this.unstickSteer = Math.sign(c.steer) || 1;
      }
    }

    // Flipped: recover sooner than the player's auto-recover.
    if (v.flippedTime > 1.4) v.recover();

    // --- Fire control ---
    this.burstCooldown = Math.max(0, this.burstCooldown - dt);
    let want = false;
    if (targetAlive && this.hasLOS && this.mode !== 'retreat' && dist < p.fireRange) {
      const tFlight = dist / projSpeed;
      _aim.copy(_tnow).addScaledVector(this.seenVel, tFlight * p.lead).sub(_pos);
      _aim.y = 0;
      const aimErr = Math.abs(signedAngle(_fwd, _aim.normalize()));
      const cone = Math.max(p.fireCone, Math.atan2(1.3, Math.max(dist, 0.1)));
      want = aimErr < cone;
    }
    if (want && !this.bursting && this.burstCooldown <= 0) {
      this.bursting = true;
      this.burstTimer = rand(p.burstLen[0], p.burstLen[1]);
    }
    if (this.bursting) {
      this.burstTimer -= dt;
      if (this.burstTimer <= 0) {
        this.bursting = false;
        this.burstCooldown = rand(p.burstPause[0], p.burstPause[1]);
      }
    }
    c.fire = want && this.bursting;

    // --- Secondary weapon (missile / mine / flak / laser): each type has its own "good moment" ---
    this.secTimer = Math.max(0, this.secTimer - dt);
    c.fire2 = false;
    if (this.secondaryType && targetAlive && this.secTimer <= 0 && this.mode !== 'unstick') {
      const bearing = Math.abs(signedAngle(_fwd, _to.lengthSq() > 1e-4 ? _to : _fwd));
      const behind = dist > 0.1 && _fwd.dot(_to) / dist < -0.25;
      let go = false;
      switch (this.secondaryType) {
        case 'missile': go = this.hasLOS && dist > 14 && dist < 80 && bearing < 0.5; break;
        case 'laser': go = this.hasLOS && dist > 8 && dist < 95 && bearing < Math.max(0.05, p.fireCone * 0.9); break;
        case 'scatter': go = this.hasLOS && dist < 26 && bearing < 0.2; break;
        case 'mine': go = (behind && dist < 32) || (this.mode === 'retreat' && dist < 40); break;
        default: break;
      }
      if (go) {
        c.fire2 = true;
        this.secTimer = rand(1.4, 3.4) * (1.3 - p.aggression * 0.5);
      }
    }
    return c;
  }
}

/** Optional debug overlay: context-steering feelers (green = clear, red = danger) + chosen/desired headings. */
export class AIDebugView {
  constructor(scene) {
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array((N_DIRS + 2) * 2 * 3);
    this.col = new Float32Array((N_DIRS + 2) * 2 * 3);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.lines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true, toneMapped: false, depthTest: false }));
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 20;
    this.lines.visible = false;
    scene.add(this.lines);
  }

  update(ai) {
    if (!this.lines.visible) return;
    const o = ai.v.currPos;
    let k = 0;
    const seg = (dir, len, r, g, b) => {
      const i = k * 6;
      this.pos[i] = o.x; this.pos[i + 1] = o.y + 0.4; this.pos[i + 2] = o.z;
      this.pos[i + 3] = o.x + dir.x * len; this.pos[i + 4] = o.y + 0.4; this.pos[i + 5] = o.z + dir.z * len;
      this.col[i] = r; this.col[i + 1] = g; this.col[i + 2] = b;
      this.col[i + 3] = r; this.col[i + 4] = g; this.col[i + 5] = b;
      k++;
    };
    for (const d of ai.dirs) seg(d.dir, 3 + d.interest * 4, d.danger * 3, (1 - d.danger) * 2, 0.2);
    seg(ai.desired, 10, 0.3, 0.8, 3);
    seg(ai.chosen, 12, 3, 3, 3);
    this.lines.geometry.attributes.position.needsUpdate = true;
    this.lines.geometry.attributes.color.needsUpdate = true;
  }
}
