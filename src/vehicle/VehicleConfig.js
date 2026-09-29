// Tunable parameters for the raycast vehicle. Units: meters, kilograms, seconds, newtons.
// Local vehicle frame: +X right, +Y up, -Z forward (Three.js object convention).
// All values are live-tunable through the debug panel (` key) — use "Copy JSON" there to bake changes back here.

export const DEFAULT_VEHICLE = {
  name: 'Ravager',

  // --- Chassis -----------------------------------------------------------
  mass: 1200,
  chassisHalfExtents: [1.0, 0.32, 2.1],   // main collision box (round cuboid)
  cabinHalfExtents: [0.72, 0.24, 0.95],   // roof collider so the car rests on its roof, not its belly
  cabinOffset: [0, 0.52, 0.25],
  comOffset: [0, -0.38, -0.08],           // low + slightly forward CoM: stable, mild understeer at the limit
  inertiaScale: [1.0, 1.0, 1.35],         // extra roll inertia resists tipping on hard turns
  linearDamping: 0.02,
  angularDamping: 0.55,
  bodyFriction: 0.35,
  bodyRestitution: 0.12,
  impactThreshold: 22000,                 // contact force (N) before a collision reports an impact event

  // --- Wheels / suspension ----------------------------------------------
  wheelRadius: 0.42,
  wheelWidth: 0.36,
  wheels: [
    { pos: [-0.9, -0.05, -1.3], front: true },
    { pos: [0.9, -0.05, -1.3], front: true },
    { pos: [-0.9, -0.05, 1.35], front: false },
    { pos: [0.9, -0.05, 1.35], front: false },
  ],
  suspTravel: 0.36,              // max extension below mount point (ray length = travel + radius)
  springStiffness: 38000,        // N/m per corner  (~1.8 Hz at 300kg corner mass)
  damperCompression: 2800,       // N/(m/s)
  damperRebound: 3600,           // N/(m/s)
  bumpStopStart: 0.85,           // fraction of travel where the bump stop engages
  bumpStopStiffness: 6,          // multiplier on spring stiffness past bump stop
  maxSuspensionForce: 60000,
  antiRollFront: 16000,          // N/m
  antiRollRear: 12000,

  // --- Engine / brakes ----------------------------------------------------
  engineForce: 16500,            // total drive force at 0 km/h
  topSpeed: 38,                  // m/s (~137 km/h)
  engineCurveExponent: 2.2,      // force falls off as (1 - (v/top)^exp)
  reverseForce: 9000,
  reverseTopSpeed: 14,
  frontDriveShare: 0.35,         // AWD split, rest goes to the rear axle
  brakeForce: 24000,
  brakeBias: 0.62,               // share of brake force at the front axle
  handbrakeForce: 2400,
  rollingResistance: 14,         // N per (m/s) per wheel
  dragCoefficient: 0.75,         // F = c * v^2
  downforce: 3.2,                // N per (m/s)^2, only while grounded

  // --- Tires --------------------------------------------------------------
  // Lateral grip is an impulse that cancels a fraction of each wheel's sideways slide per step
  // (frame-rate independent via 1 - exp(-rate*dt)), capped by a friction circle of mu * load.
  frontGripRate: 46,
  rearGripRate: 40,
  frontMu: 1.45,
  rearMu: 1.35,
  slideStart: 2.5,               // lateral slip (m/s) where tires begin to lose grip
  slideFull: 9.0,                // lateral slip where the slide grip floor is reached
  slideMuScale: 0.72,            // kinetic grip multiplier while sliding (makes drifts sustainable)
  handbrakeGripRate: 11,
  handbrakeMuScale: 0.58,
  rollInfluence: 0.3,            // 0 = tire forces act at CoM height (no body roll), 1 = at contact patch

  // --- Steering -----------------------------------------------------------
  maxSteer: 0.6,                 // rad at standstill
  minSteer: 0.17,                // rad at steerSpeedRef and above
  steerSpeedRef: 32,
  steerRate: 3.4,                // rad/s toward target
  steerReturnRate: 5.5,          // rad/s back toward center
  driftAssist: 0.45,             // yaw stabilisation while sliding without steering input (0..1)

  // --- Air ----------------------------------------------------------------
  airPitchTorque: 2600,
  airYawTorque: 2200,
  airLeveling: 2400,             // self-righting torque when no air input
  airAngularDrag: 1.4,

  // --- Recovery -----------------------------------------------------------
  flipDetectDelay: 1.2,          // seconds upside-down before showing the recover prompt
  autoRecoverDelay: 3.5,

  // --- Engine sim for audio/HUD ------------------------------------------
  idleRpm: 950,
  maxRpm: 7400,
  gearSpeeds: [0, 9, 16, 24, 31, 40], // m/s upper bound per gear

  // --- Health & hull damage ------------------------------------------------
  maxHealth: 200,
  hullDamageThreshold: 55000,     // contact force (N) before a collision starts denting the hull (> impactThreshold, so light taps only spark)
  hullDamageRange: 260000,        // force span over which damage scales 0..hullDamagePerHit
  hullDamagePerHit: 34,           // damage at/above hullDamageThreshold+hullDamageRange in one contact event

  // --- Weapon (roof-mounted forward cannon) --------------------------------
  weaponMount: [0, 0.98, -0.15],  // local spawn point (roof, slightly forward of center)
  weaponMuzzleForward: 1.55,      // how far ahead of the mount the muzzle sits (clears the car's own hull)
  weaponFireRate: 6,              // shots per second
  weaponDamage: 20,
  weaponProjectileSpeed: 85,      // m/s
  weaponProjectileLife: 1.6,      // seconds before a miss fizzles out
  weaponRecoil: 900,              // N impulse applied to the shooter opposite the fire direction

  // --- Boost -----------------------------------------------------------------
  boostMax: 100, boostDrainRate: 40, boostRegenRate: 9, boostForceMult: 1.85, boostTopSpeedMult: 1.3,
  boostMinToStart: 8, boostPadImpulse: 5200, boostPadMeterGain: 35, boostPickupMeterGain: 100,
  boostPadCooldown: 1.2,
  // --- Hazard zones ------------------------------------------------------------
  hazardDamagePerSecond: 55, hazardTractionMult: 0.45,
  // --- Health pickup -----------------------------------------------------------
  healthPickupAmount: 90,
  // --- Overcharge pickup ---------------------------------------------------
  overchargeDuration: 8, overchargeFireRateMult: 1.6, overchargeDamageMult: 1.4,
};
