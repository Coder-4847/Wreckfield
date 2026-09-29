// Generic damageable component, composed onto vehicles and targets alike (not a base class — anything that
// wants to take damage just owns one of these and registers its collider(s) with Physics pointing at itself).

export class Health {
  constructor(max, { onDamage, onDeath } = {}) {
    this.max = max;
    this.current = max;
    this.dead = false;
    this.invuln = 0; // seconds of damage immunity (post-respawn grace)
    this.lastHitTime = -Infinity;
    this.onDamage = onDamage ?? null;
    this.onDeath = onDeath ?? null;
  }

  get pct() {
    return this.max > 0 ? this.current / this.max : 0;
  }

  update(dt) {
    if (this.invuln > 0) this.invuln = Math.max(0, this.invuln - dt);
  }

  /** Returns true if the damage was actually applied (false if dead/invulnerable/non-positive). */
  takeDamage(amount, point, normal, source, time = 0, cause = null) {
    if (this.dead || this.invuln > 0 || amount <= 0) return false;
    this.current = Math.max(0, this.current - amount);
    this.lastHitTime = time;
    this.onDamage?.(amount, point, normal, source, cause);
    if (this.current <= 0) {
      this.dead = true;
      this.onDeath?.(point, normal, source, cause);
    }
    return true;
  }

  heal(amount) {
    if (this.dead) return;
    this.current = Math.min(this.max, this.current + amount);
  }

  /** Full reset (respawn / match start). Grants a brief grace period against spawn-camping. */
  reset(graceSeconds = 1.5) {
    this.current = this.max;
    this.dead = false;
    this.invuln = graceSeconds;
  }
}
