// Secondary weapons: earned from supply-crate pickups, limited ammo, fired with E / right-click / R3.
// The primary autocannon (Weapon.js) stays unlimited; these are the "power" weapons.

export const SECONDARY = {
  missile: { label: 'HOMING MISSILE', short: 'MISSILE', color: '#ff8a3c', ammo: 3, cooldown: 1.1 },
  mine: { label: 'PROXIMITY MINE', short: 'MINE', color: '#ff4b4b', ammo: 3, cooldown: 0.7 },
  scatter: { label: 'FLAK SCATTER', short: 'FLAK', color: '#ffc04a', ammo: 5, cooldown: 0.85 },
  laser: { label: 'PULSE LASER', short: 'LASER', color: '#5cd6ff', ammo: 4, cooldown: 1.25 },
};

// Live-tunable numbers (debug panel edits this object directly).
export const SEC = {
  // Homing missile: launches slow, accelerates, turns at a limited rate (dodgeable), splash on impact/fuse.
  missileDamage: 52, missileRadius: 6.5, missileLaunchSpeed: 26, missileSpeed: 64, missileAccel: 42,
  missileTurnRate: 2.3, missileLife: 4.2, missileFuse: 2.4, missileKnock: 9,
  // Mine: dropped behind, arms after a delay, triggers on proximity of any non-owner vehicle.
  mineDamage: 46, mineRadius: 6.0, mineArmTime: 1.0, mineTrigger: 3.0, mineLife: 32, mineMax: 3, mineKnock: 7, mineLaunch: 8,
  // Flak scatter: a cone of pellets (reuses the projectile pool), short range, brutal up close.
  flakPellets: 9, flakDamage: 9, flakSpread: 0.13, flakSpeed: 100, flakLife: 0.42,
  // Pulse laser: instant hitscan beam, high single-shot damage.
  laserDamage: 34, laserRange: 110, laserBeamTime: 0.16,
};
