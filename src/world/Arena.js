import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { boostPadTexture, hazardZoneTexture, radialGlowTexture } from './textures.js';
import { Weather } from './Weather.js';

// Generic arena/map framework. A map (see world/maps/*.js) is a plain definition object whose `build(arena)` calls the
// helpers below to lay out its geometry, colliders, spawn points, pickup spots, boost pads, low-grip / damage zones,
// AI navigation waypoints, sky, lights and weather. Everything a map creates is owned by this Arena instance and is
// torn down by `dispose()`, so maps can be switched at runtime.
//
// World convention: the playfield is a square of half-size ARENA_HALF (chamfered corners) centred on the origin.

export const ARENA_HALF = 80;

const UP = new THREE.Vector3(0, 1, 0);
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();

export class Arena {
  constructor(scene, physics, renderer, def) {
    this.scene = scene;
    this.physics = physics;
    this.renderer = renderer;
    this.R = physics.R;
    this.def = def;
    this.group = new THREE.Group();
    this.group.name = 'Arena:' + def.id;
    scene.add(this.group);
    this.animated = [];
    this.time = 0;
    this.half = ARENA_HALF;
    this.colliders = [];
    this.spawns = [];
    this.pickupSpots = [];
    this.boostPads = [];
    this.hazardZones = [];
    this.waypoints = [];
    this.nav = null;
    this.weather = null;
    this.sunOffset = new THREE.Vector3(-95, 62, 62);
    this._decor = new Map();
    this.env = { exposure: 1.0, bloom: [0.22, 0.45, 1.0], headlight: 40, ...(def.env ?? {}) };
  }

  build() {
    this.def.build(this);
    this.finalizeDecor();
    this.buildNav();
  }

  // ---------------------------------------------------------------------------
  // Physics + mesh helpers
  // ---------------------------------------------------------------------------
  add(obj) {
    this.group.add(obj);
    return obj;
  }

  collider(desc, pos, quat) {
    desc.setTranslation(pos.x, pos.y, pos.z);
    if (quat) desc.setRotation({ x: quat.x, y: quat.y, z: quat.z, w: quat.w });
    // Low friction so cars glance off / scrape along geometry instead of snagging.
    desc.setFriction(0.25).setRestitution(0.08);
    const c = this.physics.world.createCollider(desc);
    this.colliders.push(c);
    return c;
  }

  /** Fixed sensor collider (no visual) — used by boost pads / hazard zones for drive-over detection. */
  sensor(desc, pos, quat) {
    desc.setTranslation(pos.x, pos.y, pos.z);
    if (quat) desc.setRotation({ x: quat.x, y: quat.y, z: quat.z, w: quat.w });
    desc.setSensor(true).setActiveEvents(this.R.ActiveEvents.COLLISION_EVENTS);
    const c = this.physics.world.createCollider(desc);
    this.colliders.push(c);
    return c;
  }

  /** Box mesh + matching cuboid collider. `pos` is the box CENTER. */
  box(size, pos, material, { rotY = 0, collider = true, cast = true, receive = true, colliderHeight = null } = {}) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(size[0], size[1], size[2]), material);
    mesh.position.set(pos[0], pos[1], pos[2]);
    mesh.rotation.y = rotY;
    mesh.castShadow = cast;
    mesh.receiveShadow = receive;
    this.group.add(mesh);
    if (collider) {
      const h = colliderHeight ?? size[1];
      const p = mesh.position.clone();
      p.y += (h - size[1]) / 2;
      this.collider(this.R.ColliderDesc.cuboid(size[0] / 2, h / 2, size[2] / 2), p, mesh.quaternion);
    }
    return mesh;
  }

  /** Collider-only cuboid (the visual is drawn separately, usually via `decor`). `pos` is the CENTER. */
  solid(size, pos, { rotY = 0 } = {}) {
    _q.setFromAxisAngle(UP, rotY);
    return this.collider(this.R.ColliderDesc.cuboid(size[0] / 2, size[1] / 2, size[2] / 2), _p.set(pos[0], pos[1], pos[2]), _q);
  }

  /** Collider-only upright cylinder; `pos` is the base CENTER. */
  solidCyl(radius, height, pos) {
    return this.collider(this.R.ColliderDesc.cylinder(height / 2, radius), _p.set(pos[0], pos[1] + height / 2, pos[2]));
  }

  /** Upright cylinder mesh + cylinder collider. `pos` is the base CENTER (y = bottom). */
  cyl(radius, height, pos, material, { collider = true, segments = 20, cast = true, radiusTop = null } = {}) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radiusTop ?? radius, radius, height, segments), material);
    mesh.position.set(pos[0], pos[1] + height / 2, pos[2]);
    mesh.castShadow = cast;
    mesh.receiveShadow = true;
    this.group.add(mesh);
    if (collider) this.collider(this.R.ColliderDesc.cylinder(height / 2, radius), mesh.position);
    return mesh;
  }

  /** Convex hull collider from a mesh's geometry (mesh must already be positioned). */
  hull(mesh) {
    mesh.updateMatrixWorld(true);
    const pos = mesh.geometry.attributes.position;
    const pts = new Float32Array(pos.count * 3);
    const s = mesh.scale;
    for (let i = 0; i < pos.count; i++) {
      pts[i * 3] = pos.getX(i) * s.x;
      pts[i * 3 + 1] = pos.getY(i) * s.y;
      pts[i * 3 + 2] = pos.getZ(i) * s.z;
    }
    return this.collider(this.R.ColliderDesc.convexHull(pts), mesh.position, mesh.quaternion);
  }

  /** Queue non-colliding (or separately-collided) geometry to be merged per material — keeps draw calls low. */
  decor(geo, material, { pos = [0, 0, 0], rot = [0, 0, 0], scale = [1, 1, 1], cast = true, order = 'XYZ' } = {}) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    _e.set(rot[0], rot[1], rot[2], order);
    _q.setFromEuler(_e);
    _m.compose(_p.set(pos[0], pos[1], pos[2]), _q, _s.set(scale[0], scale[1], scale[2]));
    g.applyMatrix4(_m);
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
    const key = material.uuid + (cast ? 'c' : 'n');
    let e = this._decor.get(key);
    if (!e) this._decor.set(key, (e = { material, cast, geos: [] }));
    e.geos.push(g);
  }

  finalizeDecor() {
    for (const { material, cast, geos } of this._decor.values()) {
      if (!geos.length) continue;
      const mesh = new THREE.Mesh(mergeGeometries(geos), material);
      mesh.castShadow = cast;
      mesh.receiveShadow = true;
      this.group.add(mesh);
      for (const g of geos) g.dispose();
    }
    this._decor.clear();
  }

  /** Ramp geometry rising from +Z (ground) to -Z (height h). Groups: 0 = slope, 1 = sides/back. */
  wedge(w, h, len) {
    const A = [-w / 2, 0, len / 2], B = [w / 2, 0, len / 2], C = [w / 2, 0, -len / 2], D = [-w / 2, 0, -len / 2];
    const E = [-w / 2, h, -len / 2], F = [w / 2, h, -len / 2];
    const pos = [], uv = [], groups = [];
    const quad = (a, b, c, d, uvs, group) => {
      const start = pos.length / 3;
      pos.push(...a, ...b, ...c, ...a, ...c, ...d);
      uv.push(...uvs[0], ...uvs[1], ...uvs[2], ...uvs[0], ...uvs[2], ...uvs[3]);
      groups.push([start, 6, group]);
    };
    const tri = (a, b, c, uvs, group) => {
      const start = pos.length / 3;
      pos.push(...a, ...b, ...c);
      uv.push(...uvs[0], ...uvs[1], ...uvs[2]);
      groups.push([start, 3, group]);
    };
    const slopeLen = Math.hypot(h, len);
    quad(A, B, F, E, [[0, 0], [1, 0], [1, slopeLen / 8], [0, slopeLen / 8]], 0);
    quad(C, D, E, F, [[0, 0], [w / 4, 0], [w / 4, h / 4], [0, h / 4]], 1);
    quad(D, C, B, A, [[0, 0], [1, 0], [1, 1], [0, 1]], 1);
    tri(A, E, D, [[0, 0], [len / 4, h / 4], [len / 4, 0]], 1);
    tri(B, C, F, [[0, 0], [len / 4, 0], [len / 4, h / 4]], 1);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    const p = g.attributes.position;
    const center = new THREE.Vector3(0, h / 3, 0);
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), nrm = new THREE.Vector3(), cen = new THREE.Vector3();
    for (let i = 0; i < p.count; i += 3) {
      a.fromBufferAttribute(p, i); b.fromBufferAttribute(p, i + 1); c.fromBufferAttribute(p, i + 2);
      nrm.subVectors(b, a).cross(c.clone().sub(a));
      cen.copy(a).add(b).add(c).divideScalar(3).sub(center);
      if (nrm.dot(cen) < 0) {
        p.setXYZ(i + 1, c.x, c.y, c.z);
        p.setXYZ(i + 2, b.x, b.y, b.z);
        const u = g.attributes.uv;
        const u1 = [u.getX(i + 1), u.getY(i + 1)];
        u.setXY(i + 1, u.getX(i + 2), u.getY(i + 2));
        u.setXY(i + 2, u1[0], u1[1]);
      }
    }
    g.computeVertexNormals();
    for (const [s, cnt, m] of groups) g.addGroup(s, cnt, m);
    return g;
  }

  /** Place a drivable ramp at (x,z) whose UPHILL direction faces `yaw` heading (vehicle convention). Adds a hull collider. */
  ramp(w, h, len, x, z, yaw, materials) {
    const mesh = new THREE.Mesh(this.wedge(w, h, len), materials);
    mesh.position.set(x, 0, z);
    mesh.rotation.y = yaw;
    mesh.castShadow = mesh.receiveShadow = true;
    this.group.add(mesh);
    this.hull(mesh);
    return mesh;
  }

  // ---------------------------------------------------------------------------
  // Level-design data
  // ---------------------------------------------------------------------------
  spawn(x, z, yaw) {
    this.spawns.push({ position: new THREE.Vector3(x, 1.2, z), yaw });
  }

  pickup(kind, x, z) {
    this.pickupSpots.push({ kind, x, z });
  }

  waypoint(x, z) {
    this.waypoints.push(new THREE.Vector3(x, 0, z));
  }

  waypointRing(r, n, phase = 0) {
    for (let i = 0; i < n; i++) {
      const a = phase + (i / n) * Math.PI * 2;
      this.waypoint(Math.sin(a) * r, Math.cos(a) * r);
    }
  }

  /** Regular lattice of nav candidates over [-extent, extent]²; any that end up inside/next to geometry are pruned in buildNav. */
  waypointGrid(step, extent, radius = 4) {
    for (let x = -extent; x <= extent + 0.01; x += step) {
      for (let z = -extent; z <= extent + 0.01; z += step) this.waypointPrune(x, z, radius);
    }
  }

  /** Waypoint that is dropped in buildNav if solid geometry stands within `radius` of it. */
  waypointPrune(x, z, radius = 3) {
    const w = new THREE.Vector3(x, 0, z);
    w.prune = radius;
    this.waypoints.push(w);
  }

  /**
   * Drive-over boost pads. specs: [{x, z, yaw}] (yaw in vehicle convention: forward = (-sin, 0, -cos)).
   * opts: { size:[w,l], material } — default is the painted chevron plate.
   */
  boostPadsAt(specs, { halfW = 2, halfL = 3, emissive = 0xffc21a, emissiveIntensity = 0.45 } = {}) {
    const bp = boostPadTexture();
    const mat = new THREE.MeshStandardMaterial({
      map: bp.map, emissiveMap: bp.emissiveMap, emissive: new THREE.Color(emissive),
      emissiveIntensity, roughness: 0.6, metalness: 0.3,
    });
    for (const { x, z, yaw } of specs) {
      const group = new THREE.Group();
      group.position.set(x, 0, z);
      group.rotation.y = yaw;
      this.group.add(group);
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(halfW * 2, halfL * 2), mat);
      plane.rotation.x = -Math.PI / 2;
      plane.position.y = 0.025;
      plane.receiveShadow = true;
      group.add(plane);
      const q = new THREE.Quaternion().setFromAxisAngle(UP, yaw);
      const collider = this.sensor(this.R.ColliderDesc.cuboid(halfW, 0.4, halfL), new THREE.Vector3(x, 0.4, z), q);
      const forward = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
      const entity = { isBoostPad: true, forward, position: new THREE.Vector3(x, 0, z) };
      this.physics.registerCollider(collider, entity);
      this.boostPads.push(entity);
    }
  }

  /**
   * Special-ground zones (sensor cylinders). style:
   *   hazard  painted stripe ring + beacon: damage + slick        (dmg 1,   traction cfg)
   *   toxic   murky green pool with markers: damage + slick        (dmg 0.8, traction .55)
   *   oil     dark glossy slick: low traction only                 (dmg 0,   traction .42)
   *   ice     frozen surface: very low traction only               (dmg 0,   traction .30)
   *   sand    loose sand: mild traction loss only                  (dmg 0,   traction .68)
   *   crevasse deep cracks: damage, mild slick                     (dmg 0.7, traction .6)
   * `visual: false` skips the mesh (map draws its own ground for the zone, e.g. a frozen lake).
   */
  zone({ x, z, r, style = 'hazard', visual = true, height = 1.4 }) {
    const S = {
      hazard: { dmg: 1, traction: null, avoid: 1 },
      toxic: { dmg: 0.8, traction: 0.55, avoid: 1 },
      oil: { dmg: 0, traction: 0.42, avoid: 0.5 },
      ice: { dmg: 0, traction: 0.3, avoid: 0.35 },
      sand: { dmg: 0, traction: 0.68, avoid: 0.2 },
      crevasse: { dmg: 0.7, traction: 0.6, avoid: 1 },
    }[style];
    const pos = new THREE.Vector3(x, 0, z);
    if (visual) this._zoneVisual(style, pos, r);
    const collider = this.sensor(this.R.ColliderDesc.cylinder(height, r), new THREE.Vector3(x, height, z));
    const entity = { isHazard: true, style, position: pos, radius: r, dmg: S.dmg, traction: S.traction, avoid: S.avoid };
    this.physics.registerCollider(collider, entity);
    this.hazardZones.push(entity);
    return entity;
  }

  _zoneVisual(style, pos, r) {
    const glow = radialGlowTexture(0.2, 1.1);
    const disc = (color, opacity, rough, metal, rad = r * 0.96, y = 0.03) => {
      const m = new THREE.Mesh(
        new THREE.CircleGeometry(rad, 48),
        new THREE.MeshStandardMaterial({ map: glow, color, transparent: true, opacity, roughness: rough, metalness: metal, depthWrite: false }),
      );
      m.rotation.x = -Math.PI / 2;
      m.position.set(pos.x, y, pos.z);
      m.receiveShadow = true;
      this.group.add(m);
      return m;
    };
    if (style === 'hazard' || style === 'toxic') {
      const hz = hazardZoneTexture(0.28, 1.8);
      const ring = new THREE.Mesh(
        new THREE.PlaneGeometry(r * 2.3, r * 2.3),
        new THREE.MeshStandardMaterial({
          map: hz, color: style === 'toxic' ? 0xc9d423 : 0xe2a01c, transparent: true, roughness: 0.7, depthWrite: false,
          polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
        }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(pos.x, 0.04, pos.z);
      ring.receiveShadow = true;
      this.group.add(ring);
      disc(style === 'toxic' ? 0x2c3a12 : 0x0d0d0d, style === 'toxic' ? 0.85 : 0.6, style === 'toxic' ? 0.1 : 0.3, 0);
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 1.6, 8), new THREE.MeshStandardMaterial({ color: 0x33363b, metalness: 0.7, roughness: 0.5 }));
      post.position.set(pos.x + r * 0.98, 0.8, pos.z);
      this.group.add(post);
      const lensMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.6, 0.1).multiplyScalar(2.5), toneMapped: false });
      const lens = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 8), lensMat);
      lens.position.set(pos.x + r * 0.98, 1.7, pos.z);
      this.group.add(lens);
      const seed = this.hazardZones.length * 1.7;
      this.animated.push((t) => {
        const on = Math.sin(t * 5 + seed) > 0.2 ? 1 : 0.12;
        lensMat.color.setRGB(2.6 * on, 1.5 * on, 0.25 * on);
      });
    } else if (style === 'oil') {
      disc(0x08090b, 0.92, 0.06, 0.6, r * 0.96, 0.028);
      disc(0x1a1d24, 0.5, 0.08, 0.7, r * 0.6, 0.032);
    } else if (style === 'sand') {
      disc(0xc79b62, 0.55, 1, 0, r * 1.0, 0.03);
    } else if (style === 'crevasse') {
      disc(0x0a1a2a, 0.75, 0.2, 0, r * 0.95, 0.03);
    }
    // 'ice': the map paints the frozen surface itself.
  }

  // ---------------------------------------------------------------------------
  // Perimeter
  // ---------------------------------------------------------------------------
  /**
   * Physical boundary: 4 straight + 4 chamfer segments around the square arena, each with a tall invisible-to-the-eye
   * collider (airborne cars can't escape). `visual(seg)` builds the map's own wall look for each segment:
   * seg = { cx, cz, len, rotY, inward:[x,z], kind:'straight'|'chamfer', index }.
   */
  perimeter(visual, { chamfer = 18, T = 2, colH = 26 } = {}) {
    const H = ARENA_HALF;
    const straightLen = (H - chamfer) * 2 + 3;
    const chamferLen = chamfer * Math.SQRT2 + 3;
    const segs = [];
    for (const [nx, nz] of [[0, -1], [0, 1], [1, 0], [-1, 0]]) {
      segs.push({ cx: nx * (H + T / 2), cz: nz * (H + T / 2), len: straightLen, rotY: nx !== 0 ? Math.PI / 2 : 0, inward: [-nx, -nz], kind: 'straight' });
    }
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const mid = H - chamfer / 2;
      const out = T / 2 / Math.SQRT2;
      segs.push({ cx: sx * (mid + out), cz: sz * (mid + out), len: chamferLen, rotY: -Math.atan2(sz, sx) + Math.PI / 2, inward: [-sx / Math.SQRT2, -sz / Math.SQRT2], kind: 'chamfer' });
    }
    segs.forEach((seg, i) => {
      seg.index = i;
      seg.T = T;
      const q = new THREE.Quaternion().setFromAxisAngle(UP, seg.rotY);
      this.collider(this.R.ColliderDesc.cuboid(seg.len / 2, colH / 2, T / 2), new THREE.Vector3(seg.cx, colH / 2, seg.cz), q);
      visual?.(seg);
    });
    return segs;
  }

  /** Flat drivable ground: visual plane + big cuboid collider. */
  ground(material, { size = ARENA_HALF * 2 + 4, y = 0 } = {}) {
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(size, size), material);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = y;
    floor.receiveShadow = true;
    this.group.add(floor);
    this.collider(this.R.ColliderDesc.cuboid(ARENA_HALF + 30, 1, ARENA_HALF + 30), new THREE.Vector3(0, -1, 0));
    return floor;
  }

  /** Painted-decal plane over the arena floor (transparent markings texture). */
  markings(map, { y = 0.006 } = {}) {
    const mat = new THREE.MeshStandardMaterial({
      map, transparent: true, roughness: 0.6, metalness: 0, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(ARENA_HALF * 2, ARENA_HALF * 2), mat);
    m.rotation.x = -Math.PI / 2;
    m.position.y = y;
    m.receiveShadow = true;
    this.group.add(m);
    return m;
  }

  /** Ground beyond the walls (visual only). */
  outerGround(material, { y = -0.02, outer = 1400 } = {}) {
    const m = new THREE.Mesh(new THREE.RingGeometry(ARENA_HALF + 1, outer, 64, 1), material);
    m.rotation.x = -Math.PI / 2;
    m.position.y = y;
    m.receiveShadow = true;
    this.group.add(m);
    return m;
  }

  // ---------------------------------------------------------------------------
  // Sky / light / atmosphere
  // ---------------------------------------------------------------------------
  /**
   * cfg: { horizon, mid, top, ground (rgb arrays 0..1), sunColor, sunGlow, sunDisc, clouds:{cover,lit,dark,speed,scale},
   *        stars(0..1), hazeColor, hazeBand }. The same shader draws the dome and the baked reflection cube.
   */
  _skyMaterial(cfg, dome) {
    const v3 = (a) => new THREE.Vector3(...a);
    const c = cfg.clouds ?? { cover: 0 };
    return new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uTime: { value: 0 },
        uSunDir: { value: this.sunOffset.clone().normalize() },
        uHorizon: { value: v3(cfg.horizon) }, uMid: { value: v3(cfg.mid) }, uTop: { value: v3(cfg.top) }, uGround: { value: v3(cfg.ground ?? cfg.horizon) },
        uSunColor: { value: v3(cfg.sunColor ?? [1, 0.85, 0.6]) }, uSunGlow: { value: cfg.sunGlow ?? 0.3 }, uSunDisc: { value: cfg.sunDisc ?? 12 },
        uCloudCover: { value: dome || cfg.cloudsInEnv ? (c.cover ?? 0) : 0 },
        uCloudLit: { value: v3(c.lit ?? [1, 0.86, 0.7]) }, uCloudDark: { value: v3(c.dark ?? [0.6, 0.62, 0.7]) },
        uCloudScale: { value: c.scale ?? 1.15 }, uCloudSpeed: { value: c.speed ?? 0.006 },
        uStars: { value: cfg.stars ?? 0 },
        uHazeColor: { value: v3(cfg.hazeColor ?? cfg.horizon) }, uHazeBand: { value: cfg.hazeBand ?? 0 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main(){
          vDir = position;
          vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_Position = ${dome ? 'p.xyww' : 'p'};
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vDir;
        uniform float uTime, uSunGlow, uSunDisc, uCloudCover, uCloudScale, uCloudSpeed, uStars, uHazeBand;
        uniform vec3 uSunDir, uHorizon, uMid, uTop, uGround, uSunColor, uCloudLit, uCloudDark, uHazeColor;
        float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
        float vnoise(vec2 p){
          vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(h21(i), h21(i + vec2(1,0)), f.x), mix(h21(i + vec2(0,1)), h21(i + vec2(1,1)), f.x), f.y);
        }
        float fbm(vec2 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++){ s += a * vnoise(p); p *= 2.03; a *= 0.5; } return s; }
        float h31(vec3 p){ p = fract(p * 0.3183099 + .1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
        void main(){
          vec3 d = normalize(vDir);
          float h = d.y;
          vec3 col = mix(uHorizon, uMid, smoothstep(0.0, 0.2, h));
          col = mix(col, uTop, smoothstep(0.18, 0.9, h));
          col = mix(col, uHazeColor, exp(-abs(h) * 22.0) * uHazeBand);
          float sd = max(dot(d, uSunDir), 0.0);
          col += uSunColor * pow(sd, 5.0) * uSunGlow;
          col += uSunColor * pow(sd, 80.0) * uSunGlow * 2.4;
          col += uSunColor * smoothstep(0.99935, 0.9998, sd) * uSunDisc;
          col = mix(col, uGround, smoothstep(0.0, -0.2, h));
          if (uStars > 0.01 && h > 0.02) {
            vec3 sp = floor(d * 380.0);
            float s = h31(sp);
            col += vec3(0.85, 0.88, 1.0) * step(0.9975, s) * smoothstep(0.08, 0.4, h) * uStars * (0.6 + 0.4 * sin(uTime * 2.0 + s * 60.0));
          }
          if (uCloudCover > 0.01 && h > 0.0) {
            vec2 uv = d.xz / (h + 0.28) * uCloudScale + vec2(uTime * uCloudSpeed, uTime * uCloudSpeed * 0.35);
            float f = fbm(uv);
            float c = smoothstep(1.0 - uCloudCover, 1.0 - uCloudCover + 0.26, f);
            float lit = pow(max(dot(normalize(vec3(d.x, 0.0, d.z)), normalize(vec3(uSunDir.x, 0.0, uSunDir.z))), 0.0), 2.0);
            vec3 cc = mix(uCloudDark, uCloudLit, 0.35 + 0.65 * lit);
            col = mix(col, cc, c * smoothstep(0.0, 0.12, h) * 0.9);
          }
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
  }

  /** Sky dome + baked reflection cube. `sunOffset` (direction to sun/moon) must be set by the map first. */
  sky(cfg) {
    const env = new THREE.Scene();
    env.add(new THREE.Mesh(new THREE.SphereGeometry(50, 48, 24), this._skyMaterial(cfg, false)));
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.envMap = pmrem.fromScene(env, 0.0).texture;
    pmrem.dispose();
    this.scene.environment = this.envMap;
    this.scene.environmentIntensity = this.env.envIntensity ?? 0.85;

    const mat = this._skyMaterial(cfg, true);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(900, 48, 24), mat);
    dome.frustumCulled = false;
    dome.renderOrder = -10;
    this.group.add(dome);
    this.skyMat = mat;
  }

  fog(color, density) {
    this.scene.fog = new THREE.FogExp2(color, density);
    this.scene.background = new THREE.Color(color);
  }

  /** Key light (shadow-casting sun/moon) + hemisphere fill. */
  lights({ sunColor = 0xffd6a6, sunIntensity = 3.3, hemiSky = 0xa9c8ff, hemiGround = 0x6a5846, hemiIntensity = 0.85 } = {}) {
    this.group.add(new THREE.HemisphereLight(hemiSky, hemiGround, hemiIntensity));
    const sun = new THREE.DirectionalLight(sunColor, sunIntensity);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -45; sc.right = 45; sc.top = 45; sc.bottom = -45;
    sc.near = 1; sc.far = 260;
    sun.shadow.bias = -0.0003;
    sun.shadow.normalBias = 0.03;
    sun.position.copy(this.sunOffset);
    this.group.add(sun, sun.target);
    this.sun = sun;
  }

  /** Keep the (tight, crisp) shadow frustum centered on the focus point, snapped to texels to avoid shimmer. */
  followShadow(focus) {
    if (!this.sun) return;
    const texel = 90 / 2048;
    const fx = Math.round(focus.x / texel) * texel;
    const fz = Math.round(focus.z / texel) * texel;
    this.sun.target.position.set(fx, 0, fz);
    this.sun.position.set(fx + this.sunOffset.x, this.sunOffset.y, fz + this.sunOffset.z);
  }

  weatherLayer(kind, opts) {
    this.weather = new Weather(this.scene, kind, opts);
  }

  // ---------------------------------------------------------------------------
  // Navigation graph (for AI routing around static geometry)
  // ---------------------------------------------------------------------------
  _clear(a, b, width = 1.25) {
    const dx = b.x - a.x, dz = b.z - a.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.5) return true;
    const dir = { x: dx / dist, y: 0, z: dz / dist };
    const px = -dir.z, pz = dir.x;
    for (const off of [0, width, -width]) {
      const o = { x: a.x + px * off, y: 0.6, z: a.z + pz * off };
      const t = this.physics.castRayStatic(o, dir, dist);
      if (t !== null && t < dist - 0.6) return false;
    }
    return true;
  }

  /** True if (x,z) is drivable ground with nothing solid within `radius` (no roof above, no wall/prop beside). */
  isOpenGround(x, z, radius = 3) {
    const down = this.physics.castRayStatic({ x, y: 40, z }, { x: 0, y: -1, z: 0 }, 60);
    if (down !== null && down < 39) return false; // something stands here (block, roof, tall prop)
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const t = this.physics.castRayStatic({ x, y: 0.8, z }, { x: Math.sin(a), y: 0, z: Math.cos(a) }, radius);
      if (t !== null) return false;
    }
    return true;
  }

  buildNav() {
    // Newly created colliders only enter the ray-query structure on a physics step — take one before casting.
    this.physics.world.step();
    this.waypoints = this.waypoints.filter((w) => !w.prune || this.isOpenGround(w.x, w.z, w.prune));
    const nodes = this.waypoints;
    const adj = nodes.map(() => []);
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const d = nodes[i].distanceTo(nodes[j]);
        if (d < 55 && this._clear(nodes[i], nodes[j])) { adj[i].push([j, d]); adj[j].push([i, d]); }
      }
    }
    this.nav = { nodes, adj };
  }

  /**
   * Next point to steer toward when the direct line from `from` to `to` is blocked. Returns a THREE.Vector3 (waypoint)
   * or null when the direct line is clear / no route exists.
   */
  navNext(from, to) {
    const nav = this.nav;
    if (!nav || !nav.nodes.length || this._clear(from, to)) return null;
    const { nodes, adj } = nav;
    const n = nodes.length;
    const dist = new Float32Array(n).fill(Infinity);
    const prev = new Int16Array(n).fill(-2); // -1 = came from source
    const done = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const d = nodes[i].distanceTo(from);
      if (d > 4 && d < 90 && this._clear(from, nodes[i])) { dist[i] = d; prev[i] = -1; }
    }
    for (;;) {
      let u = -1, best = Infinity;
      for (let i = 0; i < n; i++) if (!done[i] && dist[i] < best) { best = dist[i]; u = i; }
      if (u < 0) break;
      done[u] = 1;
      for (const [v, w] of adj[u]) if (dist[u] + w < dist[v]) { dist[v] = dist[u] + w; prev[v] = u; }
    }
    let goal = -1, goalCost = Infinity;
    for (let i = 0; i < n; i++) {
      if (!isFinite(dist[i])) continue;
      const dt = nodes[i].distanceTo(to);
      if (dt < 100 && dist[i] + dt < goalCost && this._clear(nodes[i], to)) { goalCost = dist[i] + dt; goal = i; }
    }
    if (goal < 0) {
      // No fully-connected route found: head for the reachable node closest to the target.
      let bd = Infinity;
      for (let i = 0; i < n; i++) if (isFinite(dist[i]) && nodes[i].distanceTo(to) < bd) { bd = nodes[i].distanceTo(to); goal = i; }
      if (goal < 0) return null;
    }
    let k = goal;
    while (prev[k] >= 0) k = prev[k];
    return nodes[k];
  }

  // ---------------------------------------------------------------------------
  update(dt, focus) {
    this.time += dt;
    if (this.skyMat) this.skyMat.uniforms.uTime.value = this.time;
    for (const fn of this.animated) fn(this.time);
    if (this.weather && focus) this.weather.update(dt, focus);
  }

  dispose() {
    this.weather?.dispose();
    for (const c of this.colliders) {
      this.physics.unregisterCollider(c);
      this.physics.world.removeCollider(c, true);
    }
    this.colliders.length = 0;
    this.scene.remove(this.group);
    this.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    this.envMap?.dispose();
    this.scene.environment = null;
  }
}
