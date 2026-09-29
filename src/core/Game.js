import * as THREE from 'three';
import { Renderer } from '../render/Renderer.js';
import { ChaseCamera } from '../render/ChaseCamera.js';
import { Physics } from '../physics/Physics.js';
import { Arena } from '../world/Arena.js';
import { MAPS, MAP_KEYS, DEFAULT_MAP } from '../world/maps/index.js';
import { setMaxAnisotropy } from '../world/textures.js';
import { Vehicle } from '../vehicle/Vehicle.js';
import { VehicleModel } from '../vehicle/VehicleModel.js';
import { DEFAULT_VEHICLE } from '../vehicle/VehicleConfig.js';
import { Effects } from '../fx/Effects.js';
import { AudioEngine } from '../audio/AudioEngine.js';
import { Input } from './Input.js';
import { TuningPanel } from '../debug/TuningPanel.js';
import { Weapon } from '../combat/Weapon.js';
import { Projectiles } from '../combat/Projectiles.js';
import { AIController, AIDebugView, AI_PROFILES, buildAIProfile } from '../ai/AIController.js';
import { Nameplate } from '../ui/Nameplate.js';
import { Pickup, PICKUP_TYPES, isSecondaryKind } from '../world/Pickup.js';
import { Ordnance } from '../combat/Ordnance.js';
import { PRIMARY, BOT_LOADOUTS } from '../combat/PrimaryWeapons.js';
import { SECONDARY, SEC } from '../combat/SecondaryWeapons.js';
import { CAR_TYPES, applyCarStats } from '../vehicle/CarTypes.js';

// Fixed-timestep simulation (120 Hz) with render interpolation. Physics never depends on frame rate;
// visuals blend between the last two physics states so motion is smooth at 60/144/240 Hz alike.
export const FIXED_DT = 1 / 120;
const MAX_STEPS_PER_FRAME = 8;

// 1v1 match rules
const KILLS_TO_WIN = 5;
const COUNTDOWN_SECONDS = 3;
const RESPAWN_DELAY = 2.5;
const ENDING_SLOWMO = 0.22;   // time scale right after the match-winning kill
const ENDING_DURATION = 1.9;  // real seconds of slow-mo before the results screen
const RAM_COOLDOWN = 0.45;    // s — one crash = one ram-damage hit per entity
const STATIC_CRASH_DAMAGE = 0.5; // wall / prop impacts deal this fraction of car-vs-car ram damage

// Match states: 'menu' -> 'countdown' -> 'playing' -> 'ending' (slow-mo) -> 'over' (results) -> countdown | menu
const IDLE_CONTROLS = { throttle: 0, brake: 0, steer: 0, handbrake: false, lookBack: false, fire: false, fire2: false, boost: false };

// Free-for-all roster: 1 player + 3 AI, each a fixed identity (name/number/car/livery) independent of difficulty —
// the difficulty picker scales all 3 bots' numeric tuning at once (see buildAIProfile), while the archetype here
// picks each bot's fighting style. `accent` doubles as the bot's UI color (scoreboard, nameplate, threat arrow).
const AI_ROSTER = [
  { archetype: 'balanced', driver: 'RIPPER', number: '13', car: 'muscle', paint: '#9c1a22', accent: '#ff5a5f' },
  { archetype: 'aggressive', driver: 'MAUL', number: '66', car: 'suv', paint: '#1f6b46', accent: '#41d98a' },
  { archetype: 'defensive', driver: 'GHOST', number: '42', car: 'hatch', paint: '#4d3494', accent: '#b795ff' },
];
const PLAYER_COLOR = '#6fc3ff';

const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _p = new THREE.Vector3();
const _camFwd = new THREE.Vector3();
const _ndc = new THREE.Vector3();
const UP_VEC = new THREE.Vector3(0, 1, 0);

export class Game {
  constructor(RAPIER, container, hud) {
    this.RAPIER = RAPIER;
    this.container = container;
    this.hud = hud;
    this.state = 'menu';
    this.time = 0;
    this.accumulator = 0;
    this.lastTime = 0;
    this.fpsSmooth = 60;
    this.frameMsSmooth = 16;
    this.impactCooldown = 0;
    this.soundCooldown = 0;
    this.remoteSoundCooldown = 0;
    this.timeScale = 1;
    this.difficulty = 'normal';
    this.aiPaused = false;
  }

  async init(progress) {
    this.renderer = new Renderer(this.container);
    setMaxAnisotropy(Math.min(8, this.renderer.renderer.capabilities.getMaxAnisotropy()));
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(66, window.innerWidth / window.innerHeight, 0.1, 2000);
    this.physics = new Physics(this.RAPIER, FIXED_DT, -16);

    await progress(0.35, 'GENERATING ARENA');
    this.mapId = DEFAULT_MAP;
    this.loadMap(this.mapId);

    await progress(0.7, 'ASSEMBLING VEHICLES');
    const spawns = this.arena.spawns;
    this.playerCar = 'coupe';
    const player = new Vehicle(this.physics, DEFAULT_VEHICLE, spawns[0]);
    applyCarStats(player, DEFAULT_VEHICLE, this.playerCar);
    const playerModel = new VehicleModel(player.cfg, { type: this.playerCar, accent: PLAYER_COLOR, number: '07' });
    this.scene.add(playerModel.root);
    this.player = player; // alias used by the tuning panel / debug

    this.fx = new Effects(this.scene, this.physics);
    this.fx.onPop = (pos, strength) => this.audio.pop(strength * (0.35 + 0.65 * this._attenuation(pos)));
    this.chase = new ChaseCamera(this.camera, this.physics);
    this.audio = new AudioEngine();
    this.input = new Input();
    this.renderer.setupPost(this.scene, this.camera);
    this.projectiles = new Projectiles(this.scene);
    this._applyEnv();

    const mk = (v, model, isPlayer, name, key) => ({
      v, model, isPlayer, name, key, score: 0, respawnTimer: 0, smokeAcc: [0, 0, 0, 0], dmgSmokeAcc: 0,
      boostPadCooldown: 0, inHazard: false, hazardFxAcc: 0, boostSmokeAcc: 0, target: null, targetTimer: 0,
      secondary: null, secondaryCooldown: 0, sparkAcc: 0, zones: new Set(), burn: 0, burnAcc: 0, burnSource: null, flameAcc: 0,
    });
    this.p = mk(player, playerModel, true, 'YOU', 'p');

    const mkBot = (roster, i) => {
      const v = new Vehicle(this.physics, DEFAULT_VEHICLE, spawns[i + 1]);
      applyCarStats(v, DEFAULT_VEHICLE, roster.car);
      const model = new VehicleModel(v.cfg, { type: roster.car, paint: roster.paint, accent: roster.accent, number: roster.number, headlights: false });
      this.scene.add(model.root);
      const c = mk(v, model, false, roster.driver, 'b' + i);
      c.roster = roster;
      c.ai = new AIController(v, this.physics, buildAIProfile(this.difficulty, roster.archetype), {
        getPickups: () => this.pickups,
        getHazards: () => this.arena.hazardZones,
        getNav: () => this.arena,
      });
      c.nameplate = new Nameplate(this.scene, roster.driver, roster.accent);
      c.debug = new AIDebugView(this.scene);
      return c;
    };
    this.combatants = [this.p, ...AI_ROSTER.map(mkBot)];
    this.bots = this.combatants.filter((c) => !c.isPlayer);
    this._byVehicle = new Map(this.combatants.map((c) => [c.v, c]));
    for (const c of this.combatants) {
      c.weapon = new Weapon(c.v, this.projectiles, {
        onFire: (pos, dir, kind) => this._onWeaponFire(c, pos, dir, kind),
        onBeam: (pos, dir, def, damage) => this._firePrimaryBeam(c, pos, dir, def, damage),
        getTargets: () => this._aliveOthers(c).map((o) => o.v),
        aimAssist: c.isPlayer ? 0.045 : 0,
      });
      c.v.health.onDamage = (amount, point, normal, source, cause) => this._onDamage(c, amount, source, cause);
      c.v.health.onDeath = (point, normal, source, cause) => this._onDeath(c, source, cause);
    }
    for (const c of this.combatants) this.setPrimary(c, 'cannon');
    this.ordnance = new Ordnance(this.scene, this.physics, this.fx, {
      getVehicles: () => this.combatants.map((c) => c.v),
      onDetonate: (ev) => this._onDetonate(ev),
      onLaserHit: (point, normal, entity, owner, damage, cause, width) => this._onLaserHit(point, normal, entity, owner, damage, cause, width),
      onMineArm: (mine) => {
        const owner = this._byVehicle.get(mine.owner);
        this.audio.mineArm(owner?.isPlayer ? 1 : this._attenuation(mine.pos));
      },
    });
    this.paused = false;
    this._blur = 0;
    this._danger = 0;
    this._resetStats();

    this.hud.onSfx = (name) => this._sfx(name);
    this.hud.onPauseAction = (action) => (action === 'resume' ? this._setPaused(false) : this._quitToMenu());
    this.hud.setCarChoices(this.playerCar, (key) => this.selectPlayerCar(key));
    this.hud.setMapChoices(this.mapId, (id) => this.selectMap(id));
    this.hud.setWeaponChoices(this.p.primary ?? 'cannon', (key) => this.selectPlayerWeapon(key));
    this.projectiles.trail = (p, dt) => this._projectileTrail(p, dt);

    this.tuning = new TuningPanel(this);
    this.physics.onImpact((ev) => this._onImpact(ev));
    this.physics.onCollision((e1, e2, c1, c2, started) => this._onCollision(e1, e2, started));
    window.addEventListener('resize', () => this.renderer.resize());

    await progress(0.85, 'COMPILING SHADERS');
    this._menuCamera(0);
    this.renderer.renderer.compile(this.scene, this.camera);
    // Warm up so both cars settle on their suspension before first paint.
    for (let i = 0; i < 90; i++) this._fixedStep(IDLE_CONTROLS);

    if (import.meta.env.DEV) window.wf = this;
  }

  run() {
    this.lastTime = performance.now();
    this.renderer.renderer.setAnimationLoop((t) => this._frame(t));
  }

  /**
   * (Re)build the world for a map: tears down the previous arena + pickups (colliders, meshes, weather), builds the new
   * one, applies its post/exposure settings, then re-seats every combatant on the new spawn pads.
   */
  loadMap(id) {
    const def = MAPS[id] ?? MAPS[DEFAULT_MAP];
    this.arena?.dispose();
    this.pickups?.forEach((p) => p.dispose());
    this.arena = new Arena(this.scene, this.physics, this.renderer.renderer, def);
    this.arena.build();
    this.mapId = def.id;
    this.pickups = this.arena.pickupSpots.map(({ kind, x, z }, i) => new Pickup(this.physics, this.scene, new THREE.Vector3(x, 0, z), kind, i));
    this._applyEnv();
    if (this.combatants) {
      this.projectiles.clear();
      this.ordnance.clear();
      this._placeAtStart();
    }
  }

  /** Per-map exposure / bloom / headlight strength. Safe to call before the post chain exists. */
  _applyEnv() {
    const env = this.arena.env;
    this.renderer.renderer.toneMappingExposure = env.exposure;
    if (this.renderer.bloom) {
      this.renderer.bloom.strength = env.bloom[0];
      this.renderer.bloom.radius = env.bloom[1];
      this.renderer.bloom.threshold = env.bloom[2];
    }
    const hl = this.p?.model.headlight;
    if (hl) hl.intensity = env.headlight;
  }

  /**
   * Menu: switch the selected map (synchronous rebuild — the HUD shows a brief loading veil around it). Rapid
   * re-selection collapses into one load of the latest choice.
   */
  selectMap(id) {
    if (!MAPS[id]) return;
    this._wantMap = id;
    if (this._mapLoading) return;
    if (id === this.mapId) return;
    this._mapLoading = true;
    this.hud.showMapLoading(true);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const want = this._wantMap;
      if (want !== this.mapId) this.loadMap(want);
      this._mapLoading = false;
      if (this._wantMap !== this.mapId) this.selectMap(this._wantMap);
      else this.hud.showMapLoading(false);
    }));
  }

  _zoneDamages(c) {
    for (const z of c.zones) if (z.dmg > 0) return true;
    return false;
  }

  _others(c) {
    return this.combatants.filter((o) => o !== c);
  }

  _aliveOthers(c) {
    return this.combatants.filter((o) => o !== c && !o.v.health.dead);
  }

  _resetStats() {
    this.stats = { shots: 0, hits: 0, damageDealt: 0, damageTaken: 0, time: 0 };
  }

  // ---------------------------------------------------------------------------
  // Match flow
  // ---------------------------------------------------------------------------
  toMenu() {
    this.state = 'menu';
    this.timeScale = 1;
    this.hud.hide();
    this.hud.countdown(null);
    this.hud.hidePause();
    this.paused = false;
    this.projectiles.clear();
    this.ordnance.clear();
    this._placeAtStart();
    this.audio.resume();
    this.audio.update({ rpm: DEFAULT_VEHICLE.idleRpm, maxRpm: DEFAULT_VEHICLE.maxRpm, throttle: 0, skid: 0, speed: 0, grounded: true });
    this.audio.updateRemotes([]);
    this.hud.showStart((difficulty) => this.startMatch(difficulty));
  }

  /** Menu car picker: swap the player's body type (visual model + stat spread) while parked on the title screen. */
  selectPlayerCar(key) {
    if (!CAR_TYPES[key] || key === this.playerCar) return;
    this.playerCar = key;
    const c = this.p;
    applyCarStats(c.v, DEFAULT_VEHICLE, key);
    this.scene.remove(c.model.root);
    c.model.dispose();
    c.model = new VehicleModel(c.v.cfg, { type: key, accent: PLAYER_COLOR, number: '07' });
    this.scene.add(c.model.root);
    c.model.setPrimary(c.primary ?? 'cannon');
  }

  /** Equip a primary weapon: gun logic, roof-station model and (for bots) the AI's engagement profile. */
  setPrimary(c, key) {
    c.primary = PRIMARY[key] ? key : 'cannon';
    c.weapon.setType(c.primary);
    c.model.setPrimary(c.primary);
    if (!c.isPlayer) c.ai.setProfile(buildAIProfile(this.difficulty, c.roster.archetype, c.primary));
    else this.hud.setPrimaryBadge(c.primary);
  }

  /** Menu weapon picker. */
  selectPlayerWeapon(key) {
    if (!PRIMARY[key]) return;
    this.setPrimary(this.p, key);
  }

  _sfx(name) {
    this.audio.start();
    this.audio.ui(name);
  }

  _setPaused(on) {
    if (on === this.paused) return;
    if (on && this.state !== 'playing' && this.state !== 'countdown') return;
    this.paused = on;
    if (on) {
      this.audio.ui('pause');
      this.audio.pause();
      this.hud.showPause();
    } else {
      this.audio.resume();
      this.audio.ui('confirm');
      this.hud.hidePause();
    }
  }

  _quitToMenu() {
    this.paused = false;
    this.hud.hidePause();
    this.toMenu();
  }

  startMatch(difficulty = this.difficulty) {
    this.difficulty = difficulty;
    for (const c of this.bots) {
      // each bot rolls a primary weapon that suits its fighting style (fresh every match)
      const pool = BOT_LOADOUTS[c.roster.archetype] ?? BOT_LOADOUTS.balanced;
      this.setPrimary(c, pool[Math.floor(Math.random() * pool.length)]);
      c.ai.setProfile(buildAIProfile(difficulty, c.roster.archetype, c.primary));
      c.ai.reset();
      c.target = null;
      c.targetTimer = 0;
    }

    for (const c of this.combatants) c.score = 0;
    this._resetStats();
    this.projectiles.clear();
    this.ordnance.clear();
    this._placeAtStart();
    for (const pk of this.pickups) {
      pk.available = true;
      pk.respawnTimer = 0;
      pk._setVisible(true);
      pk.materializeT = undefined;
    }

    this.state = 'countdown';
    this.countdownTimer = COUNTDOWN_SECONDS;
    this.countdownShown = COUNTDOWN_SECONDS;
    this.timeScale = 1;
    this.audio.start();
    this.audio.whoosh();
    this.audio.countdown(false);
    this.hud.setupMatch(this._rosterInfo(), KILLS_TO_WIN);
    this.hud.show();
    this.hud.countdown(String(COUNTDOWN_SECONDS));
    this.chase.snap(this._target(1));
    this.renderer.flash = 0.6;
  }

  /** [{key,name,color,isPlayer,score}] — the whole roster, for the scoreboard/results screen. */
  _rosterInfo() {
    return this.combatants.map((c) => ({
      key: c.key, name: c.name, isPlayer: c.isPlayer,
      color: c.isPlayer ? PLAYER_COLOR : c.roster.accent, score: c.score,
    }));
  }

  _placeAtStart() {
    const pads = this.arena.spawns;
    this.hud.hideWrecked();
    this.fx?.reset();
    const place = (c, pad) => {
      c.model.setWrecked(false);
      c.v.teleport(pad.position, pad.yaw);
      c.v.recoverCooldown = 0;
      c.v.health.reset(0);
      c.respawnTimer = 0;
      c.model.root.visible = true;
      this._resetBoostState(c);
    };
    this.combatants.forEach((c, i) => place(c, pads[i]));
  }

  /** Full boost/hazard/overcharge reset for a combatant — match start and every respawn. */
  _resetBoostState(c) {
    c.v.boostMeter = c.v.cfg.boostMax;
    c.v.overcharge = 0;
    c.v.hazardTraction = 1;
    c.v.boosting = false;
    c.inHazard = false;
    c.zones.clear();
    c.burn = 0;
    c.burnSource = null;
    c.boostPadCooldown = 0;
    c.hazardFxAcc = 0;
    c.boostSmokeAcc = 0;
    c.secondary = null;
    c.secondaryCooldown = 0;
    c.sparkAcc = 0;
  }

  _endMatch(winner) {
    this.state = 'ending';
    this.endingTimer = ENDING_DURATION;
    this.timeScale = ENDING_SLOWMO;
    this.matchWon = winner.isPlayer;
    this.matchWinnerName = winner.name;
  }

  _showResults() {
    this.state = 'over';
    this.timeScale = 1;
    this.hud.hide();
    this.audio.updateRemotes([]);
    this.audio.stinger(this.matchWon);
    const s = this.stats;
    const t = Math.floor(s.time);
    const acc = s.shots > 0 ? Math.round((s.hits / s.shots) * 100) : 0;
    const roster = this._rosterInfo().sort((a, b) => b.score - a.score);
    this.hud.showResults(
      {
        win: this.matchWon,
        winnerName: this.matchWinnerName,
        roster,
        difficulty: AI_PROFILES[this.difficulty].label,
        stats: [
          ['MATCH TIME', `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`],
          ['SHOTS FIRED', s.shots],
          ['ACCURACY', `${acc}%`],
          ['DAMAGE DEALT', Math.round(s.damageDealt)],
          ['DAMAGE TAKEN', Math.round(s.damageTaken)],
        ],
      },
      (action) => (action === 'rematch' ? this.startMatch(this.difficulty) : this.toMenu()),
    );
  }

  _respawn(c) {
    const others = this._aliveOthers(c);
    // Farthest pad from the nearest surviving opponent (maximize the minimum distance to everyone alive).
    let best = this.arena.spawns[0];
    let bestD = -1;
    for (const pad of this.arena.spawns) {
      const d = others.length ? Math.min(...others.map((o) => pad.position.distanceTo(o.v.currPos))) : 0;
      if (d > bestD) { bestD = d; best = pad; }
    }
    c.model.setWrecked(false);
    if (c.isPlayer) this.hud.hideWrecked();
    c.v.teleport(best.position, best.yaw);
    c.v.recoverCooldown = 0;
    c.v.health.reset(1.5);
    this._resetBoostState(c);
    if (!c.isPlayer) c.ai.reset();
    this._spawnFx(c, c.v.currPos);
    if (c.isPlayer) {
      this.chase.snap(this._target(1));
      this.renderer.flash = Math.max(this.renderer.flash, 0.4);
    }
  }

  /** (Re)spawn / recover: a ring of kicked-up dust plus a soft white flash — no neon burst. */
  _spawnFx(c, pos) {
    this.fx.flashes.spawn(pos, '#fff4e0', 5, 0.22);
    for (let k = 0; k < 22; k++) {
      const a = (k / 22) * Math.PI * 2;
      _v.set(Math.cos(a) * (3 + Math.random() * 2.5), 0.5 + Math.random() * 0.8, Math.sin(a) * (3 + Math.random() * 2.5));
      _p.copy(pos);
      _p.y -= 0.4;
      this.fx.smoke.emit(_p, _v, { color: [0.6, 0.55, 0.5], size: 0.9, grow: 3.4, life: 1.1 + Math.random() * 0.6, alpha: 0.28 });
    }
    const vol = c.isPlayer ? 1 : this._attenuation(pos);
    if (vol > 0.1) this.audio.whoosh();
  }

  /** 0..1 loudness for a sound at `pos`, relative to the player (the listener). */
  _attenuation(pos) {
    return Math.pow(Math.max(0, 1 - this.p.v.currPos.distanceTo(pos) / 75), 1.4);
  }

  // ---------------------------------------------------------------------------
  // Frame loop
  // ---------------------------------------------------------------------------
  _frame(now) {
    let realDt = (now - this.lastTime) / 1000;
    this.lastTime = now;
    if (realDt > 0.25) realDt = 0.25; // tab was hidden; don't spiral
    this.fpsSmooth += (1 / Math.max(realDt, 1e-4) - this.fpsSmooth) * 0.05;
    this.frameMsSmooth += (realDt * 1000 - this.frameMsSmooth) * 0.05;

    if (this.state !== 'ending') this.timeScale += (1 - this.timeScale) * Math.min(1, realDt * 2);
    const dt = realDt * this.timeScale;
    this.time += dt;

    this.input.poll();
    this._handleActions();
    if (this.paused) {
      // Frozen world: keep drawing the last frame under the pause overlay, but advance nothing.
      this.renderer.render(realDt, this.time, 0);
      this.input.endFrame();
      return;
    }
    this._updateMatchTimers(realDt, dt);

    const playing = this.state === 'playing';
    const controls = playing ? this.input.getControls() : IDLE_CONTROLS;

    // --- Fixed-step physics ---
    this.accumulator += dt;
    let steps = 0;
    while (this.accumulator >= FIXED_DT && steps < MAX_STEPS_PER_FRAME) {
      this._fixedStep(controls);
      this.accumulator -= FIXED_DT;
      steps++;
    }
    if (steps === MAX_STEPS_PER_FRAME) this.accumulator = 0;
    const alpha = this.accumulator / FIXED_DT;

    // --- Visual sync ---
    for (const c of this.combatants) {
      c.v.getInterpolated(alpha, _pos, _quat);
      c.model.update(_pos, _quat, c.v, dt);
      // Post-respawn invulnerability: flicker the car.
      const h = c.v.health;
      c.model.root.visible = !(h.invuln > 0 && !h.dead) || Math.floor(this.time * 14) % 2 === 0;
      c.model.setDamage(h.dead ? 0 : h.pct, this.time);
      c.model.setLoadout(c.secondary && c.secondary.ammo > 0 ? c.secondary.type : null);
      c.model.spinRate = c.primary === 'minigun' ? c.weapon.spin : 0;
      if (!c.isPlayer) {
        c.nameplate.update(realDt, _pos, this.camera, h, this.state !== 'menu');
        c.debug.update(c.ai);
      }
    }
    this.arena.update(dt, this.p.v.currPos);
    for (const pk of this.pickups) pk.update(dt);
    this.projectiles.syncVisual(alpha);
    this.ordnance.syncVisual(alpha, dt, this.time);

    let speedT = 0;
    const inMatch = this.state === 'countdown' || this.state === 'playing' || this.state === 'ending';
    const playerDown = inMatch && this.p.v.health.dead && this.p.respawnTimer > 0;
    if (inMatch) {
      const target = this._target(alpha, controls.lookBack);
      if (playerDown) {
        const k = this.p.killer;
        speedT = this.chase.deathCam(realDt, target.position, k && !k.v.health.dead ? k.v.currPos : null);
      } else {
        speedT = this.chase.update(realDt, target);
      }
      this.arena.followShadow(_pos);
      for (const c of this.combatants) this._combatantFx(c, dt);
      this.hud.update(this.p.v, dt, this.p.secondary);
      this.hud.setPrimaryFrac(this.p.weapon.hudFrac);
      this.chase.fovScale = playerDown ? 1 : (PRIMARY[this.p.primary]?.zoom ?? 1);
      this.hud.setScore(this.combatants.map((c) => ({ key: c.key, score: c.score })));
      this.hud.setMatchTime(this.stats.time);
      this._updateThreatIndicators(alpha);
      this.audio.update({
        rpm: this.p.v.rpm,
        maxRpm: this.p.v.cfg.maxRpm,
        throttle: Math.abs(this.p.v.drive),
        skid: this.p.v.skidAmount * 1.6,
        speed: this.p.v.speed,
        grounded: this.p.v.groundedCount > 0,
        boost: this.p.v.boosting,
        hazard: this.p.inHazard && this._zoneDamages(this.p),
      });
      this.audio.updateRemotes(this.bots.map((b) => ({
        rpmN: Math.min(1, b.v.rpm / b.v.cfg.maxRpm),
        throttle: Math.abs(b.v.drive),
        vol: b.v.health.dead ? 0 : this._attenuation(b.v.currPos),
      })));
      // Post look: speed/boost radial blur, and a desaturating red-edge warning when the player's hull is critical.
      const pv = this.p.v;
      const blurT = Math.min(1, Math.max(0, (pv.speed - 24) / 40)) * 0.55 + (pv.boosting ? 0.45 : 0);
      this._blur += (blurT - this._blur) * Math.min(1, realDt * 4);
      const dangerT = pv.health.dead ? 0 : Math.max(0, (0.32 - pv.health.pct) / 0.32);
      this._danger += (dangerT - this._danger) * Math.min(1, realDt * 3);
    } else if (this.state === 'over') {
      this._resultsCamera();
      this.arena.followShadow(this.p.v.currPos);
      for (const c of this.combatants) this._combatantFx(c, dt);
    } else {
      this._menuCamera(realDt);
      this.arena.followShadow(this.p.v.currPos);
    }

    if (!inMatch) {
      this._blur *= Math.max(0, 1 - realDt * 4);
      this._danger *= Math.max(0, 1 - realDt * 3);
    }
    this._dead = (this._dead ?? 0) + ((playerDown ? 1 : 0) - (this._dead ?? 0)) * Math.min(1, realDt * (playerDown ? 2.2 : 5));
    this.renderer.look.blur = this._blur;
    this.renderer.look.danger = this._danger;
    this.renderer.look.dead = this._dead;
    this.fx.update(dt, this.camera, this.renderer.renderer);
    this.renderer.render(realDt, this.time, speedT);

    this._adaptResolution(realDt);

    // Perf stats for the tuning panel
    const s = this.tuning.stats;
    s.fps = Math.round(this.fpsSmooth);
    s.frameMs = +this.frameMsSmooth.toFixed(2);
    s.speedKmh = Math.round(Math.abs(this.p.v.fwdSpeed) * 3.6);
    s.grounded = this.p.v.groundedCount;
    this.bots.forEach((b, i) => {
      const bs = this.tuning.botStats?.[i];
      if (bs) { bs.mode = b.ai.mode; bs.hp = Math.round(b.v.health.pct * 100); }
    });

    this.input.endFrame();
  }

  /**
   * Dynamic resolution: if frames are consistently slow during a match, render at a lower pixel ratio (down to 60%);
   * step back up when there's clear headroom. Measured over 2.5 s windows, ignoring hitches and hidden tabs.
   */
  _adaptResolution(realDt) {
    const r = this.renderer;
    if (this.state !== 'playing' || this.paused || document.hidden || realDt > 0.1) return;
    const a = (this._res ??= { t: 0, n: 0, sum: 0, scale: 1 });
    a.t += realDt; a.n++; a.sum += realDt;
    if (a.t < 2.5) return;
    const ms = (a.sum / a.n) * 1000;
    a.t = a.n = a.sum = 0;
    let next = a.scale;
    if (ms > 21) next = Math.max(0.6, a.scale - 0.15);
    else if (ms < 13.5 && a.scale < 1) next = Math.min(1, a.scale + 0.1);
    if (next !== a.scale) {
      a.scale = next;
      r.setResolutionScale(next);
    }
  }

  _updateMatchTimers(realDt, dt) {
    if (this.state === 'countdown') {
      this.countdownTimer -= realDt;
      const shown = Math.ceil(this.countdownTimer);
      if (this.countdownTimer <= 0) {
        this.state = 'playing';
        this.hud.countdown('WRECK!');
        this.audio.countdown(true);
      } else if (shown !== this.countdownShown) {
        this.countdownShown = shown;
        this.hud.countdown(String(shown));
        this.audio.countdown(false);
      }
    } else if (this.state === 'playing') {
      this.stats.time += dt;
    } else if (this.state === 'ending') {
      this.endingTimer -= realDt;
      if (this.endingTimer <= 0) this._showResults();
    }
  }

  _fixedStep(playerControls) {
    const active = this.state === 'playing';
    if (active) this._selectTargets();
    for (const c of this.combatants) {
      let ctl;
      // Wrecked, counting down, or out of a live match: no input (the vehicle's parking hold keeps it still).
      if (c.respawnTimer > 0 || c.v.health.dead || !active) ctl = IDLE_CONTROLS;
      else if (c.isPlayer) ctl = playerControls;
      else if (this.aiPaused) ctl = IDLE_CONTROLS;
      else {
        c.ai.secondaryType = c.secondary && c.secondary.ammo > 0 ? c.secondary.type : null;
        ctl = c.ai.update(FIXED_DT, c.target ? c.target.v : null);
      }
      c.controls = ctl;
      c.v.fixedUpdate(FIXED_DT, ctl);
    }
    this.physics.step();
    for (const c of this.combatants) {
      c.v.afterStep();
      // Safety net: fell out of the world
      if (c.v.currPos.y < -20) {
        c.v.recoverCooldown = 0;
        c.v.recover(true);
      }
    }
    this.impactCooldown = Math.max(0, this.impactCooldown - FIXED_DT);
    this.soundCooldown = Math.max(0, this.soundCooldown - FIXED_DT);
    this.remoteSoundCooldown = Math.max(0, this.remoteSoundCooldown - FIXED_DT);

    // --- Hazards & boost pads ---
    for (const c of this.combatants) {
      c.boostPadCooldown = Math.max(0, c.boostPadCooldown - FIXED_DT);
      // Special-ground zones: worst traction and highest damage among the zones the car currently overlaps.
      const inHazardNow = active && c.inHazard && !c.v.health.dead && c.respawnTimer <= 0;
      let traction = 1, dmg = 0;
      if (inHazardNow) {
        for (const z of c.zones) {
          traction = Math.min(traction, z.traction ?? c.v.cfg.hazardTractionMult);
          dmg = Math.max(dmg, z.dmg);
        }
      }
      c.v.hazardTraction = traction;
      if (c.burn > 0) {
        c.burn -= FIXED_DT;
        if (active && !c.v.health.dead) c.v.health.takeDamage(PRIMARY.flame.burnDps * FIXED_DT, c.v.currPos, UP_VEC, c.burnSource, this.time, 'flame');
        if (c.v.health.dead) c.burn = 0;
      }
      if (dmg > 0) {
        c.v.health.takeDamage(c.v.cfg.hazardDamagePerSecond * dmg * FIXED_DT, c.v.currPos, { x: 0, y: 1, z: 0 }, null, this.time, 'hazard');
      }
    }

    // --- Combat ---
    for (const c of this.combatants) {
      c.v.health.update(FIXED_DT);
      const alive = !c.v.health.dead && c.respawnTimer <= 0;
      const canFire = active && c.controls.fire && alive;
      c.weapon.update(FIXED_DT, canFire);
      c.secondaryCooldown = Math.max(0, c.secondaryCooldown - FIXED_DT);
      if (active && alive && c.controls.fire2 && c.secondary && c.secondary.ammo > 0 && c.secondaryCooldown <= 0) {
        this._fireSecondary(c);
      }
    }
    this.projectiles.update(FIXED_DT, this.physics, (point, normal, entity, projectile) =>
      this._onProjectileHit(point, normal, entity, projectile),
    );
    this.ordnance.update(FIXED_DT);
    for (const c of this.combatants) {
      if (c.respawnTimer > 0) {
        c.respawnTimer -= FIXED_DT;
        if (c.respawnTimer <= 0 && this.state === 'playing') this._respawn(c);
      }
    }
  }

  /**
   * Pre-step target selection for every AI bot: pick the nearest alive combatant (player or another bot — a true
   * free-for-all, not just "gang up on the player"). Re-evaluated every ~0.6s (or immediately if the current
   * target died), with hysteresis so a bot doesn't flicker between two similarly-close targets every reselect.
   */
  _selectTargets() {
    for (const c of this.bots) {
      c.targetTimer -= FIXED_DT;
      const prev = c.target;
      const prevAlive = prev && !prev.v.health.dead;
      if (c.targetTimer > 0 && prevAlive) continue;
      c.targetTimer = 0.6 * (0.85 + Math.random() * 0.3);
      const others = this._aliveOthers(c);
      if (!others.length) { c.target = null; continue; }
      let best = others[0];
      let bestD = c.v.currPos.distanceTo(best.v.currPos);
      for (let i = 1; i < others.length; i++) {
        const d = c.v.currPos.distanceTo(others[i].v.currPos);
        if (d < bestD) { bestD = d; best = others[i]; }
      }
      if (prevAlive && best !== prev) {
        const prevD = c.v.currPos.distanceTo(prev.v.currPos);
        if (bestD > prevD * 0.8) best = prev; // not meaningfully closer — stick with the current target
      }
      c.target = best;
    }
  }

  _handleActions() {
    const i = this.input;
    if (i.wasPressed('Backquote')) this.tuning.toggle();
    if (this.state === 'menu') {
      if (i.wasPressed('ArrowLeft') || i.wasPressed('KeyA')) this.hud.stepCar(-1);
      if (i.wasPressed('ArrowRight') || i.wasPressed('KeyD')) this.hud.stepCar(1);
      if (i.wasPressed('ArrowUp') || i.wasPressed('KeyW')) this.hud.stepDifficulty(-1);
      if (i.wasPressed('ArrowDown') || i.wasPressed('KeyS')) this.hud.stepDifficulty(1);
      if (i.wasPressed('KeyZ')) this.hud.stepWeapon(-1);
      if (i.wasPressed('KeyX')) this.hud.stepWeapon(1);
      if (i.wasPressed('KeyQ') || i.wasPressed('BracketLeft')) this.hud.stepMap(-1);
      if (i.wasPressed('KeyE') || i.wasPressed('BracketRight')) this.hud.stepMap(1);
      if (i.wasPressed('Enter') || i.wasPressed('NumpadEnter')) this.hud.pressStart();
      return;
    }
    if (this.state === 'over') {
      if (i.wasPressed('Enter') || i.wasPressed('NumpadEnter')) this.hud.resultsAction('rematch');
      if (i.wasPressed('Escape')) this.hud.resultsAction('menu');
      return;
    }
    if (this.paused) {
      if (i.wasPressed('Escape') || i.wasPressed('Enter') || i.wasPressed('NumpadEnter')) this._setPaused(false);
      else if (i.wasPressed('KeyQ')) this._quitToMenu();
      return;
    }
    // Gamepad B doubles as handbrake AND maps to 'Escape', so only the keyboard Esc pauses; pad users use Start.
    const pauseKey = (i.wasPressed('Escape') && !i.usingPad) || i.wasPressed('KeyP') || i.wasPressed('Enter') || i.wasPressed('NumpadEnter');
    if ((this.state === 'playing' || this.state === 'countdown') && pauseKey) {
      this._setPaused(true);
      return;
    }
    if (this.state === 'playing' && i.wasPressed('KeyR') && !this.p.v.health.dead) this.p.v.recover();
    if (i.wasPressed('KeyH')) this.hud.toggleHelp();
    if (i.wasPressed('KeyM')) this.audio.setVolume(this.audio.volume > 0 ? 0 : 0.7);
  }

  _target(alpha, lookBack = false) {
    this.p.v.getInterpolated(alpha, _pos, _quat);
    return {
      position: _pos,
      quaternion: _quat,
      velocity: this.p.v.velocity,
      fwdSpeed: this.p.v.fwdSpeed,
      lookBack,
    };
  }

  /** Title screen "showroom": slow turntable orbit around the selected car, framed to the right of the menu panel. */
  _menuCamera() {
    const p = this.p.v.currPos;
    const t = this.time * 0.2 + 2.2;
    let r = 8.8;
    // Never orbit through a wall / prop: pull the camera in if something static sits between it and the car.
    _v.set(Math.sin(t), 0.2, Math.cos(t)).normalize();
    _n.copy(p).y += 1;
    const hitT = this.physics.castRayStatic(_n, _v, r + 0.5);
    if (hitT !== null) r = Math.max(4.2, (hitT - 0.6) / _v.length() * Math.hypot(_v.x, _v.z));
    this.camera.position.set(p.x + Math.sin(t) * r, p.y + 1.7 + Math.sin(this.time * 0.3) * 0.2, p.z + Math.cos(t) * r);
    const rx = Math.cos(t), rz = -Math.sin(t); // camera-right on the ground plane
    this.camera.lookAt(p.x - rx * 2.6, p.y + 0.3, p.z - rz * 2.6);
    if (this.camera.fov !== 40) {
      this.camera.fov = 40;
      this.camera.updateProjectionMatrix();
    }
  }

  _resultsCamera() {
    const p = this.p.v.currPos;
    const t = this.time * 0.22;
    this.camera.position.set(p.x + Math.sin(t) * 9, p.y + 3.2, p.z + Math.cos(t) * 9);
    this.camera.lookAt(p.x, p.y + 0.8, p.z);
    if (this.camera.fov !== 50) {
      this.camera.fov = 50;
      this.camera.updateProjectionMatrix();
    }
  }

  _updateThreatIndicators(alpha) {
    const list = [];
    for (const c of this.bots) {
      c.v.getInterpolated(alpha, _p, _quat);
      _p.y += 0.8;
      this.camera.getWorldDirection(_camFwd);
      const behind = _v.copy(_p).sub(this.camera.position).dot(_camFwd) < 0;
      _ndc.copy(_p).project(this.camera);
      const dist = this.p.v.currPos.distanceTo(c.v.currPos);
      const show = (this.state === 'playing' || this.state === 'countdown') && !c.v.health.dead;
      list.push({ key: c.key, ndc: { x: _ndc.x, y: _ndc.y }, behind, dist, show, color: c.roster.accent });
    }
    this.hud.updateThreatIndicators(list);
  }

  // ---------------------------------------------------------------------------
  // Per-vehicle FX (tire smoke, skids, landings, recover burst, damage smoke)
  // ---------------------------------------------------------------------------
  _combatantFx(c, dt) {
    const v = c.v;
    const smoke = this.fx.smoke;
    for (let i = 0; i < 4; i++) {
      const w = v.wheels[i];
      this.fx.skids.add(c.key + i, w.contact, w.normal, w.grounded ? w.skid : 0, 0.32);
      if (!w.grounded || w.skid < 0.08) { c.smokeAcc[i] = 0; continue; }
      c.smokeAcc[i] += w.skid * (v.speed < 3 ? 22 : 45) * dt;
      while (c.smokeAcc[i] >= 1) {
        c.smokeAcc[i] -= 1;
        _v.copy(v.velocity).multiplyScalar(0.18);
        _v.x += (Math.random() - 0.5) * 1.6;
        _v.z += (Math.random() - 0.5) * 1.6;
        _v.y += 0.6 + Math.random() * 0.8;
        _p.copy(w.contact);
        _p.y += 0.2;
        const shade = 0.34 + Math.random() * 0.1;
        smoke.emit(_p, _v, {
          color: [shade, shade * 0.93, shade * 1.12],
          size: 0.7 + Math.random() * 0.5,
          grow: 3.2 + Math.random() * 1.5,
          life: 1.3 + Math.random() * 1.1,
          alpha: 0.08 + w.skid * 0.14,
        });
      }
    }

    // Boost trail smoke from the exhausts while boosting
    if (v.boosting) {
      c.boostSmokeAcc += 30 * dt;
      while (c.boostSmokeAcc >= 1) {
        c.boostSmokeAcc -= 1;
        for (const side of [-0.55, 0.55]) {
          _p.set(side, -0.1, 2.35).applyQuaternion(v.currQuat).add(v.currPos);
          _v.copy(v.velocity).multiplyScalar(-0.15);
          _v.x += (Math.random() - 0.5) * 0.6;
          _v.y += 0.3 + Math.random() * 0.3;
          _v.z += (Math.random() - 0.5) * 0.6;
          smoke.emit(_p, _v, { color: [1.4, 2.6, 3.2], size: 0.55 + Math.random() * 0.3, grow: 2.5, life: 0.5 + Math.random() * 0.3, alpha: 0.35 });
        }
      }
    } else {
      c.boostSmokeAcc = 0;
    }

    // Crackle sparks while standing in a damaging zone (ice / sand / oil only change grip)
    if (c.inHazard && this._zoneDamages(c)) {
      c.hazardFxAcc += 14 * dt;
      while (c.hazardFxAcc >= 1) {
        c.hazardFxAcc -= 1;
        _n.set(0, 1, 0);
        this.fx.sparks.burst(v.currPos, _n, 2, { speed: 3, spread: 0.9, life: 0.35, up: 0.5, color: [4, 1.2, 1.2] });
      }
    } else {
      c.hazardFxAcc = 0;
    }

    // Landing impact
    if (v.justLanded > 0) {
      const s = Math.min(1, (v.justLanded - 3) / 9);
      if (s > 0) {
        if (c.isPlayer) {
          this.chase.addTrauma(0.25 + s * 0.45);
          this.audio.impact(0.25 + s * 0.6, false);
        }
        for (let k = 0; k < 18 + s * 20; k++) {
          const a = (k / 20) * Math.PI * 2;
          _v.set(Math.cos(a) * (3 + s * 4), 0.4 + Math.random() * 0.6, Math.sin(a) * (3 + s * 4));
          _p.copy(v.currPos);
          _p.y -= 0.5;
          _p.x += Math.cos(a) * 1.4;
          _p.z += Math.sin(a) * 1.8;
          smoke.emit(_p, _v, { color: [0.42, 0.38, 0.5], size: 1.0, grow: 3.5, life: 1.2 + Math.random() * 0.6, alpha: 0.22 + s * 0.15 });
        }
      }
      v.justLanded = 0;
    }

    // Recover burst (R key / auto-recover)
    if (v.recovered) {
      v.recovered = false;
      this._spawnFx(c, v.currPos);
      if (c.isPlayer) this.renderer.flash = Math.max(this.renderer.flash, 0.35);
    }

    // Set alight by a flamethrower: flames licking off the body, black smoke
    if (c.burn > 0 && !v.health.dead) {
      c.burnAcc += 55 * dt;
      while (c.burnAcc >= 1) {
        c.burnAcc -= 1;
        _p.set((Math.random() - 0.5) * 1.6, 0.35 + Math.random() * 0.5, (Math.random() - 0.5) * 3.2).applyQuaternion(v.currQuat).add(v.currPos);
        _v.set((Math.random() - 0.5) * 0.8, 1.6 + Math.random() * 1.4, (Math.random() - 0.5) * 0.8);
        this.fx.fire.emit(_p, _v, { size: 0.5 + Math.random() * 0.5, grow: 1.0, life: 0.35 + Math.random() * 0.25, heat: 0.95 });
        if (Math.random() < 0.3) this.fx.smoke.emit(_p, _v.set(0, 2.2, 0), { color: [0.06, 0.055, 0.055], size: 0.7, grow: 3, life: 1.3, alpha: 0.45 });
      }
    } else {
      c.burnAcc = 0;
    }

    // Burning wreck: flames from the engine bay / cabin while it waits to respawn (dies down over the delay).
    if (v.health.dead && c.respawnTimer > 0) {
      _p.set(0, 0.35, -0.6).applyQuaternion(v.currQuat).add(v.currPos);
      this.fx.burn(_p, dt, 0.55 + 0.45 * Math.min(1, c.respawnTimer / RESPAWN_DELAY));
    }

    // Damage smoke: readable health state at a glance. Grey wisps < 45%, black + embers < 20%, heavy when wrecked.
    const pct = v.health.pct;
    // Shorted wiring: random spark bursts from the body once the hull is below 35%.
    if (pct < 0.35 && !v.health.dead) {
      c.sparkAcc += (1.2 + (0.35 - pct) * 8) * dt;
      while (c.sparkAcc >= 1) {
        c.sparkAcc -= 1;
        _p.set((Math.random() - 0.5) * 1.4, 0.4 + Math.random() * 0.3, (Math.random() - 0.5) * 3).applyQuaternion(v.currQuat).add(v.currPos);
        _n.set(0, 1, 0);
        this.fx.sparks.burst(_p, _n, 5, { speed: 4.5, spread: 1.0, life: 0.35, up: 0.7, color: [3.6, 2.2, 0.9] });
      }
    } else {
      c.sparkAcc = 0;
    }
    if (pct < 0.45) {
      const rate = v.health.dead ? 28 : pct < 0.2 ? 16 : 7;
      c.dmgSmokeAcc += rate * dt;
      while (c.dmgSmokeAcc >= 1) {
        c.dmgSmokeAcc -= 1;
        _p.set(0, 0.45, -1.2).applyQuaternion(v.currQuat).add(v.currPos);
        _v.copy(v.velocity).multiplyScalar(0.3);
        _v.x += (Math.random() - 0.5) * 0.8;
        _v.z += (Math.random() - 0.5) * 0.8;
        _v.y += 1.6 + Math.random() * 1.2;
        const dark = pct < 0.2 || v.health.dead;
        const k = dark ? 0.08 + Math.random() * 0.05 : 0.3 + Math.random() * 0.1;
        smoke.emit(_p, _v, { color: [k, k * 0.95, k * 1.05], size: dark ? 1.1 : 0.8, grow: dark ? 4.5 : 3, life: 1.6 + Math.random(), alpha: dark ? 0.45 : 0.25 });
        if (dark && Math.random() < 0.25) {
          _n.set(0, 1, 0);
          this.fx.sparks.burst(_p, _n, 1, { speed: 3, spread: 0.6, life: 0.5, up: 0.8, color: [4, 1.4, 0.3] });
        }
      }
    } else {
      c.dmgSmokeAcc = 0;
    }
  }

  // ---------------------------------------------------------------------------
  // Pickups, boost pads, hazard zones (sensor collisions)
  // ---------------------------------------------------------------------------
  _onCollision(e1, e2, started) {
    const vEntity = e1?.isVehicle ? e1 : e2?.isVehicle ? e2 : null;
    if (!vEntity) return;
    const other = e1 === vEntity ? e2 : e1;
    if (!other) return;
    const c = this._byVehicle.get(vEntity);
    if (!c) return;

    if (other.isPickup) {
      if (!started || this.state !== 'playing' || c.v.health.dead || c.respawnTimer > 0) return;
      if (!other.collect()) return;
      this._applyPickup(c, other);
    } else if (other.isBoostPad) {
      if (!started || this.state !== 'playing' || c.v.health.dead || c.respawnTimer > 0) return;
      if (c.boostPadCooldown > 0) return;
      c.boostPadCooldown = c.v.cfg.boostPadCooldown;
      c.v.boostPad(other.forward, c.v.cfg.boostPadMeterGain);
      const vol = c.isPlayer ? 1 : this._attenuation(c.v.currPos);
      this.audio.boostPadChime(vol);
      this.fx.flashes.spawn(c.v.currPos, '#dbeaff', 2, 0.14);
    } else if (other.isHazard) {
      if (started) c.zones.add(other); else c.zones.delete(other);
      c.inHazard = c.zones.size > 0;
    }
  }

  _applyPickup(c, pickup) {
    const cfg = c.v.cfg;
    const def = PICKUP_TYPES[pickup.kind];
    let label = def.label;
    if (pickup.kind === 'health') c.v.health.heal(cfg.healthPickupAmount);
    else if (pickup.kind === 'boost') c.v.boostMeter = cfg.boostMax;
    else if (pickup.kind === 'overcharge') c.v.overcharge = cfg.overchargeDuration;
    else if (isSecondaryKind(pickup.kind)) {
      // Same type tops up ammo; a different type swaps the loadout.
      const sdef = SECONDARY[pickup.kind];
      const have = c.secondary && c.secondary.type === pickup.kind ? c.secondary.ammo : 0;
      c.secondary = { type: pickup.kind, ammo: Math.min(sdef.ammo * 2, have + sdef.ammo) };
      label = `${sdef.short} ×${c.secondary.ammo}`;
    }

    const pos = pickup.group.position;
    const vol = c.isPlayer ? 1 : this._attenuation(pos);
    this.audio.pickup(pickup.kind, vol);
    const col = new THREE.Color(def.color);
    _n.set(0, 1, 0);
    this.fx.sparks.burst(pos, _n, 10, { speed: 5, spread: 0.6, life: 0.35, up: 0.6, color: [col.r * 2.2, col.g * 2.2, col.b * 2.2] });
    this.fx.flashes.spawn(pos, def.color, 2, 0.16);
    if (c.isPlayer) this.hud.pickupToast(label, def.color);
  }

  // ---------------------------------------------------------------------------
  // Secondary weapons
  // ---------------------------------------------------------------------------
  /** Best homing target: the alive opponent closest to the aim line (within ~35°, 120 m). Null = dumb-fire. */
  _pickMissileTarget(c, dir) {
    let best = null, bestAng = 0.62;
    const fx = dir.x, fz = dir.z;
    const fl = Math.hypot(fx, fz) || 1;
    if (!c.isPlayer && c.target && !c.target.v.health.dead) return c.target.v;
    for (const o of this._aliveOthers(c)) {
      const dx = o.v.currPos.x - c.v.currPos.x, dz = o.v.currPos.z - c.v.currPos.z;
      const d = Math.hypot(dx, dz);
      if (d < 4 || d > 120) continue;
      const ang = Math.acos(Math.max(-1, Math.min(1, (dx * fx + dz * fz) / (d * fl))));
      if (ang < bestAng) { bestAng = ang; best = o.v; }
    }
    return best;
  }

  _fireSecondary(c) {
    const sec = c.secondary;
    const def = SECONDARY[sec.type];
    sec.ammo--;
    c.secondaryCooldown = def.cooldown;
    const vol = c.isPlayer ? 1 : this._attenuation(c.v.currPos);
    const mz = _p, md = _n;
    c.weapon.aim(mz, md);
    c.model.flashMuzzle();

    if (sec.type === 'missile') {
      // Launch slightly upward so it clears the roofline before the guidance kicks in.
      _v.copy(md);
      _v.y += 0.12;
      _v.normalize();
      const target = this._pickMissileTarget(c, md);
      this.ordnance.fireMissile(c.v, mz, _v, target);
      c.v.applyRecoil(md);
      this.audio.missileLaunch(vol);
      this.fx.flashes.spawn(mz, '#ffd9a8', 2.4, 0.12);
    } else if (sec.type === 'mine') {
      _v.set(0, 0, 1).applyQuaternion(c.v.currQuat); // behind the car
      _v.y = 0;
      _v.normalize();
      _pos.copy(c.v.currPos).addScaledVector(_v, 3.0);
      this.ordnance.dropMine(c.v, _pos);
      this.audio.mineDrop(vol);
    } else if (sec.type === 'scatter') {
      const n = SEC.flakPellets;
      const up = _camFwd.set(0, 1, 0);
      const right = _ndc.crossVectors(md, up).normalize();
      for (let i = 0; i < n; i++) {
        _v.copy(md);
        _v.applyAxisAngle(up, (Math.random() - 0.5) * 2 * SEC.flakSpread);
        _v.applyAxisAngle(right, (Math.random() - 0.5) * SEC.flakSpread);
        this.projectiles.spawn(mz, _v.normalize(), c.v.body, c.v, {
          damage: SEC.flakDamage, speed: SEC.flakSpeed * (0.92 + Math.random() * 0.16), life: SEC.flakLife,
          kind: 'scatter', color: [1.0, 0.62, 0.28],
        });
      }
      c.v.applyRecoil(md);
      c.v.applyRecoil(md);
      this.audio.scatter(vol);
      this.fx.flashes.spawn(mz, '#ffc27a', 3.2, 0.1);
      this.fx.sparks.burst(mz, md, 10, { speed: 9, spread: 0.35, life: 0.2, up: 0, color: [4, 2.4, 0.9] });
      if (c.isPlayer) this.stats.shots += n - 1;
    } else if (sec.type === 'laser') {
      this.ordnance.fireLaser(c.v, mz, md, c.isPlayer ? [0.35, 1.3, 3.2] : [3.2, 0.6, 0.4]);
      c.v.applyRecoil(md);
      this.audio.laser(vol);
      this.fx.flashes.spawn(mz, '#9fdcff', 2.6, 0.14);
    }

    if (c.isPlayer) {
      this.stats.shots++;
      this.hud.crosshairPulse();
      this.chase.addTrauma(sec.type === 'scatter' ? 0.32 : 0.14);
    }
    if (sec.ammo <= 0) c.secondary = null;
  }

  /** Splash detonation (missile impact / mine trigger): falloff damage + knockback to every non-owner vehicle in range. */
  _onDetonate({ kind, pos, radius, damage, knock, lift, owner, damageFn = null }) {
    const ownerC = this._byVehicle.get(owner);
    const scale = radius / 5;
    this.fx.explosion(pos, { color: kind === 'mine' ? '#ff9a4a' : '#ffb060', scale: 0.85 * scale + 0.35 });
    if (kind === 'shell') this.fx.flashes.spawn(pos, '#ffd9a0', 12, 0.25);
    this.fx.shockwaves.spawn(pos, '#ffd6a0', radius * 1.1, 0.5);
    const dP = this.p.v.currPos.distanceTo(pos);
    const near = Math.max(0, 1 - dP / (radius * 5 + 25));
    this.chase.addTrauma(0.55 * near);
    this.renderer.flash = Math.max(this.renderer.flash, 0.28 * near);
    this.audio.explosion(Math.min(1, 0.45 + 0.6 * this._attenuation(pos)));
    if (this.state !== 'playing') return;

    let hitAny = false, killed = false;
    for (const t of this.combatants) {
      if (t === ownerC || t.v.health.dead) continue;
      _v.copy(t.v.currPos).sub(pos);
      const d = _v.length();
      if (d > radius) continue;
      const f = 1 - d / radius;
      const dmg = damageFn ? damageFn(t, d) : damage * (0.35 + 0.65 * f);
      _v.y = 0;
      if (_v.lengthSq() < 1e-4) _v.set(Math.random() - 0.5, 0, Math.random() - 0.5);
      _v.normalize();
      const m = t.v.cfg.mass;
      t.v.body.applyImpulse({ x: _v.x * m * knock * f, y: m * lift * f, z: _v.z * m * knock * f }, true);
      _n.set(0, 1, 0);
      const applied = t.v.health.takeDamage(dmg, pos, _n, owner, this.time, kind);
      if (applied) { hitAny = true; if (t.v.health.dead) killed = true; }
    }
    if (hitAny && ownerC?.isPlayer) {
      this.stats.hits++;
      this.hud.hitMarker(killed);
      this.audio.blip(killed ? 1900 : 1500, 0.05, 0.1);
    }
  }

  _onLaserHit(point, normal, entity, owner, damage = SEC.laserDamage, cause = 'laser', width = 1) {
    this.fx.flashes.spawn(point, '#bfe8ff', 3 * (0.6 + width * 0.4), 0.16);
    if (normal) this.fx.sparks.burst(point, normal, 22, { speed: 11, spread: 0.7, life: 0.35, up: 0.2, color: [1.5, 3, 4.5] });
    if (!entity?.health || entity === owner || this.state !== 'playing') return;
    // (Deliberately not using the shared scratch vectors: this runs mid-_fireSecondary, which still needs them.)
    const applied = entity.health.takeDamage(damage, point, normal ?? UP_VEC, owner, this.time, cause);
    if (applied && owner === this.p.v) {
      this.stats.hits++;
      this.hud.hitMarker(entity.health.dead);
      this.audio.blip(entity.health.dead ? 1900 : 1500, 0.05, 0.1);
    }
  }

  /**
   * BREACHER shell impact. A direct hit (within a few metres of a hull) either wrecks a light car outright or leaves
   * a heavy one on a sliver of health (so the follow-up ram finishes it); the blast beyond that is ordinary falloff.
   */
  _onShellHit(point, normal, entity, projectile) {
    const def = PRIMARY.breacher;
    const owner = projectile.owner;
    const at = point.clone();
    if (normal) at.addScaledVector(normal, 0.4);
    this._onDetonate({
      kind: 'shell', pos: at, radius: def.radius, damage: 0, knock: def.knock, lift: def.lift, owner,
      damageFn: (t, d) => {
        const h = t.v.health;
        if (d <= def.direct) {
          if (h.max <= def.killBelow || h.current <= def.finish) return h.current + 1; // light car, or already weak: wrecked
          const left = def.lowLeft[0] + Math.random() * (def.lowLeft[1] - def.lowLeft[0]);
          return Math.max(1, h.current - left);
        }
        return def.splash * Math.max(0, 1 - (d - def.direct) / (def.radius - def.direct)) + 15;
      },
    });
  }

  /** Flame stream contact: small damage, sets vehicles ablaze (damage over time), licks of fire on the surface. */
  _onFlameHit(point, normal, entity, projectile) {
    _v.set(0, 0.6, 0);
    this.fx.fire.emit(point, _v, { size: 0.9, grow: 1.6, life: 0.35, heat: 1 });
    if (!entity?.health || entity === projectile.owner || this.state !== 'playing') return;
    const t = this._byVehicle.get(entity);
    const applied = entity.health.takeDamage(projectile.damage, point, normal ?? UP_VEC, projectile.owner, this.time, 'flame');
    if (!applied) return;
    if (t && !t.v.health.dead) {
      t.burn = PRIMARY.flame.burn;
      t.burnSource = projectile.owner;
    }
    if (projectile.owner === this.p.v) {
      this.stats.hits++;
      this.hud.hitMarker(entity.health.dead);
    }
  }

  // ---------------------------------------------------------------------------
  // Combat events
  // ---------------------------------------------------------------------------
  /**
   * Rapier contact-force event where at least one side is a registered entity. Two things happen
   * independently: (1) feel FX — sparks for whichever vehicle is involved; camera shake + full-volume sound only
   * when the player is involved, distance-attenuated sound otherwise; (2) hull damage to *every* registered side
   * hard enough (so ramming hurts both cars).
   */
  _onImpact(ev) {
    const e1 = this.physics.getEntity(ev.c1);
    const e2 = this.physics.getEntity(ev.c2);
    if (!e1 && !e2) return;
    const player = this.p.v;
    const mover = e1 === player ? e1 : e2 === player ? e2 : e1?.isVehicle ? e1 : e2?.isVehicle ? e2 : null;

    if (mover) {
      const s = Math.min(1, Math.max(0, (ev.magnitude - mover.cfg.impactThreshold) / 900000));
      // Direction away from whatever we hit (manifold normal points c1 -> c2)
      _n.set(ev.normal.x, ev.normal.y, ev.normal.z);
      if (e1 === mover) _n.negate();
      _v.copy(mover.velocity);
      const sp = _v.length();
      if (sp > 1) _n.addScaledVector(_v.divideScalar(sp), 0.9).normalize();
      this.fx.sparks.burst(ev.point, _n, Math.round(2 + s * 40), { speed: 6 + s * 14, spread: 0.8, life: 0.45 + s * 0.4 });

      _p.set(ev.point.x, ev.point.y, ev.point.z);
      const playerInvolved = e1 === player || e2 === player;
      if (playerInvolved) {
        if (s > 0.06 && this.impactCooldown <= 0) {
          this.impactCooldown = 0.15;
          this.chase.addTrauma(0.15 + s * 0.7);
          this.fx.flashes.spawn(_p, '#ffb020', 1.5 + s * 5, 0.12 + s * 0.12);
          if (s > 0.35) this.renderer.flash = Math.max(this.renderer.flash, s * 0.25);
        }
        if (s > 0.03 && this.soundCooldown <= 0) {
          this.soundCooldown = 0.1;
          this.audio.impact(0.15 + s);
        }
      } else if (s > 0.06 && this.remoteSoundCooldown <= 0) {
        this.remoteSoundCooldown = 0.15;
        this.fx.flashes.spawn(_p, '#ffb020', 1.5 + s * 5, 0.12 + s * 0.12);
        const vol = this._attenuation(_p);
        if (vol > 0.05) this.audio.impact((0.15 + s) * vol);
      }
    }

    // Hull/ram damage (live match only). Thresholds live on the player's config (tunable in the debug panel).
    // A single crash produces contact-force events on many consecutive steps; a per-entity cooldown makes one
    // crash count as one hit (otherwise a 100 km/h head-on stacks 5-6 hits and is instantly lethal).
    if (this.state !== 'playing') return;
    const c = player.cfg;
    const dmgT = Math.min(1, Math.max(0, (ev.magnitude - c.hullDamageThreshold) / c.hullDamageRange));
    if (dmgT > 0) {
      const dmg = dmgT * c.hullDamagePerHit;
      const hurt = (e, src) => {
        if (!e?.health || this.time - (e.lastRamHit ?? -9) < RAM_COOLDOWN) return;
        // A tumbling wreck can still crush you, but it's the environment's hit — a dead car never scores.
        if (src?.health?.dead) src = null;
        // Crashing into scenery hurts, but half as much as being rammed — kills should come from combat.
        const amount = src?.isVehicle ? dmg : dmg * STATIC_CRASH_DAMAGE;
        if (e.health.takeDamage(amount, ev.point, ev.normal, src, this.time, 'ram')) e.lastRamHit = this.time;
      };
      hurt(e1, e2 ?? null);
      hurt(e2, e1 ?? null);
    }
  }

  _onDamage(c, amount, source) {
    if (c.isPlayer) {
      this.hud.damageFlash();
      this.chase.addTrauma(Math.min(0.5, amount / 80));
      this.stats.damageTaken += amount;
    } else {
      c.nameplate.flash();
      if (source === this.p.v) this.stats.damageDealt += amount;
    }
  }

  _onDeath(c, source, cause) {
    const pos = c.v.currPos.clone();
    const vol = c.isPlayer ? 1 : this._attenuation(pos);
    const killer = source ? this._byVehicle.get(source) : null;

    // Tear off one or two wheels, burn the shell, throw the car, and blow it all up.
    const lost = [];
    const nLost = Math.random() < 0.55 ? 1 : 2;
    while (lost.length < nLost) {
      const i = Math.floor(Math.random() * c.model.wheelGroups.length);
      if (!lost.includes(i)) lost.push(i);
    }
    const wheels = lost.map((i) => c.model.wheelWorld(i, new THREE.Vector3()));
    c.model.setWrecked(true, lost);
    this.fx.wreck(pos, { paint: `#${c.model._paint.getHexString()}`, vel: c.v.velocity, wheels });
    let away = null;
    if (killer && killer !== c) {
      away = _v.subVectors(pos, killer.v.currPos);
      away.y = 0;
      away = away.lengthSq() > 0.01 ? away.normalize() : null;
    }
    c.v.wreckLaunch(away);
    this.audio.wreck(vol);

    const near = c.isPlayer ? 1 : Math.max(0, 1 - this.p.v.currPos.distanceTo(pos) / 50);
    this.chase.addTrauma(c.isPlayer ? 1 : 0.55 * near);
    if (c.isPlayer || near > 0.05) {
      this.renderer.flash = Math.max(this.renderer.flash, c.isPlayer ? 0.6 : 0.28 * near);
      this.renderer.flashColor.setRGB(1, 0.55, 0.2);
    }
    c.respawnTimer = RESPAWN_DELAY;
    c.killer = killer && killer !== c ? killer : null;

    if (this.state !== 'playing') return;
    // Whoever dealt the killing blow scores (a vehicle, from ram damage or a projectile) — a hazard-zone kill
    // (source === null) scores no one, same as a genuine self-destruct.
    if (killer && killer !== c) killer.score++;

    // Player died: WRECKED card + death cam. Player scored: banner, kill sting and a short hit-stop slow-mo.
    // Every kill goes into the kill-feed list.
    if (c.isPlayer) {
      this.hud.showWrecked(c.killer ? c.killer.name : null, c.killer ? c.killer.roster.accent : null, RESPAWN_DELAY + 0.45); // + slow-mo dip
      this.timeScale = Math.min(this.timeScale, 0.35);
    } else if (killer?.isPlayer) {
      this.hud.killBanner(`${c.name} WRECKED`);
      this.audio.killConfirm();
      this.timeScale = Math.min(this.timeScale, 0.3);
    }
    const colorOf = (x) => (x.isPlayer ? PLAYER_COLOR : x.roster.accent);
    this.hud.killFeed({
      killer: killer && killer !== c ? { name: killer.isPlayer ? 'YOU' : killer.name, color: colorOf(killer), you: killer.isPlayer } : null,
      victim: { name: c.isPlayer ? 'YOU' : c.name, color: colorOf(c), you: c.isPlayer },
      cause: cause ?? (killer ? 'cannon' : 'hazard'),
    });
    this.hud.setScore(this.combatants.map((x) => ({ key: x.key, score: x.score })));
    if (killer && killer.score >= KILLS_TO_WIN) this._endMatch(killer);
  }

  _onWeaponFire(c, pos, dir, kind = 'bolt') {
    const vol = c.isPlayer ? 1 : this._attenuation(pos);
    c.model.flashMuzzle(kind);
    if (kind === 'flame') {
      // stream of fire out of the nozzle (the projectile itself is invisible)
      this.fx.fireBurst(pos, 3, { speed: 6, size: 0.6, life: 0.3, up: 0.05, vel: dir });
      c.flameAcc = (c.flameAcc + 1) % 4;
      if (c.flameAcc === 0) this.audio.flame(vol);
    } else if (kind === 'shell') {
      this.fx.flashes.spawn(pos, '#ffb070', 4.5, 0.16);
      this.fx.fireBurst(pos, 10, { speed: 9, size: 0.9, life: 0.4, up: 0.05, vel: dir });
      this.fx.sparks.burst(pos, dir, 16, { speed: 12, spread: 0.3, life: 0.3, up: 0, color: [4, 2.2, 0.8] });
      this.audio.breacher(vol);
    } else if (kind === 'pellet') {
      this.fx.flashes.spawn(pos, '#ffc27a', 3, 0.1);
      this.fx.sparks.burst(pos, dir, 12, { speed: 10, spread: 0.4, life: 0.2, up: 0, color: [4, 2.4, 0.9] });
      this.audio.shotgun(vol);
    } else if (kind === 'spin') {
      this.fx.flashes.spawn(pos, '#ffcf8a', 1.1, 0.05);
      this.audio.fire(vol * 0.5, 0.75 + c.weapon.spin * 0.5);
    } else if (kind === 'beam') {
      this.fx.flashes.spawn(pos, '#bfe8ff', 3, 0.12);
      this.audio.rail(vol);
    } else {
      this.fx.flashes.spawn(pos, '#ffcf8a', 1.4, 0.07);
      this.fx.sparks.burst(pos, dir, 4, { speed: 4, spread: 0.15, life: 0.12, up: 0, color: [4, 2.6, 1] });
      this.audio.fire(c.isPlayer ? 1 : vol * 0.8);
    }
    if (c.isPlayer) {
      this.hud.crosshairPulse();
      this.stats.shots += kind === 'pellet' ? 1 : 1;
      if (kind === 'shell') this.chase.addTrauma(0.5);
      else if (kind === 'pellet') this.chase.addTrauma(0.3);
      else if (kind === 'beam') this.chase.addTrauma(0.22);
    }
  }

  /** Rail sniper: instant hitscan beam from the muzzle (visual + damage via the shared beam pool). */
  _firePrimaryBeam(c, pos, dir, def, damage) {
    this.ordnance.fireLaser(c.v, pos, dir, c.isPlayer ? [0.45, 1.5, 3.4] : [3.4, 0.7, 0.45], {
      range: def.range, time: def.beamTime, damage, width: 0.6, cause: 'sniper',
    });
  }

  /** Per-fixed-step visuals for special projectiles: the shell's smoke trail and the flamethrower's fire stream. */
  _projectileTrail(p, dt) {
    if (p.kind === 'shell') {
      _v.set((Math.random() - 0.5) * 0.6, 0.3 + Math.random() * 0.4, (Math.random() - 0.5) * 0.6);
      this.fx.smoke.emit(p.currPos, _v, { color: [0.5, 0.46, 0.42], size: 0.5, grow: 2.2, life: 0.9, alpha: 0.35 });
      if (Math.random() < 0.6) this.fx.fire.emit(p.currPos, _v.set(0, 0.2, 0), { size: 0.5, grow: 0.5, life: 0.18, heat: 1 });
    } else {
      p._t = (p._t ?? 0) + 1;
      if (p._t % 2 === 0) {
        const age = 1 - p.life / p.maxLife;
        _v.set((Math.random() - 0.5) * 1.6, 0.4 + Math.random() * 1.2, (Math.random() - 0.5) * 1.6);
        this.fx.fire.emit(p.currPos, _v, { size: 0.5 + age * 0.9, grow: 1.6 + age * 1.6, life: 0.3 + Math.random() * 0.2, heat: 1 - age * 0.5 });
      }
    }
  }

  _onProjectileHit(point, normal, entity, projectile) {
    if (projectile.kind === 'shell') { this._onShellHit(point, normal, entity, projectile); return; }
    if (projectile.kind === 'flame') { this._onFlameHit(point, normal, entity, projectile); return; }
    const isWeaponHit = entity && entity.health && entity !== projectile.owner;
    this.fx.sparks.burst(point, normal, isWeaponHit ? 14 : 8, {
      speed: 8, spread: 0.7, life: 0.3, up: 0.2, color: [4, 2.6, 1],
    });
    this.fx.flashes.spawn(point, '#ffd9a0', isWeaponHit ? 2.2 : 1.2, 0.12);
    if (!isWeaponHit || this.state !== 'playing') return;

    const applied = entity.health.takeDamage(projectile.damage, point, normal, projectile.owner, this.time, projectile.kind);
    if (!applied) return;
    if (projectile.owner === this.p.v) {
      this.stats.hits++;
      this.hud.hitMarker(entity.health.dead);
      this.audio.blip(entity.health.dead ? 1900 : 1500, 0.05, 0.1);
    } else if (entity === this.p.v) {
      this.audio.impact(0.2);
    }
  }
}
