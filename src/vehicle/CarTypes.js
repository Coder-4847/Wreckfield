import { makeProfile } from './CarGeometry.js';
import { STATION } from './WeaponStation.js';

// Car body types. All share one physics envelope (wheelbase / track / collider — see VehicleConfig) so handling
// stays consistent; what differs is the silhouette (visual) and a light stat spread (mass / hull / power / top speed).
// Profiles are [forward-distance f, value] pairs (f>0 = toward the nose), y measured from the chassis center.

export const CAR_TYPES = {
  coupe: {
    name: 'APEX GT', role: 'Sport coupe', blurb: 'Fast and low. Fragile if you get sloppy.',
    paint: '#c62f24',
    stats: { mass: 0.95, health: 0.9, engine: 1.1, top: 1.06 },
    body: {
      n: 3.6,
      bottom: [[-2.15, -0.14], [-1.9, -0.3], [1.9, -0.3], [2.2, -0.16]],
      top: [[-2.15, 0.12], [-1.95, 0.28], [-1.4, 0.36], [-0.3, 0.34], [0.6, 0.3], [1.4, 0.16], [2.05, 0.02], [2.2, -0.06]],
      width: [[-2.15, 0.7], [-1.9, 0.92], [-1.2, 0.98], [0.2, 0.99], [1.2, 0.97], [1.9, 0.9], [2.2, 0.7]],
    },
    cabin: {
      n: 3.2,
      roof: [[-1.6, 0.36], [-1.1, 0.6], [-0.4, 0.68], [0.2, 0.64], [0.85, 0.34]],
      width: [[-1.6, 0.7], [-1.0, 0.78], [0.0, 0.8], [0.85, 0.74]],
    },
    extras: ['spoilerGT', 'splitter', 'diffuser', 'hoodVent'],
    wheelTrim: 'sport',
  },
  muscle: {
    name: 'BRUTE V8', role: 'Muscle car', blurb: 'Heavy hitter. Big engine, big hood.',
    paint: '#1c5fa8',
    stats: { mass: 1.08, health: 1.05, engine: 1.14, top: 1.0 },
    body: {
      n: 4.2,
      bottom: [[-2.2, -0.12], [-2.0, -0.3], [2.0, -0.3], [2.3, -0.14]],
      top: [[-2.2, 0.26], [-1.9, 0.4], [-1.2, 0.42], [-0.2, 0.38], [0.8, 0.36], [1.6, 0.3], [2.1, 0.24], [2.3, 0.1]],
      width: [[-2.2, 0.82], [-1.9, 0.97], [-1.0, 1.0], [1.0, 1.0], [1.9, 0.96], [2.3, 0.8]],
    },
    cabin: {
      n: 3.4,
      roof: [[-1.25, 0.42], [-0.8, 0.66], [-0.1, 0.7], [0.4, 0.64], [0.95, 0.38]],
      width: [[-1.25, 0.78], [-0.4, 0.86], [0.95, 0.8]],
    },
    extras: ['hoodScoop', 'ducktail', 'racingStripes', 'bumperBar'],
    wheelTrim: 'muscle',
  },
  suv: {
    name: 'WARDEN', role: 'Armored SUV', blurb: 'Tanky and stable. Not quick.',
    paint: '#4a5a44',
    stats: { mass: 1.2, health: 1.3, engine: 1.0, top: 0.94 },
    body: {
      n: 4.6,
      bottom: [[-2.15, -0.2], [-1.95, -0.3], [1.95, -0.3], [2.2, -0.2]],
      top: [[-2.15, 0.5], [-1.9, 0.58], [-1.0, 0.6], [0.6, 0.5], [1.4, 0.46], [2.0, 0.4], [2.2, 0.28]],
      width: [[-2.15, 0.85], [-1.9, 0.97], [1.9, 0.97], [2.2, 0.86]],
    },
    cabin: {
      n: 4.0,
      roof: [[-2.0, 0.6], [-1.85, 0.97], [0.0, 1.0], [0.7, 0.94], [1.25, 0.55]],
      width: [[-2.0, 0.9], [0.0, 0.92], [1.25, 0.85]],
    },
    extras: ['roofRails', 'bullBar', 'sideSteps', 'roofLightBar'],
    wheelTrim: 'offroad',
  },
  pickup: {
    name: 'HAULER', role: 'Pickup truck', blurb: 'Strong frame and a roomy bed for hardware.',
    paint: '#d8a21c',
    stats: { mass: 1.12, health: 1.18, engine: 1.02, top: 0.96 },
    body: {
      n: 4.6,
      bottom: [[-2.15, -0.2], [-1.95, -0.3], [1.95, -0.3], [2.25, -0.2]],
      top: [[-2.2, 0.42], [-2.0, 0.46], [-0.6, 0.44], [0.0, 0.5], [1.0, 0.48], [2.0, 0.38], [2.25, 0.26]],
      width: [[-2.2, 0.88], [-1.95, 0.97], [1.9, 0.97], [2.25, 0.86]],
    },
    cabin: {
      n: 4.0,
      roof: [[-0.55, 0.5], [-0.45, 0.9], [0.0, 0.97], [0.75, 0.93], [1.25, 0.52]],
      width: [[-0.55, 0.9], [0.4, 0.92], [1.25, 0.86]],
    },
    extras: ['bedWalls', 'rollBar', 'bullBar', 'sideSteps'],
    wheelTrim: 'offroad',
  },
  hatch: {
    name: 'STING', role: 'Rally hatch', blurb: 'Light and twitchy. Wins by dodging.',
    paint: '#e8e9ec',
    stats: { mass: 0.88, health: 0.88, engine: 1.04, top: 1.0 },
    body: {
      n: 3.4,
      bottom: [[-1.9, -0.14], [-1.7, -0.28], [1.7, -0.28], [1.95, -0.16]],
      top: [[-1.9, 0.22], [-1.75, 0.44], [-1.0, 0.46], [0.6, 0.36], [1.4, 0.22], [1.95, 0.04]],
      width: [[-1.9, 0.8], [-1.7, 0.95], [-1.0, 0.97], [1.2, 0.95], [1.95, 0.75]],
    },
    cabin: {
      n: 3.6,
      roof: [[-1.75, 0.46], [-1.6, 0.8], [-0.3, 0.85], [0.5, 0.74], [1.0, 0.4]],
      width: [[-1.75, 0.84], [-0.3, 0.86], [1.0, 0.8]],
    },
    extras: ['roofWing', 'rallyLights', 'mudflaps'],
    wheelTrim: 'rally',
  },
};

export const CAR_KEYS = Object.keys(CAR_TYPES);

// Where the roof weapon station sits (forward distance f along the flat part of each roof) — the visual station and
// the physics muzzle are both derived from this, so tracers leave the barrel the player actually sees.
const TURRET_F = { coupe: -0.25, muscle: -0.15, suv: -0.3, pickup: 0.2, hatch: -0.45 };

export function stationMount(key) {
  const spec = CAR_TYPES[key] ?? CAR_TYPES.coupe;
  const f = TURRET_F[key] ?? 0;
  return { f, y: makeProfile(spec.cabin.roof)(f) };
}

/** Apply a car type's stat multipliers onto a Vehicle's live cfg (base values come from the pristine config). */
export function applyCarStats(vehicle, baseCfg, key) {
  const s = CAR_TYPES[key].stats;
  const c = vehicle.cfg;
  c.mass = baseCfg.mass * s.mass;
  c.maxHealth = Math.round(baseCfg.maxHealth * s.health);
  c.engineForce = baseCfg.engineForce * s.engine;
  c.topSpeed = baseCfg.topSpeed * s.top;
  const m = stationMount(key);
  c.weaponMount = [0, m.y + STATION.barrelY * STATION.scale, -m.f];
  c.weaponMuzzleForward = -STATION.muzzleZ * STATION.scale;
  vehicle.applyMassProperties();
  vehicle.health.max = c.maxHealth;
  vehicle.health.reset(0);
}
