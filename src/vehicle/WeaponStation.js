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

  // Gun (recoils as one unit)
  const recoil = new THREE.Group();
  recoil.position.set(0, by, 0);
  swivel.add(recoil);
  m(new THREE.BoxGeometry(0.16, 0.13, 0.2), mats.dark, 0, 0, -0.34, recoil); // mantlet
  m(cylZ(0.052, 0.056, 0.38, 16), mats.gunmetal, 0, 0, -0.62, recoil); // shroud
  for (let i = 0; i < 4; i++) m(cylZ(0.059, 0.059, 0.026, 16), mats.dark, 0, 0, -0.47 - i * 0.09, recoil); // shroud bands
  m(cylZ(0.029, 0.031, 0.34, 12), mats.gunmetal, 0, 0, -0.95, recoil); // barrel
  m(cylZ(0.046, 0.046, 0.1, 12), mats.dark, 0, 0, -1.07, recoil); // muzzle brake
  for (const s of [-1, 1]) m(new THREE.BoxGeometry(0.012, 0.022, 0.05), mats.gunmetal, s * 0.047, 0, -1.07, recoil); // brake ports
  // coaxial gun
  m(cylZ(0.013, 0.013, 0.42, 8), mats.dark, 0.075, 0.055, -0.54, recoil);
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

  return { root, swivel, recoil, muzzle };
}
