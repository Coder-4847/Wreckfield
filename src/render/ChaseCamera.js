import * as THREE from 'three';

// Smoothed third-person chase camera.
// - The camera's orbit direction blends the car's heading with its travel direction, so drifts show the car
//   sideways instead of the camera whipping around with the nose.
// - The camera offset is smoothed relative to the car (not in world space) so there's no speed-dependent lag;
//   the car's height is smoothed separately to soak up suspension bounce and landings.
// - Spring-arm collision against static geometry, speed-based FOV/distance, trauma-based shake.

const _heading = new THREE.Vector3();
const _vflat = new THREE.Vector3();
const _desired = new THREE.Vector3();
const _pivot = new THREE.Vector3();
const _toCam = new THREE.Vector3();
const _look = new THREE.Vector3();
const _shake = new THREE.Vector3();

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const damp = (lambda, dt) => 1 - Math.exp(-lambda * dt);

export class ChaseCamera {
  constructor(camera, physics) {
    this.camera = camera;
    this.physics = physics;
    this.settings = {
      distance: 6.6,
      distanceFast: 8.0,
      height: 2.5,
      heightFast: 2.2,
      lookHeight: 1.0,
      lookAhead: 4.0,
      dirSharpness: 5.5,
      velocityBlend: 0.45,
      heightSharpness: 7,
      offsetSharpness: 14,
      fov: 66,
      fovFast: 80,
      speedRef: 38,
      shakeScale: 0.55,
    };
    this.dir = new THREE.Vector3(0, 0, -1);
    this.offset = new THREE.Vector3();
    this.smoothY = 0;
    this.look = new THREE.Vector3();
    this.trauma = 0;
    this.time = 0;
    this.fov = this.settings.fov;
    this.armLength = null;
  }

  addTrauma(amount) {
    this.trauma = clamp(this.trauma + amount, 0, 1);
  }

  /**
   * Wrecked: the camera lifts off the chase arm into a slow crane-orbit around the burning wreck, then drifts its
   * gaze toward whoever killed you (if they're alive) so you see who did it. Uses real dt (keeps moving in slow-mo).
   */
  deathCam(dt, focus, killerPos = null) {
    const cam = this.camera;
    this.time += dt;
    if (!this._death) {
      this._death = {
        t: 0,
        ang: Math.atan2(cam.position.x - focus.x, cam.position.z - focus.z),
        dist: Math.hypot(cam.position.x - focus.x, cam.position.z - focus.z),
        h: cam.position.y - focus.y,
        look: this.look.clone(),
      };
    }
    const d = this._death;
    d.t += dt;
    d.ang += dt * (0.22 + 0.25 * Math.exp(-d.t * 1.5));
    d.dist += (11.5 - d.dist) * damp(1.6, dt);
    d.h += (5.2 - d.h) * damp(1.4, dt);
    _toCam.set(Math.sin(d.ang), 0, Math.cos(d.ang));
    _pivot.set(focus.x, focus.y + 1, focus.z);
    _toCam.y = (d.h - 1) / d.dist;
    const len = Math.hypot(1, _toCam.y);
    _toCam.divideScalar(len);
    let want = d.dist * len;
    const hit = this.physics.castRayStatic(_pivot, _toCam, want + 0.5);
    if (hit !== null) want = Math.max(2, hit - 0.5);
    cam.position.copy(_pivot).addScaledVector(_toCam, want);
    _look.set(focus.x, focus.y + 0.5, focus.z);
    if (killerPos && d.t > 0.9) {
      const k = Math.min(1, (d.t - 0.9) / 1.2) * 0.45;
      _look.lerp(_desired.set(killerPos.x, killerPos.y + 0.6, killerPos.z), k);
    }
    d.look.lerp(_look, damp(4, dt));
    this.trauma = Math.max(0, this.trauma - dt * 1.2);
    const sh = this.trauma * this.trauma * this.settings.shakeScale;
    if (sh > 0.0001) {
      const t = this.time * 32;
      cam.position.x += Math.sin(t * 1.1) * sh;
      cam.position.y += Math.sin(t * 1.7 + 0.3) * sh;
    }
    cam.lookAt(d.look);
    this.fov += (56 - this.fov) * damp(2, dt);
    cam.fov = this.fov;
    cam.updateProjectionMatrix();
    return 0;
  }

  snap(target) {
    this._death = null;
    this._heading(target, _heading);
    this.dir.copy(_heading);
    this.smoothY = target.position.y;
    this.offset.copy(this.dir).multiplyScalar(-this.settings.distance);
    this.offset.y = this.settings.height;
    this.look.copy(target.position);
    this.armLength = null;
    this.update(0, target, true);
  }

  _heading(target, out) {
    out.set(0, 0, -1).applyQuaternion(target.quaternion);
    out.y = 0;
    if (out.lengthSq() < 0.04) out.copy(this.dir);
    return out.normalize();
  }

  /** target: { position, quaternion, velocity, fwdSpeed, lookBack } */
  update(dt, target, instant = false) {
    const s = this.settings;
    this.time += dt;
    this._death = null;

    this._heading(target, _heading);
    _vflat.copy(target.velocity);
    _vflat.y = 0;
    const flatSpeed = _vflat.length();
    const speedT = clamp(flatSpeed / s.speedRef, 0, 1);

    _desired.copy(_heading);
    if (flatSpeed > 4 && target.fwdSpeed > -1) {
      _vflat.normalize();
      const w = clamp((flatSpeed - 4) / 16, 0, 1) * s.velocityBlend;
      _desired.lerp(_vflat, w).normalize();
    }
    if (target.lookBack) _desired.negate();

    if (instant || target.lookBack !== this._lastLookBack) this.dir.copy(_desired);
    else this.dir.lerp(_desired, damp(s.dirSharpness, dt)).normalize();
    this._lastLookBack = target.lookBack;

    const dist = s.distance + (s.distanceFast - s.distance) * speedT;
    const height = s.height + (s.heightFast - s.height) * speedT;
    const tx = -this.dir.x * dist, tz = -this.dir.z * dist;
    const k = instant ? 1 : damp(s.offsetSharpness, dt);
    this.offset.x += (tx - this.offset.x) * k;
    this.offset.z += (tz - this.offset.z) * k;
    this.offset.y = height;

    // Smooth the vertical follow so bumps / landings don't jolt the view.
    const ky = instant ? 1 : damp(s.heightSharpness, dt);
    this.smoothY += (target.position.y - this.smoothY) * ky;
    // Never let the car get too far above/below the view.
    this.smoothY = clamp(this.smoothY, target.position.y - 2.5, target.position.y + 2.5);

    const cam = this.camera;
    _pivot.set(target.position.x, this.smoothY + s.lookHeight + 0.4, target.position.z);
    _toCam.set(this.offset.x, height - s.lookHeight - 0.4, this.offset.z);
    let want = _toCam.length();
    _toCam.divideScalar(want);

    // Spring arm: pull in instantly on collision, ease back out.
    const hit = this.physics.castRayStatic(_pivot, _toCam, want + 0.5);
    if (hit !== null) want = Math.max(1.5, hit - 0.5);
    if (this.armLength === null || instant || want < this.armLength) this.armLength = want;
    else this.armLength += (want - this.armLength) * damp(3, dt);

    cam.position.copy(_pivot).addScaledVector(_toCam, this.armLength);

    // Look target slightly ahead of the car along travel direction.
    _look.set(target.position.x, this.smoothY + s.lookHeight, target.position.z).addScaledVector(this.dir, s.lookAhead);
    if (instant) this.look.copy(_look);
    else this.look.lerp(_look, damp(20, dt));

    // Trauma shake (squared for a nicer falloff)
    this.trauma = Math.max(0, this.trauma - dt * 1.5);
    const sh = this.trauma * this.trauma * s.shakeScale;
    _shake.set(0, 0, 0);
    if (sh > 0.0001) {
      const t = this.time * 32;
      _shake.set(
        Math.sin(t * 1.1) * 0.6 + Math.sin(t * 2.3 + 1.7) * 0.4,
        Math.sin(t * 1.7 + 0.3) * 0.6 + Math.sin(t * 2.9 + 2.1) * 0.4,
        Math.sin(t * 1.3 + 4.1) * 0.5,
      ).multiplyScalar(sh);
      cam.position.add(_shake);
    }
    cam.lookAt(this.look.x + _shake.x * 0.5, this.look.y + _shake.y * 0.5, this.look.z);

    // Speed FOV kick
    const targetFov = s.fov + (s.fovFast - s.fov) * speedT * speedT;
    this.fov += (targetFov - this.fov) * (instant ? 1 : damp(4, dt));
    if (Math.abs(cam.fov - this.fov) > 0.01) {
      cam.fov = this.fov;
      cam.updateProjectionMatrix();
    }
    return speedT;
  }
}
