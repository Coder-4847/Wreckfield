import * as THREE from 'three';

// Fixed-size pool of kinematic projectiles: plain position/velocity integration + a ray sweep against the
// Rapier world each fixed step (no dynamic rigid bodies — far cheaper for fast, short-lived bolts, and avoids
// them nudging things on contact). Rendered as a single InstancedMesh (one draw call for the whole pool).

const POOL_SIZE = 160; // headroom for 4 simultaneous shooters incl. chain guns / scatterguns / flamethrowers
const BOLT_LENGTH = 2.0;
const BOLT_RADIUS = 0.06;

const _seg = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _hitPos = new THREE.Vector3();
const _hitNorm = new THREE.Vector3();
const _ipos = new THREE.Vector3();
const _iquat = new THREE.Quaternion();
const _iscale = new THREE.Vector3(1, 1, 1);
const _mat = new THREE.Matrix4();
const _unitY = new THREE.Vector3(0, 1, 0);
const ZERO_SCALE = new THREE.Vector3(0, 0, 0);

export class Projectiles {
  constructor(scene) {
    this.pool = Array.from({ length: POOL_SIZE }, () => ({
      active: false,
      prevPos: new THREE.Vector3(),
      currPos: new THREE.Vector3(),
      vel: new THREE.Vector3(),
      life: 0,
      maxLife: 1,
      damage: 0,
      ownerBody: null,
      owner: null,
      kind: 'cannon',
      color: new THREE.Color(1, 1, 1),
    }));

    const geo = new THREE.CylinderGeometry(BOLT_RADIUS, BOLT_RADIUS * 0.7, 1, 8, 1, true);
    geo.translate(0, -0.5, 0); // pivot at the trailing end so we can place by leading tip
    // Warm autocannon tracer (per-instance tint multiplies this — overcharge goes red, flak goes orange).
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffd08a).multiplyScalar(2.4), toneMapped: false, fog: false });
    this.mesh = new THREE.InstancedMesh(geo, mat, POOL_SIZE);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < POOL_SIZE; i++) this.mesh.setColorAt(i, this.pool[i].color); // allocates instanceColor
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
    this.mesh.count = POOL_SIZE;
    scene.add(this.mesh);

    // Hot core (brighter, thinner, additive) layered on the same instances for a laser-bolt glow.
    const coreGeo = new THREE.CylinderGeometry(BOLT_RADIUS * 0.4, BOLT_RADIUS * 0.25, 1, 6, 1, true);
    coreGeo.translate(0, -0.5, 0);
    const coreMat = new THREE.MeshBasicMaterial({
      color: 0xffffff, toneMapped: false, fog: false, transparent: true, opacity: 0.9,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this.core = new THREE.InstancedMesh(coreGeo, coreMat, POOL_SIZE);
    this.core.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.core.frustumCulled = false;
    this.core.renderOrder = 5;
    this.core.count = POOL_SIZE;
    scene.add(this.core);

    this.cursor = 0;
    this.trail = null; // (projectile, dt) => void — optional per-step hook (shell smoke, flame particles)
  }

  spawn(origin, dir, ownerBody, owner, { damage, speed, life, kind = 'cannon', color = null }) {
    const p = this.pool[this.cursor];
    this.cursor = (this.cursor + 1) % POOL_SIZE;
    p.active = true;
    p.kind = kind;
    if (color) p.color.setRGB(color[0], color[1], color[2]); else p.color.setRGB(1, 1, 1);
    this.mesh.setColorAt(this.cursor === 0 ? POOL_SIZE - 1 : this.cursor - 1, p.color);
    this.mesh.instanceColor.needsUpdate = true;
    p.prevPos.copy(origin);
    p.currPos.copy(origin);
    p.vel.copy(dir).multiplyScalar(speed);
    p.life = life;
    p.maxLife = life;
    p.damage = damage;
    p.ownerBody = ownerBody;
    p.owner = owner;
    return p;
  }

  /** Deactivate every bolt (match reset). */
  clear() {
    for (const p of this.pool) p.active = false;
  }

  /** Fixed-step integration + collision. `onHit(point, normal, entity, projectile)` is called on any contact. */
  update(dt, physics, onHit) {
    for (const p of this.pool) {
      if (!p.active) continue;
      p.prevPos.copy(p.currPos);
      p.life -= dt;
      if (p.life <= 0 || p.currPos.y < -30) {
        p.active = false;
        continue;
      }

      _seg.copy(p.vel).multiplyScalar(dt);
      const dist = _seg.length();
      if (dist < 1e-6) continue;
      _dir.copy(_seg).divideScalar(dist);

      const hit = physics.castRay(p.currPos, _dir, dist, p.ownerBody, 1);
      if (hit) {
        _hitPos.copy(hit.point);
        _hitNorm.set(hit.normal.x, hit.normal.y, hit.normal.z);
        const entity = physics.getEntity(hit.collider);
        p.active = false;
        onHit?.(_hitPos, _hitNorm, entity, p);
        continue;
      }
      p.currPos.add(_seg);
      if (this.trail && (p.kind === 'shell' || p.kind === 'flame')) this.trail(p, dt);
    }
  }

  /** Once per rendered frame: write interpolated instance matrices. `alpha` blends prev->curr physics state. */
  syncVisual(alpha) {
    for (let i = 0; i < POOL_SIZE; i++) {
      const p = this.pool[i];
      if (!p.active) {
        _mat.compose(_ipos.set(0, -1000, 0), _iquat.identity(), ZERO_SCALE);
        this.mesh.setMatrixAt(i, _mat);
        this.core.setMatrixAt(i, _mat);
        continue;
      }
      _ipos.lerpVectors(p.prevPos, p.currPos, alpha);
      _dir.copy(p.vel).normalize();
      _iquat.setFromUnitVectors(_unitY, _dir);
      // Fade the tail length in/out over the first/last instants of life so bolts don't pop.
      const lenT = Math.min(1, (p.maxLife - p.life) * 40);
      if (p.kind === 'flame') _iscale.set(0, 0, 0); // drawn as fire particles instead
      else if (p.kind === 'shell') _iscale.set(3.6, 1.1 * lenT, 3.6);
      else if (p.kind === 'shotgun') _iscale.set(0.8, BOLT_LENGTH * 0.55 * lenT, 0.8);
      else if (p.kind === 'minigun') _iscale.set(0.85, BOLT_LENGTH * 0.8 * lenT, 0.85);
      else _iscale.set(1, BOLT_LENGTH * lenT, 1);
      _mat.compose(_ipos, _iquat, _iscale);
      this.mesh.setMatrixAt(i, _mat);
      this.core.setMatrixAt(i, _mat);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.core.instanceMatrix.needsUpdate = true;
  }
}
