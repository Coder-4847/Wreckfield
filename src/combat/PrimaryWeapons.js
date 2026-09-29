// Primary weapons: the roof-station gun. Pick one in the menu; every combatant carries exactly one for the whole
// match (bots roll theirs per match). Ammo is unlimited — the trade-off is rate / range / damage profile. Secondary
// crate weapons (missile, mine, flak, laser) are separate and stack on top of these.
//
// `kind` picks the behaviour in combat/Weapon.js:
//   bolt   — one tracer per shot (autocannon)
//   spin   — bolt, but the fire rate winds up while the trigger is held (rotary chain gun)
//   pellet — a cone of short-lived pellets per shot (scattergun)
//   beam   — instant hitscan beam (rail sniper)
//   shell  — slow explosive shell with a finishing-blow detonation (breacher)
//   flame  — short-range stream that ignites targets (flamethrower)
//
// `ai` tunes how a bot uses the weapon: fire range, preferred fighting distance multiplier, projectile speed for lead
// calculation, burst pacing and aim-cone multipliers.

export const PRIMARY = {
  cannon: {
    name: 'AUTOCANNON', short: 'AUTO', role: 'All-rounder', kind: 'bolt', color: '#ffd08a',
    desc: 'Reliable and accurate at any range. Fast tracers, steady damage.',
    // (rate / damage / speed come from the live-tunable vehicle config so the debug panel still works)
    hud: 'none',
    ai: { rangeMul: 1, cone: 1, burst: 1, speed: 85 },
  },
  minigun: {
    name: 'CHAIN GUN', short: 'CHAIN', role: 'Spin-up', kind: 'spin', color: '#ffb35a',
    desc: 'Spins up from a crawl to a brutal stream. Sprays a little wide.',
    rateMin: 3.2, rateMax: 17, spinUp: 1.5, spinDown: 0.7, damage: 8, spread: 0.028, speed: 96, life: 0.75, recoil: 0.32, hud: 'spin',
    ai: { fireRange: 55, rangeMul: 1.1, cone: 1.4, burst: 2.2, speed: 96 },
  },
  shotgun: {
    name: 'SCATTERGUN', short: 'SCATTER', role: 'Close range', kind: 'pellet', color: '#ffc04a',
    desc: 'Slow, heavy blast of pellets. Devastating up close, useless far away.',
    rate: 1.25, damage: 8.5, pellets: 11, spread: 0.075, speed: 108, life: 0.34, recoil: 1.6, hud: 'reload',
    ai: { fireRange: 27, rangeMul: 0.55, cone: 1.8, burst: 0.25, speed: 108 },
  },
  sniper: {
    name: 'RAIL SNIPER', short: 'RAIL', role: 'Long range', kind: 'beam', color: '#8fd8ff',
    desc: 'Instant beam, huge damage, long reload. Scopes in for distance shots.',
    rate: 0.45, damage: 64, range: 190, beamTime: 0.24, recoil: 1.2, zoom: 0.8, hud: 'reload',
    ai: { fireRange: 120, rangeMul: 2.2, cone: 0.55, burst: 0.12, speed: 900 },
  },
  breacher: {
    name: 'BREACHER', short: 'BREACH', role: 'Heavy shell', kind: 'shell', color: '#ff7a3a',
    desc: 'Explosive shell. Wrecks light cars outright and leaves heavy ones nearly dead — then ram them. Very slow.',
    rate: 0.34, speed: 64, life: 2.2, radius: 7.5, direct: 3.4, lowLeft: [12, 22], finish: 45, splash: 120, knock: 13, lift: 4.5, recoil: 2.2, hud: 'reload',
    // "light" cars die to a direct hit, everything with more hull than this is left on a sliver
    killBelow: 190,
    ai: { fireRange: 75, rangeMul: 1.5, cone: 0.85, burst: 0.1, speed: 64 },
  },
  flame: {
    name: 'INFERNO', short: 'FLAME', role: 'Flamethrower', kind: 'flame', color: '#ff8a2a',
    desc: 'Short-range fire stream that sets targets ablaze. Melts anything you can get close to.',
    rate: 18, damage: 3.1, speed: 40, life: 0.36, spread: 0.07, burn: 2.4, burnDps: 7, recoil: 0.0, hud: 'none',
    ai: { fireRange: 15, rangeMul: 0.45, cone: 1.9, burst: 2.6, speed: 40 },
  },
};

export const PRIMARY_KEYS = Object.keys(PRIMARY);

// Which weapons each fighting style tends to roll (bots pick one at random per match).
export const BOT_LOADOUTS = {
  balanced: ['cannon', 'minigun', 'breacher', 'sniper', 'shotgun'],
  aggressive: ['shotgun', 'flame', 'minigun', 'cannon', 'breacher'],
  defensive: ['sniper', 'breacher', 'cannon', 'minigun'],
};
