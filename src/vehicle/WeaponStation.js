import * as THREE from 'three';

// Low-profile remote weapon station bolted flat onto the roof: an armoured, faceted cradle on a slim turret ring, a
// 30 mm-style autocannon with a slotted heat shroud and muzzle brake, a coaxial gun, a side ammo can with feed chute,
// and an optics head (day/thermal windows). Replaces the old "periscope on a stalk" look.
//
// Local frame: origin = turret-ring centre on the roof surface, -Z forward. Returned `barrelY` / `muzzleZ` are what
// the physics weapon mount must match (see CarTypes.applyCarStats).

export const STATION = {
  scale: 1.28, // whole station scale on the roof (geometry below is authored at 1.0)
  ringH: 0.05,
  barrelY: 0.19, // barrel axis above the roof surface (unscaled)
  muzzleZ: -1.12, // muzzle brake face, forward of the ring centre (unscaled)
};

function sideProfileGeo(pts, width, bevel = 0.012) {
  // Shape drawn in (forward, up); extruded across the car (x) and centred.
  const shape = new THREE.Shape();
  pts.forEach(([u, v], i) => (i ? shape.lineTo(u, v) : shape.moveTo(u, v)));
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: width - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 1,
  });
  geo.translate(0, 0, -(width - bevel * 2) / 2);
  geo.rotateY(Math.PI / 2); // shape +x (forward) -> world -z; extrude z -> world x
  geo.computeVertexNormals();
  return geo;
}

const cylZ = (rTop, rBot, len, seg = 14) => new THREE.CylinderGeometry(rTop, rBot, len, seg).rotateX(Math.PI / 2);

/**
 * mats: { armor, dark, gunmetal, accent, glass, lens }. Returns { root, swivel, recoil, muzzle } — `recoil` is the group
 * that kicks back when firing; `muzzle` is where the flash sprite goes.
 */
export function buildWeaponStation(mats, add) {
  const root = new THREE.Group();
  const m = (geo, mat, x, y, z, parent) => add(geo, mat, x, y, z, parent);

  // Roof adapter plate + turret ring
  m(new THREE.BoxGeometry(0.62, 0.025, 0.7), mats.dark, 0, 0.012, 0.02, root);
  m(new THREE.CylinderGeometry(0.27, 0.3, STATION.ringH, 28), mats.gunmetal, 0, 0.025 + STATION.ringH / 2, 0, root);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    m(new THREE.CylinderGeometry(0.012, 0.012, 0.02, 6), mats.dark, Math.sin(a) * 0.285, 0.03 + STATION.ringH, Math.cos(a) * 0.285, root);
  }

  const swivel = new THREE.Group();
  swivel.position.y = 0.025 + STATION.ringH;
  root.add(swivel);

  // Armoured cradle: two angled cheek plates with a lower armoured body between them.
  const by = STATION.barrelY - swivel.position.y; // barrel axis in swivel space
  const body = sideProfileGeo([[-0.3, 0], [0.26, 0], [0.34, 0.07], [0.3, 0.17], [-0.16, 0.22], [-0.3, 0.16]], 0.3);
  m(body, mats.armor, 0, 0, 0, swivel);
  for (const s of [-1, 1]) {
    const cheek = sideProfileGeo([[-0.26, 0.02], [0.3, 0.02], [0.38, 0.1], [0.3, 0.27], [-0.1, 0.31], [-0.26, 0.24]], 0.07, 0.01);
    m(cheek, mats.armor, s * 0.19, 0, 0, swivel);
    // accent pinstripe along each cheek (livery colour)
    const stripe = m(new THREE.BoxGeometry(0.006, 0.02, 0.44), mats.accent, s * 0.226, 0.2, -0.02, swivel);
    stripe.rotation.x = -0.09;
    // bolt heads
    for (const [u, v] of [[-0.18, 0.07], [0.18, 0.07], [0.0, 0.24]]) {
      m(new THREE.CylinderGeometry(0.011, 0.011, 0.012, 6).rotateZ(Math.PI / 2), mats.dark, s * 0.227, v, -u, swivel);
    }
  }
  // top hatch plate + lifting eyes
  m(new THREE.BoxGeometry(0.26, 0.018, 0.3), mats.gunmetal, 0, 0.225, 0.04, swivel);
  for (const s of [-1, 1]) m(new THREE.TorusGeometry(0.02, 0.006, 6, 12), mats.dark, s * 0.1, 0.245, 0.14, swivel);

  // Gun (recoils as one unit). One group per primary weapon; VehicleModel.setPrimary shows exactly one.
  const recoil = new THREE.Group();
  recoil.position.set(0, by, 0);
  swivel.add(recoil);
  const variants = {};
  const variant = (name) => { const g = new THREE.Group(); g.visible = name === 'cannon'; recoil.add(g); variants[name] = g; return g; };
  const flare = new THREE.MeshStandardMaterial({ color: 0x1b1d21, metalness: 0.9, roughness: 0.35 });
  const hot = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.45, 0.12).multiplyScalar(2.4), toneMapped: false });
  const tankRed = new THREE.MeshStandardMaterial({ color: 0xa8321f, metalness: 0.5, roughness: 0.45 });

  { // AUTOCANNON - the original
    const g = variant('cannon');
    m(new THREE.BoxGeometry(0.16, 0.13, 0.2), mats.dark, 0, 0, -0.34, g); // mantlet
    m(cylZ(0.052, 0.056, 0.38, 16), mats.gunmetal, 0, 0, -0.62, g); // shroud
    for (let i = 0; i < 4; i++) m(cylZ(0.059, 0.059, 0.026, 16), mats.dark, 0, 0, -0.47 - i * 0.09, g); // shroud bands
    m(cylZ(0.029, 0.031, 0.34, 12), mats.gunmetal, 0, 0, -0.95, g); // barrel
    m(cylZ(0.046, 0.046, 0.1, 12), mats.dark, 0, 0, -1.07, g); // muzzle brake
    for (const s of [-1, 1]) m(new THREE.BoxGeometry(0.012, 0.022, 0.05), mats.gunmetal, s * 0.047, 0, -1.07, g); // brake ports
    m(cylZ(0.013, 0.013, 0.42, 8), mats.dark, 0.075, 0.055, -0.54, g); // coaxial gun
  }
  { // CHAIN GUN - housing + rotating six-barrel cluster
    const g = variant('minigun');
    m(new THREE.BoxGeometry(0.17, 0.14, 0.22), mats.dark, 0, 0, -0.34, g);
    m(cylZ(0.085, 0.085, 0.3, 18), mats.gunmetal, 0, 0, -0.55, g); // motor housing
    m(cylZ(0.09, 0.09, 0.03, 18), mats.dark, 0, 0, -0.42, g);
    const spinner = new THREE.Group();
    spinner.position.z = -0.9;
    g.add(spinner);
    for (let i = 0; i < 6; i++) {
      const a2 = (i / 6) * Math.PI * 2;
      m(cylZ(0.016, 0.016, 0.64, 8), mats.gunmetal, Math.cos(a2) * 0.045, Math.sin(a2) * 0.045, 0, spinner);
    }
    m(cylZ(0.056, 0.056, 0.03, 16), mats.dark, 0, 0, -0.1, spinner);
    m(cylZ(0.056, 0.056, 0.03, 16), mats.dark, 0, 0, 0.16, spinner);
    m(cylZ(0.03, 0.03, 0.64, 8), mats.dark, 0, 0, 0, spinner);
    variants.minigunSpinner = spinner;
    for (const sx of [-1, 1]) m(new THREE.BoxGeometry(0.02, 0.08, 0.16), mats.gunmetal, sx * 0.1, 0.06, -0.3, g); // belt feed plates
  }
  { // SCATTERGUN - twin fat short barrels with a pump slide
    const g = variant('shotgun');
    m(new THREE.BoxGeometry(0.18, 0.13, 0.2), mats.dark, 0, 0, -0.34, g);
    for (const sx of [-1, 1]) {
      m(cylZ(0.052, 0.058, 0.66, 14), mats.gunmetal, sx * 0.057, 0, -0.7, g);
      m(cylZ(0.066, 0.052, 0.09, 14), flare, sx * 0.057, 0, -1.04, g); // flared muzzle
    }
    m(new THREE.BoxGeometry(0.19, 0.05, 0.3), mats.dark, 0, -0.075, -0.62, g); // pump slide
    m(new THREE.BoxGeometry(0.02, 0.07, 0.3), mats.gunmetal, 0, 0.005, -0.62, g);
  }
  { // RAIL SNIPER - long thin rail barrel, big scope
    const g = variant('sniper');
    m(new THREE.BoxGeometry(0.13, 0.11, 0.28), mats.dark, 0, 0, -0.36, g);
    m(cylZ(0.024, 0.027, 0.78, 12), mats.gunmetal, 0, 0, -0.9, g);
    for (const sx of [-1, 1]) m(new THREE.BoxGeometry(0.015, 0.04, 0.66), mats.dark, sx * 0.033, 0, -0.85, g); // rails
    for (let i = 0; i < 4; i++) m(new THREE.TorusGeometry(0.036, 0.008, 6, 12), mats.dark, 0, 0, -0.62 - i * 0.14, g);
    m(cylZ(0.04, 0.036, 0.12, 12), mats.dark, 0, 0, -1.27, g); // brake
    m(cylZ(0.046, 0.046, 0.34, 14), mats.dark, 0, 0.115, -0.32, g); // scope tube
    m(cylZ(0.056, 0.05, 0.07, 14), mats.dark, 0, 0.115, -0.51, g); // scope hood
    const sl = m(new THREE.CircleGeometry(0.038, 14), mats.lens, 0, 0.115, -0.548, g);
    sl.rotation.y = Math.PI;
    m(new THREE.BoxGeometry(0.03, 0.06, 0.03), mats.dark, 0, 0.065, -0.24, g);
    m(new THREE.BoxGeometry(0.03, 0.06, 0.03), mats.dark, 0, 0.065, -0.42, g);
    m(cylZ(0.033, 0.033, 0.05, 10), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.3, 0.8, 2.6), toneMapped: false }), 0, 0, -0.74, g);
  }
  { // BREACHER - fat short barrel, bulged muzzle, recoil pistons
    const g = variant('breacher');
    m(new THREE.BoxGeometry(0.2, 0.16, 0.24), mats.dark, 0, 0, -0.34, g);
    m(cylZ(0.088, 0.096, 0.5, 18), mats.gunmetal, 0, 0, -0.68, g);
    m(cylZ(0.115, 0.115, 0.2, 18), mats.dark, 0, 0, -1.0, g); // muzzle bulge
    m(cylZ(0.098, 0.098, 0.04, 18), flare, 0, 0, -1.11, g);
    for (let i = 0; i < 3; i++) m(cylZ(0.104, 0.104, 0.03, 18), mats.dark, 0, 0, -0.55 - i * 0.12, g);
    for (const sx of [-1, 1]) m(cylZ(0.022, 0.022, 0.4, 8), mats.dark, sx * 0.13, 0, -0.55, g);
    m(new THREE.BoxGeometry(0.14, 0.03, 0.12), mats.accent, 0, 0.1, -0.5, g); // marked breech block
  }
  { // INFERNO - nozzle + fuel tank
    const g = variant('flame');
    m(new THREE.BoxGeometry(0.15, 0.12, 0.2), mats.dark, 0, 0, -0.34, g);
    m(cylZ(0.045, 0.05, 0.62, 12), mats.gunmetal, 0, 0, -0.68, g);
    m(cylZ(0.07, 0.048, 0.2, 14), flare, 0, 0, -1.02, g); // flared nozzle
    m(cylZ(0.056, 0.056, 0.03, 14), hot, 0, 0, -1.115, g); // glowing pilot ring
    m(cylZ(0.095, 0.095, 0.46, 16), tankRed, 0, 0.16, -0.32, g); // fuel tank
    m(new THREE.SphereGeometry(0.095, 12, 8), tankRed, 0, 0.16, -0.55, g);
    m(new THREE.SphereGeometry(0.095, 12, 8), tankRed, 0, 0.16, -0.09, g);
    m(cylZ(0.016, 0.016, 0.34, 8), mats.dark, 0.05, 0.06, -0.48, g); // feed hose
  }
  const muzzle = new THREE.Group();
  muzzle.position.set(0, 0, STATION.muzzleZ - 0.02);
  recoil.add(muzzle);

  // Ammo can (left) + feed chute into the cradle
  m(new THREE.BoxGeometry(0.1, 0.16, 0.28), mats.can, -0.28, 0.1, 0.02, swivel);
  m(new THREE.BoxGeometry(0.105, 0.025, 0.26), mats.dark, -0.28, 0.185, 0.02, swivel);
  const chute = m(new THREE.BoxGeometry(0.06, 0.04, 0.14), mats.dark, -0.24, 0.17, -0.12, swivel);
  chute.rotation.y = 0.4;

  // Optics head (right): armoured box, two windows, faint lens glint
  m(new THREE.BoxGeometry(0.13, 0.12, 0.17), mats.armor, 0.3, 0.2, -0.06, swivel);
  m(new THREE.BoxGeometry(0.14, 0.02, 0.19), mats.gunmetal, 0.3, 0.27, -0.06, swivel);
  const win1 = m(new THREE.PlaneGeometry(0.075, 0.05), mats.glass, 0.3, 0.215, -0.146, swivel);
  win1.rotation.y = Math.PI;
  const win2 = m(new THREE.CircleGeometry(0.022, 16), mats.lens, 0.3, 0.165, -0.146, swivel);
  win2.rotation.y = Math.PI;
  m(new THREE.BoxGeometry(0.04, 0.1, 0.06), mats.dark, 0.24, 0.12, -0.06, swivel); // mount arm
  // short antenna base (no whip — it read as a stick)
  m(new THREE.CylinderGeometry(0.018, 0.022, 0.05, 8), mats.dark, -0.14, 0.25, 0.2, swivel);

  return { root, swivel, recoil, muzzle, variants };
}
