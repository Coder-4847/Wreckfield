// Thin wrapper around a Rapier world: fixed-step stepping, ray queries, and impact event dispatch.

export class Physics {
  constructor(RAPIER, dt, gravity = -16) {
    this.R = RAPIER;
    this.world = new RAPIER.World({ x: 0, y: gravity, z: 0 });
    this.world.timestep = dt;
    this.gravity = gravity;
    this.eventQueue = new RAPIER.EventQueue(true);
    this.impactHandlers = [];
    this.collisionHandlers = [];
    this._ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
    this._hit = { distance: 0, point: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 1, z: 0 }, collider: null };
    // Second scratch ray/hit so projectile sweeps (which may run interleaved with wheel raycasts within the
    // same fixed step) never clobber a result the caller hasn't read yet.
    this._ray2 = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
    this._hit2 = { distance: 0, point: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 1, z: 0 }, collider: null };
    this.entities = new Map(); // collider.handle -> owning game entity (for damage/gameplay lookups)
  }

  /** Associate a collider with a game entity so impact/projectile hits can resolve who got hit. */
  registerCollider(collider, entity) {
    if (collider) this.entities.set(collider.handle, entity);
  }

  unregisterCollider(collider) {
    if (collider) this.entities.delete(collider.handle);
  }

  getEntity(collider) {
    return collider ? this.entities.get(collider.handle) : undefined;
  }

  setGravity(g) {
    this.gravity = g;
    this.world.gravity = { x: 0, y: g, z: 0 };
  }

  onImpact(fn) {
    this.impactHandlers.push(fn);
  }

  /** Register a sensor collision handler: fn(entity1, entity2, collider1, collider2, started). */
  onCollision(fn) {
    this.collisionHandlers.push(fn);
  }

  step() {
    this.world.step(this.eventQueue);
    if (!this.impactHandlers.length) {
      this.eventQueue.drainContactForceEvents(() => {});
    } else {
      this.eventQueue.drainContactForceEvents((ev) => {
        const c1 = this.world.getCollider(ev.collider1());
        const c2 = this.world.getCollider(ev.collider2());
        if (!c1 || !c2) return;
        let point = null;
        let normal = null;
        this.world.contactPair(c1, c2, (manifold, flipped) => {
          if (point || manifold.numSolverContacts() === 0) return;
          const p = manifold.solverContactPoint(0);
          const n = manifold.normal();
          point = { x: p.x, y: p.y, z: p.z };
          // Normal points from c1 toward c2; flip so it's always expressed relative to c1.
          const s = flipped ? -1 : 1;
          normal = { x: n.x * s, y: n.y * s, z: n.z * s };
        });
        if (!point) return;
        const event = { c1, c2, magnitude: ev.totalForceMagnitude(), point, normal };
        for (const h of this.impactHandlers) h(event);
      });
    }
    if (!this.collisionHandlers.length) {
      this.eventQueue.drainCollisionEvents(() => {});
      return;
    }
    this.eventQueue.drainCollisionEvents((handle1, handle2, started) => {
      const c1 = this.world.getCollider(handle1);
      const c2 = this.world.getCollider(handle2);
      if (!c1 || !c2) return;
      const e1 = this.getEntity(c1);
      const e2 = this.getEntity(c2);
      for (const h of this.collisionHandlers) h(e1, e2, c1, c2, started);
    });
  }

  /**
   * Cast a ray and return a shared hit record (valid until the next call using the same `slot`) or null.
   * Sensors are always ignored; `excludeBody` lets vehicles ignore their own chassis. `slot` selects which
   * scratch ray/hit buffer to use (0 = wheels/camera, 1 = projectiles) so concurrent callers within one fixed
   * step never overwrite each other's still-unread result.
   */
  castRay(origin, dir, maxDist, excludeBody = null, slot = 0) {
    const ray = slot ? this._ray2 : this._ray;
    ray.origin.x = origin.x; ray.origin.y = origin.y; ray.origin.z = origin.z;
    ray.dir.x = dir.x; ray.dir.y = dir.y; ray.dir.z = dir.z;
    const hit = this.world.castRayAndGetNormal(
      ray, maxDist, true,
      this.R.QueryFilterFlags.EXCLUDE_SENSORS,
      undefined, undefined, excludeBody ?? undefined,
    );
    if (!hit) return null;
    const out = slot ? this._hit2 : this._hit;
    out.distance = hit.timeOfImpact;
    out.point.x = origin.x + dir.x * hit.timeOfImpact;
    out.point.y = origin.y + dir.y * hit.timeOfImpact;
    out.point.z = origin.z + dir.z * hit.timeOfImpact;
    out.normal.x = hit.normal.x; out.normal.y = hit.normal.y; out.normal.z = hit.normal.z;
    out.collider = hit.collider;
    return out;
  }

  /** Ray query restricted to fixed (static) colliders — used by the camera. */
  castRayStatic(origin, dir, maxDist) {
    const ray = this._ray;
    ray.origin.x = origin.x; ray.origin.y = origin.y; ray.origin.z = origin.z;
    ray.dir.x = dir.x; ray.dir.y = dir.y; ray.dir.z = dir.z;
    const flags = this.R.QueryFilterFlags.EXCLUDE_SENSORS | this.R.QueryFilterFlags.EXCLUDE_DYNAMIC;
    const hit = this.world.castRay(ray, maxDist, true, flags);
    return hit ? hit.timeOfImpact : null;
  }
}
