import * as THREE from 'three';
import { Health } from '../combat/Health.js';

// Raycast vehicle on a single Rapier rigid body.
//
// Each fixed step, per wheel:
//   1. Cast a ray down the chassis' -up axis from the wheel mount point.
//   2. Suspension: spring (k * compression) + damper (c * compression velocity), applied along chassis up.
//      The resulting force is also the tire's normal load.
//   3. Tire: resolve the contact-point velocity into the wheel's forward / sideways axes (projected onto the
//      ground plane). Longitudinal = drive + brake + rolling resistance; lateral = impulse that removes part of
//      the sideways slide. Both are clamped together by a friction circle (mu * load) — exceeding it is what
//      produces wheelspin, drifts and understeer.
//   4. Impulses are applied at a point lifted toward the CoM by (1 - rollInfluence) to control body roll.
// Global: anti-roll bars, downforce, aero drag, air control, self-leveling, flip recovery.

const WORLD_UP = new THREE.Vector3(0, 1, 0);

const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _up = new THREE.Vector3();
const _down = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _vel = new THREE.Vector3();
const _com = new THREE.Vector3();
const _mount = new THREE.Vector3();
const _n = new THREE.Vector3();
const _wFwd = new THREE.Vector3();
const _wRight = new THREE.Vector3();
const _vPoint = new THREE.Vector3();
const _applyP = new THREE.Vector3();
const _imp = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const _v3 = { x: 0, y: 0, z: 0 };
const _p3 = { x: 0, y: 0, z: 0 };

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const moveTowards = (cur, target, maxDelta) =>
  Math.abs(target - cur) <= maxDelta ? target : cur + Math.sign(target - cur) * maxDelta;

export class Vehicle {
  constructor(physics, config, spawn) {
    this.physics = physics;
    this.R = physics.R;
    this.cfg = structuredClone(config);
    this.spawn = { position: spawn.position.clone(), yaw: spawn.yaw };

    this.wheels = this.cfg.wheels.map((w, i) => ({
      index: i,
      mount: new THREE.Vector3(...w.pos),
      front: w.front,
      left: w.pos[0] < 0,
      grounded: false,
      compression: 0,
      suspLen: this.cfg.suspTravel,
      load: 0,
      contact: new THREE.Vector3(),
      normal: new THREE.Vector3(0, 1, 0),
      spin: 0,
      spinVel: 0,
      slipLat: 0,
      skid: 0,        // 0..1 intensity used for smoke / skid marks / audio
      wheelspin: false,
      locked: false,
    }));

    this.steer = 0;        // current front-wheel angle (rad), + = right
    this.drive = 0;        // -1..1 engine request after throttle/brake arbitration
    this.brake = 0;        // 0..1
    this.handbrake = false;
    this.groundedCount = 0;
    this.airTime = 0;
    this.flippedTime = 0;
    this.rpm = this.cfg.idleRpm;
    this.gear = 1;
    this.skidAmount = 0;
    this.justLanded = 0;   // landing impact strength (m/s), consumed by FX/camera
    this.recoverCooldown = 0;
    this.recovered = false; // set true for one frame when a recover happens (FX hook)

    // Combat: caller (Game.js) wires .onDamage/.onDeath after construction.
    this.isVehicle = true;
    this.health = new Health(this.cfg.maxHealth);

    // Boost / hazards / pickups
    this.boostMeter = this.cfg.boostMax;
    this.boosting = false;
    this.hazardTraction = 1;  // set externally by Game.js on hazard-zone enter/exit, not reset per frame here
    this.overcharge = 0;      // seconds remaining of the overcharge pickup buff

    // Interpolation state (render between previous and current physics states)
    this.prevPos = new THREE.Vector3();
    this.currPos = new THREE.Vector3();
    this.prevQuat = new THREE.Quaternion();
    this.currQuat = new THREE.Quaternion();
    this.velocity = new THREE.Vector3();
    this.fwdSpeed = 0;
    this.speed = 0;

    this._createBody();
  }

  // ---------------------------------------------------------------------------
  _createBody() {
    const R = this.R;
    const c = this.cfg;
    const world = this.physics.world;
    const q = new THREE.Quaternion().setFromAxisAngle(WORLD_UP, this.spawn.yaw);
    const p = this.spawn.position;

    const bodyDesc = R.RigidBodyDesc.dynamic()
      .setTranslation(p.x, p.y, p.z)
      .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
      .setCanSleep(false)
      .setCcdEnabled(true)
      .setLinearDamping(c.linearDamping)
      .setAngularDamping(c.angularDamping);
    this.body = world.createRigidBody(bodyDesc);

    const [hx, hy, hz] = c.chassisHalfExtents;
    const br = 0.12;
    const chassisDesc = R.ColliderDesc.roundCuboid(hx - br, hy - br, hz - br, br)
      .setFriction(c.bodyFriction)
      .setRestitution(c.bodyRestitution)
      .setActiveEvents(R.ActiveEvents.CONTACT_FORCE_EVENTS)
      .setContactForceEventThreshold(c.impactThreshold);
    this.collider = world.createCollider(chassisDesc, this.body);

    const [cx, cy, cz] = c.cabinHalfExtents;
    const cabinDesc = R.ColliderDesc.roundCuboid(cx - 0.1, cy - 0.1, cz - 0.1, 0.1)
      .setTranslation(...c.cabinOffset)
      .setDensity(0)
      .setFriction(c.bodyFriction)
      .setRestitution(c.bodyRestitution)
      .setActiveEvents(R.ActiveEvents.CONTACT_FORCE_EVENTS)
      .setContactForceEventThreshold(c.impactThreshold);
    this.cabinCollider = world.createCollider(cabinDesc, this.body);

    // So projectile hits / collision damage can resolve "what did I hit" back to this vehicle.
    this.physics.registerCollider(this.collider, this);
    this.physics.registerCollider(this.cabinCollider, this);

    this.applyMassProperties();
    this._readState();
    this.prevPos.copy(this.currPos);
    this.prevQuat.copy(this.currQuat);
  }

  /** (Re)apply mass, CoM and inertia from config. Called on creation and from the tuning panel. */
  applyMassProperties() {
    const c = this.cfg;
    const m = c.mass;
    // Inertia of a representative solid box (full car envelope, not just the collider).
    const w = 2.0, h = 1.0, l = 4.2;
    const ix = (m / 12) * (h * h + l * l) * c.inertiaScale[0];
    const iy = (m / 12) * (w * w + l * l) * c.inertiaScale[1];
    const iz = (m / 12) * (w * w + h * h) * c.inertiaScale[2];
    this.inertia = { x: ix, y: iy, z: iz };
    this.collider.setMassProperties(
      m,
      { x: c.comOffset[0], y: c.comOffset[1], z: c.comOffset[2] },
      this.inertia,
      { x: 0, y: 0, z: 0, w: 1 },
    );
    this.body.setLinearDamping(c.linearDamping);
    this.body.setAngularDamping(c.angularDamping);
  }

  _readState() {
    const t = this.body.translation();
    const r = this.body.rotation();
    const v = this.body.linvel();
    this.currPos.set(t.x, t.y, t.z);
    this.currQuat.set(r.x, r.y, r.z, r.w);
    this.velocity.set(v.x, v.y, v.z);
  }

  /** Blend previous/current physics state for smooth rendering at any frame rate. */
  getInterpolated(alpha, outPos, outQuat) {
    outPos.lerpVectors(this.prevPos, this.currPos, alpha);
    outQuat.slerpQuaternions(this.prevQuat, this.currQuat, alpha);
  }

  // ---------------------------------------------------------------------------
  /** Called once per fixed step BEFORE world.step(). */
  fixedUpdate(dt, controls) {
    this.prevPos.copy(this.currPos);
    this.prevQuat.copy(this.currQuat);

    const c = this.cfg;
    const body = this.body;

    _pos.copy(this.currPos);
    _quat.copy(this.currQuat);
    _up.set(0, 1, 0).applyQuaternion(_quat);
    _down.copy(_up).negate();
    _fwd.set(0, 0, -1).applyQuaternion(_quat);
    _right.set(1, 0, 0).applyQuaternion(_quat);
    _vel.copy(this.velocity);
    _com.set(c.comOffset[0], c.comOffset[1], c.comOffset[2]).applyQuaternion(_quat).add(_pos);

    const fwdSpeed = _vel.dot(_fwd);
    const speed = _vel.length();
    const mCorner = c.mass / 4;

    // --- Steering (speed sensitive, rate limited) -------------------------
    const speedT = clamp(Math.abs(fwdSpeed) / c.steerSpeedRef, 0, 1);
    const maxSteer = lerp(c.maxSteer, c.minSteer, speedT * speedT * (3 - 2 * speedT));
    const steerTarget = clamp(controls.steer, -1, 1) * maxSteer;
    const returning = Math.abs(steerTarget) < Math.abs(this.steer) || Math.sign(steerTarget) !== Math.sign(this.steer);
    this.steer = moveTowards(this.steer, steerTarget, (returning ? c.steerReturnRate : c.steerRate) * dt);

    // --- Throttle / brake / reverse arbitration ---------------------------
    const thr = controls.throttle;
    const brk = controls.brake;
    this.drive = 0;
    this.brake = 0;
    if (thr > 0 && brk === 0) {
      if (fwdSpeed < -1.0) this.brake = thr; else this.drive = thr;
    } else if (brk > 0 && thr === 0) {
      if (fwdSpeed > 1.0) this.brake = brk; else this.drive = -brk;
    } else if (thr > 0 && brk > 0) {
      this.brake = brk;
    }
    this.handbrake = !!controls.handbrake;

    this.boosting = !!controls.boost && this.boostMeter > c.boostMinToStart && this.drive > 0;

    let engineF = 0;
    if (this.drive > 0) {
      const topSpeed = this.boosting ? c.topSpeed * c.boostTopSpeedMult : c.topSpeed;
      const t = clamp(Math.max(0, fwdSpeed) / topSpeed, 0, 1);
      engineF = this.drive * c.engineForce * Math.max(0, 1 - Math.pow(t, c.engineCurveExponent));
      if (this.boosting) engineF *= c.boostForceMult;
    } else if (this.drive < 0) {
      const t = clamp(Math.max(0, -fwdSpeed) / c.reverseTopSpeed, 0, 1);
      engineF = this.drive * c.reverseForce * Math.max(0, 1 - t * t);
    }

    if (this.boosting) this.boostMeter = Math.max(0, this.boostMeter - c.boostDrainRate * dt);
    else this.boostMeter = Math.min(c.boostMax, this.boostMeter + c.boostRegenRate * dt);
    if (this.overcharge > 0) this.overcharge = Math.max(0, this.overcharge - dt);

    // --- Wheels -------------------------------------------------------------
    const rayLen = c.suspTravel + c.wheelRadius;
    let grounded = 0;
    let skidSum = 0;
    let maxLandingSpeed = 0;
    const wasAirborne = this.groundedCount === 0;

    for (const w of this.wheels) {
      _mount.copy(w.mount).applyQuaternion(_quat).add(_pos);
      const hit = this.physics.castRay(_mount, _down, rayLen, body);

      if (!hit) {
        w.grounded = false;
        w.compression = 0;
        w.load = 0;
        w.skid = 0;
        w.slipLat = 0;
        w.wheelspin = false;
        w.suspLen += (c.suspTravel - w.suspLen) * Math.min(1, 18 * dt);
        // Free-spinning wheels: spin up under throttle, otherwise slowly coast.
        if (this.drive !== 0) w.spinVel = moveTowards(w.spinVel, this.drive * 60, 120 * dt);
        else w.spinVel *= Math.exp(-0.8 * dt);
        if (this.handbrake && !w.front) w.spinVel = 0;
        w.spin += w.spinVel * dt;
        continue;
      }

      grounded++;
      w.grounded = true;
      w.contact.set(hit.point.x, hit.point.y, hit.point.z);
      _n.set(hit.normal.x, hit.normal.y, hit.normal.z);
      w.normal.copy(_n);

      w.suspLen = clamp(hit.distance - c.wheelRadius, 0, c.suspTravel);
      w.compression = c.suspTravel - w.suspLen;

      const pv = body.velocityAtPoint(_p3set(w.contact));
      _vPoint.set(pv.x, pv.y, pv.z);

      // --- Suspension ---
      const compVel = -_vPoint.dot(_up); // + when compressing
      if (wasAirborne) maxLandingSpeed = Math.max(maxLandingSpeed, compVel);
      const damper = compVel > 0 ? c.damperCompression : c.damperRebound;
      let fSusp = c.springStiffness * w.compression + damper * compVel;
      const bumpStart = c.suspTravel * c.bumpStopStart;
      if (w.compression > bumpStart) {
        fSusp += (w.compression - bumpStart) * c.springStiffness * c.bumpStopStiffness;
      }
      fSusp = clamp(fSusp, 0, c.maxSuspensionForce);
      w.load = fSusp;
      _imp.copy(_up).multiplyScalar(fSusp * dt);
      body.applyImpulseAtPoint(_v3set(_imp), _p3set(_mount), true);

      // --- Tire frame ---
      _wFwd.copy(_fwd);
      if (w.front) _wFwd.applyAxisAngle(_up, -this.steer);
      _wFwd.addScaledVector(_n, -_wFwd.dot(_n)).normalize();
      _wRight.crossVectors(_wFwd, _n).normalize();
      const vLong = _vPoint.dot(_wFwd);
      const vLat = _vPoint.dot(_wRight);

      // --- Longitudinal ---
      const driveShare = w.front ? c.frontDriveShare * 0.5 : (1 - c.frontDriveShare) * 0.5;
      let fLong = engineF * driveShare;
      const brakeShare = w.front ? c.brakeBias * 0.5 : (1 - c.brakeBias) * 0.5;
      let fBrake = this.brake * c.brakeForce * brakeShare + Math.abs(vLong) * c.rollingResistance;
      w.locked = false;
      if (!w.front && this.handbrake) {
        fBrake += c.handbrakeForce * 0.5;
        w.locked = true;
      }
      // Hold the car still when idle (prevents creeping on slopes).
      if (this.drive === 0 && speed < 0.8) fBrake += c.brakeForce * 0.1;
      const stopF = (Math.abs(vLong) * mCorner) / dt;
      fLong -= Math.sign(vLong) * Math.min(fBrake, stopF);

      // --- Lateral ---
      let gripRate = w.front ? c.frontGripRate : c.rearGripRate;
      let mu = w.front ? c.frontMu : c.rearMu;
      if (!w.front && this.handbrake) {
        gripRate = c.handbrakeGripRate;
        mu *= c.handbrakeMuScale;
      }
      const slideT = smoothstep(c.slideStart, c.slideFull, Math.abs(vLat));
      mu *= lerp(1, c.slideMuScale, slideT);
      mu *= this.hazardTraction;

      let jLat = -vLat * mCorner * (1 - Math.exp(-gripRate * dt));
      let jLong = fLong * dt;

      // --- Friction circle ---
      const maxJ = mu * fSusp * dt;
      const mag = Math.hypot(jLong, jLat);
      w.wheelspin = false;
      if (mag > maxJ && mag > 1e-6) {
        const s = maxJ / mag;
        if (this.drive !== 0 && Math.abs(jLong) > maxJ * 0.85 && Math.abs(vLong) < 14) w.wheelspin = true;
        jLong *= s;
        jLat *= s;
      }

      // Apply tire impulse at a point lifted toward CoM height (roll control).
      const h = _tmp.copy(_com).sub(w.contact).dot(_up);
      _applyP.copy(w.contact).addScaledVector(_up, h * (1 - c.rollInfluence));
      _imp.copy(_wFwd).multiplyScalar(jLong).addScaledVector(_wRight, jLat);
      body.applyImpulseAtPoint(_v3set(_imp), _p3set(_applyP), true);

      // --- Wheel visual spin + FX slip ---
      w.slipLat = Math.abs(vLat);
      if (w.locked) w.spinVel = 0;
      else if (w.wheelspin) w.spinVel = moveTowards(w.spinVel, Math.sign(this.drive) * 55, 200 * dt);
      else w.spinVel = vLong / c.wheelRadius;
      w.spin += w.spinVel * dt;

      let skid = smoothstep(3.0, 8.0, w.slipLat);
      if (w.locked && Math.abs(vLong) > 3) skid = Math.max(skid, smoothstep(3, 12, Math.abs(vLong)));
      if (w.wheelspin) skid = Math.max(skid, 0.85);
      if (this.brake > 0.5 && Math.abs(vLong) > 6 && mag > maxJ) skid = Math.max(skid, 0.6);
      w.skid = skid;
      skidSum += skid;
    }

    this.groundedCount = grounded;
    this.skidAmount = skidSum / 4;
    if (wasAirborne && grounded > 0 && this.airTime > 0.25) this.justLanded = Math.max(this.justLanded, maxLandingSpeed);
    this.airTime = grounded === 0 ? this.airTime + dt : 0;

    // --- Anti-roll bars ---------------------------------------------------
    this._antiRoll(this.wheels[0], this.wheels[1], c.antiRollFront, dt);
    this._antiRoll(this.wheels[2], this.wheels[3], c.antiRollRear, dt);

    // --- Aero ---------------------------------------------------------------
    if (grounded >= 2) {
      _imp.copy(_down).multiplyScalar(c.downforce * speed * speed * dt);
      body.applyImpulse(_v3set(_imp), true);
    }
    if (speed > 0.1) {
      _imp.copy(_vel).multiplyScalar(-c.dragCoefficient * speed * dt);
      body.applyImpulse(_v3set(_imp), true);
    }

    const av = body.angvel();
    const upright = _up.dot(WORLD_UP);

    // --- Drift assist: damp runaway yaw when sliding with no steering input -----
    if (grounded >= 3 && Math.abs(controls.steer) < 0.1 && this.skidAmount > 0.15 && !this.handbrake) {
      const yawRate = av.x * _up.x + av.y * _up.y + av.z * _up.z;
      _imp.copy(_up).multiplyScalar(-yawRate * this.inertia.y * c.driftAssist * 4 * dt);
      body.applyTorqueImpulse(_v3set(_imp), true);
    }

    // --- Air control (not for a wreck: let it tumble) ------------------------
    if (grounded === 0 && !this.health.dead) {
      const pitchIn = controls.throttle - controls.brake; // W = nose down
      const yawIn = controls.steer;
      if (Math.abs(pitchIn) > 0.01) {
        _imp.copy(_right).multiplyScalar(-pitchIn * c.airPitchTorque * dt);
        body.applyTorqueImpulse(_v3set(_imp), true);
      }
      if (Math.abs(yawIn) > 0.01) {
        _imp.copy(_up).multiplyScalar(-yawIn * c.airYawTorque * dt);
        body.applyTorqueImpulse(_v3set(_imp), true);
      }
      if (Math.abs(pitchIn) < 0.01 && Math.abs(yawIn) < 0.01) {
        // Self-level: rotate chassis up toward world up.
        _tmp.crossVectors(_up, WORLD_UP);
        _imp.copy(_tmp).multiplyScalar(c.airLeveling * dt);
        body.applyTorqueImpulse(_v3set(_imp), true);
      }
      // Extra angular drag in the air so spins stay controllable.
      const k = Math.exp(-c.airAngularDrag * dt);
      body.setAngvel({ x: av.x * k, y: av.y * k, z: av.z * k }, true);
    }

    // --- Flip detection / recovery -----------------------------------------
    this.recoverCooldown = Math.max(0, this.recoverCooldown - dt);
    if (upright < 0.35 && speed < 4) this.flippedTime += dt;
    else this.flippedTime = Math.max(0, this.flippedTime - dt * 2);
    if (this.flippedTime > c.autoRecoverDelay && !this.health.dead) this.recover();

    // --- Engine sim (audio / HUD) ------------------------------------------
    this._updateEngineSim(dt, fwdSpeed, grounded);

    this.fwdSpeed = fwdSpeed;
    this.speed = speed;
  }

  /** Called once per fixed step AFTER world.step(). */
  afterStep() {
    this._readState();
  }

  _antiRoll(wl, wr, k, dt) {
    if (!wl.grounded && !wr.grounded) return;
    const f = (wl.compression - wr.compression) * k;
    if (wl.grounded) {
      _mount.copy(wl.mount).applyQuaternion(_quat).add(_pos);
      _imp.copy(_up).multiplyScalar(f * dt);
      this.body.applyImpulseAtPoint(_v3set(_imp), _p3set(_mount), true);
    }
    if (wr.grounded) {
      _mount.copy(wr.mount).applyQuaternion(_quat).add(_pos);
      _imp.copy(_up).multiplyScalar(-f * dt);
      this.body.applyImpulseAtPoint(_v3set(_imp), _p3set(_mount), true);
    }
  }

  _updateEngineSim(dt, fwdSpeed, grounded) {
    const c = this.cfg;
    const v = Math.abs(fwdSpeed);
    let target;
    if (grounded === 0 || this.wheels.some((w) => w.wheelspin)) {
      // Revving freely.
      target = Math.abs(this.drive) > 0 ? c.maxRpm * 0.92 : c.idleRpm * 1.3;
      this.gear = this.gear || 1;
    } else if (fwdSpeed < -0.5) {
      this.gear = -1;
      target = lerp(c.idleRpm, c.maxRpm * 0.8, clamp(v / c.reverseTopSpeed, 0, 1));
    } else {
      const gs = c.gearSpeeds;
      let g = 1;
      while (g < gs.length - 1 && v > gs[g]) g++;
      this.gear = g;
      const lo = gs[g - 1];
      const hi = gs[g];
      const t = clamp((v - lo) / (hi - lo), 0, 1);
      const floor = g === 1 ? 0 : 0.42;
      target = lerp(c.idleRpm, c.maxRpm, floor + (1 - floor) * t);
      if (this.drive === 0) target = lerp(target, c.idleRpm, 0.35);
    }
    this.rpm += (target - this.rpm) * Math.min(1, 10 * dt);
  }

  /** Put the car back on its wheels at its current location (or spawn if it's out of bounds). */
  recover(toSpawn = false) {
    if (this.recoverCooldown > 0) return;
    this.recoverCooldown = 1.0;
    const pos = toSpawn ? this.spawn.position.clone() : this.currPos.clone();
    let yaw = this.spawn.yaw;
    if (!toSpawn) {
      _fwd.set(0, 0, -1).applyQuaternion(this.currQuat);
      _fwd.y = 0;
      if (_fwd.lengthSq() > 0.01) yaw = Math.atan2(-_fwd.x, -_fwd.z);
      pos.y = Math.max(pos.y, 0) + 1.6;
    }
    this.teleport(pos, yaw);
    this.recovered = true;
  }

  teleport(pos, yaw) {
    const q = new THREE.Quaternion().setFromAxisAngle(WORLD_UP, yaw);
    this.body.setTranslation({ x: pos.x, y: pos.y, z: pos.z }, true);
    this.body.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this._readState();
    this.prevPos.copy(this.currPos);
    this.prevQuat.copy(this.currQuat);
    this.flippedTime = 0;
    this.steer = 0;
    for (const w of this.wheels) {
      w.suspLen = this.cfg.suspTravel;
      w.spinVel = 0;
      w.skid = 0;
    }
  }

  get isFlipped() {
    return this.flippedTime > this.cfg.flipDetectDelay;
  }

  /**
   * World-space muzzle position + forward direction, computed straight from the current physics transform
   * (not the render-interpolated scene graph) so firing stays accurate at the 120 Hz simulation rate
   * regardless of display frame rate. Writes into `outPos`/`outDir`.
   */
  getMuzzleWorld(outPos, outDir) {
    const c = this.cfg;
    outDir.set(0, 0, -1).applyQuaternion(this.currQuat);
    outPos.set(c.weaponMount[0], c.weaponMount[1], c.weaponMount[2])
      .applyQuaternion(this.currQuat)
      .add(this.currPos)
      .addScaledVector(outDir, c.weaponMuzzleForward);
  }

  /**
   * Destroyed: the blast throws the car up and sends it tumbling (roughly away from `away`, a flat unit vector, if
   * given). Velocity-based so it looks the same for every car mass.
   */
  wreckLaunch(away = null, kick = 1) {
    const lv = this.body.linvel();
    const push = away ? 3.5 * kick : 0;
    this.body.setLinvel({
      x: lv.x * 0.55 + (away ? away.x * push : 0),
      y: Math.max(0, lv.y) + (6.5 + Math.random() * 2) * kick,
      z: lv.z * 0.55 + (away ? away.z * push : 0),
    }, true);
    _fwd.set(0, 0, -1).applyQuaternion(this.currQuat);
    _right.set(1, 0, 0).applyQuaternion(this.currQuat);
    const roll = (Math.random() < 0.5 ? -1 : 1) * (2.5 + Math.random() * 2.5) * kick;
    const pitch = (Math.random() - 0.5) * 3 * kick;
    const yaw = (Math.random() - 0.5) * 3;
    this.body.setAngvel({
      x: _fwd.x * roll + _right.x * pitch, y: _fwd.y * roll + _right.y * pitch + yaw, z: _fwd.z * roll + _right.z * pitch,
    }, true);
  }

  /** Kick impulse opposite the fire direction (called by the weapon system on each shot). */
  applyRecoil(fireDir) {
    this.body.applyImpulse({ x: -fireDir.x * this.cfg.weaponRecoil, y: -fireDir.y * this.cfg.weaponRecoil * 0.3, z: -fireDir.z * this.cfg.weaponRecoil }, true);
  }

  /** One-shot forward impulse + meter refill from crossing a boost pad. */
  boostPad(forwardDir, meterGain) {
    this.body.applyImpulse({ x: forwardDir.x * this.cfg.boostPadImpulse, y: 0, z: forwardDir.z * this.cfg.boostPadImpulse }, true);
    this.boostMeter = Math.min(this.cfg.boostMax, this.boostMeter + meterGain);
  }
}

function _v3set(v) {
  _v3.x = v.x; _v3.y = v.y; _v3.z = v.z;
  return _v3;
}
function _p3set(v) {
  _p3.x = v.x; _p3.y = v.y; _p3.z = v.z;
  return _p3;
}
