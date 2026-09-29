import GUI from 'lil-gui';
import { SEC, SECONDARY } from '../combat/SecondaryWeapons.js';

// Live tuning for driving feel. Toggle with ` (backquote). "Copy vehicle JSON" puts the current config on the
// clipboard so good values can be baked back into VehicleConfig.js.

export class TuningPanel {
  constructor(game) {
    this.game = game;
    const gui = new GUI({ title: 'WRECKFIELD · TUNING' });
    gui.hide();
    this.gui = gui;
    this.visible = false;
    const v = game.player;
    const c = v.cfg;
    const mass = () => v.applyMassProperties();

    this.stats = { fps: 0, frameMs: 0, speedKmh: 0, grounded: 0 };
    const perf = gui.addFolder('Performance');
    perf.add(this.stats, 'fps').listen().disable();
    perf.add(this.stats, 'frameMs').name('frame ms').listen().disable();
    perf.add(this.stats, 'speedKmh').name('km/h').listen().disable();
    perf.add(this.stats, 'grounded').name('wheels down').listen().disable();

    const world = { gravity: game.physics.gravity };
    const w = gui.addFolder('World');
    w.add(world, 'gravity', -30, -5, 0.1).onChange((g) => game.physics.setGravity(g));
    w.add(game.renderer.bloom, 'strength', 0, 2, 0.01).name('bloom strength');
    w.add(game.renderer.bloom, 'threshold', 0, 1.5, 0.01).name('bloom threshold');
    w.add(game.renderer.renderer, 'toneMappingExposure', 0.4, 2, 0.01).name('exposure');

    const ch = gui.addFolder('Chassis');
    ch.add(c, 'mass', 600, 3000, 10).onChange(mass);
    ch.add(c.comOffset, '1', -0.8, 0.2, 0.01).name('CoM height').onChange(mass);
    ch.add(c.comOffset, '2', -0.8, 0.8, 0.01).name('CoM fwd(-)/back(+)').onChange(mass);
    ch.add(c.inertiaScale, '0', 0.3, 3, 0.05).name('pitch inertia ×').onChange(mass);
    ch.add(c.inertiaScale, '1', 0.3, 3, 0.05).name('yaw inertia ×').onChange(mass);
    ch.add(c.inertiaScale, '2', 0.3, 3, 0.05).name('roll inertia ×').onChange(mass);
    ch.add(c, 'angularDamping', 0, 3, 0.01).onChange(mass);

    const s = gui.addFolder('Suspension');
    s.add(c, 'suspTravel', 0.1, 0.8, 0.01);
    s.add(c, 'springStiffness', 5000, 120000, 500);
    s.add(c, 'damperCompression', 0, 12000, 50);
    s.add(c, 'damperRebound', 0, 12000, 50);
    s.add(c, 'antiRollFront', 0, 60000, 500);
    s.add(c, 'antiRollRear', 0, 60000, 500);

    const e = gui.addFolder('Engine & Brakes');
    e.add(c, 'engineForce', 2000, 40000, 100);
    e.add(c, 'topSpeed', 10, 80, 0.5);
    e.add(c, 'engineCurveExponent', 0.5, 4, 0.05);
    e.add(c, 'frontDriveShare', 0, 1, 0.01).name('front drive share');
    e.add(c, 'reverseForce', 1000, 20000, 100);
    e.add(c, 'brakeForce', 2000, 60000, 100);
    e.add(c, 'brakeBias', 0, 1, 0.01);
    e.add(c, 'handbrakeForce', 0, 20000, 100);
    e.add(c, 'dragCoefficient', 0, 3, 0.01);
    e.add(c, 'downforce', 0, 15, 0.1);

    const t = gui.addFolder('Tires');
    t.add(c, 'frontGripRate', 1, 120, 0.5);
    t.add(c, 'rearGripRate', 1, 120, 0.5);
    t.add(c, 'frontMu', 0.2, 3, 0.01);
    t.add(c, 'rearMu', 0.2, 3, 0.01);
    t.add(c, 'slideStart', 0, 10, 0.1);
    t.add(c, 'slideFull', 1, 20, 0.1);
    t.add(c, 'slideMuScale', 0.2, 1, 0.01);
    t.add(c, 'handbrakeGripRate', 0, 40, 0.5);
    t.add(c, 'handbrakeMuScale', 0.05, 1, 0.01);
    t.add(c, 'rollInfluence', 0, 1, 0.01);

    const st = gui.addFolder('Steering');
    st.add(c, 'maxSteer', 0.1, 1, 0.01);
    st.add(c, 'minSteer', 0.02, 0.6, 0.01);
    st.add(c, 'steerSpeedRef', 5, 60, 0.5);
    st.add(c, 'steerRate', 0.5, 12, 0.1);
    st.add(c, 'steerReturnRate', 0.5, 15, 0.1);
    st.add(c, 'driftAssist', 0, 1.5, 0.01);

    const a = gui.addFolder('Air');
    a.add(c, 'airPitchTorque', 0, 8000, 50);
    a.add(c, 'airYawTorque', 0, 8000, 50);
    a.add(c, 'airLeveling', 0, 8000, 50);
    a.add(c, 'airAngularDrag', 0, 5, 0.05);

    const cam = gui.addFolder('Camera');
    const cs = game.chase.settings;
    cam.add(cs, 'distance', 3, 15, 0.1);
    cam.add(cs, 'distanceFast', 3, 18, 0.1);
    cam.add(cs, 'height', 0.5, 6, 0.05);
    cam.add(cs, 'lookAhead', 0, 10, 0.1);
    cam.add(cs, 'dirSharpness', 0.5, 20, 0.1);
    cam.add(cs, 'velocityBlend', 0, 1, 0.01);
    cam.add(cs, 'fov', 40, 100, 0.5);
    cam.add(cs, 'fovFast', 40, 110, 0.5);

    const cb = gui.addFolder('Combat');
    cb.add(c, 'maxHealth', 50, 500, 10).name('player max HP').onChange((m) => {
      v.health.max = m;
      v.health.current = Math.min(v.health.current, m);
    });
    cb.add(c, 'hullDamageThreshold', 10000, 150000, 1000).name('ram dmg threshold (N)');
    cb.add(c, 'hullDamageRange', 20000, 400000, 1000).name('ram dmg range (N)');
    cb.add(c, 'hullDamagePerHit', 0, 100, 1).name('ram dmg / hit');
    cb.add(c, 'weaponFireRate', 1, 15, 0.5).name('fire rate (shots/s)');
    cb.add(c, 'weaponDamage', 1, 100, 1).name('shot damage');
    cb.add(c, 'weaponProjectileSpeed', 20, 160, 1).name('projectile speed');
    cb.add(c, 'weaponRecoil', 0, 4000, 50).name('recoil impulse');

    const up = { x: 0, y: 1, z: 0 };
    const combatActions = {
      heal: () => v.health.reset(0),
      hurt: () => v.health.takeDamage(50, v.currPos, up, null, game.time),
      wreckAllBots: () => {
        for (const b of game.bots) if (!b.v.health.dead) b.v.health.takeDamage(9999, b.v.currPos, up, v, game.time);
      },
    };
    cb.add(combatActions, 'heal').name('❤ Heal player to full');
    cb.add(combatActions, 'hurt').name('💥 Hurt player (-50)');
    cb.add(combatActions, 'wreckAllBots').name('🎯 Wreck all AI (+N you)');

    const bh = gui.addFolder('Boost & Hazards');
    bh.add(c, 'boostMax', 20, 200, 5).name('boost meter max');
    bh.add(c, 'boostDrainRate', 5, 100, 1).name('boost drain %/s');
    bh.add(c, 'boostRegenRate', 1, 40, 0.5).name('boost regen %/s');
    bh.add(c, 'boostForceMult', 1, 3, 0.01).name('boost engine force ×');
    bh.add(c, 'boostTopSpeedMult', 1, 2, 0.01).name('boost top speed ×');
    bh.add(c, 'boostMinToStart', 0, 50, 1).name('boost min to start');
    bh.add(c, 'boostPadImpulse', 0, 12000, 100).name('boost pad impulse');
    bh.add(c, 'boostPadMeterGain', 0, 100, 1).name('boost pad meter gain');
    bh.add(c, 'boostPickupMeterGain', 0, 100, 1).name('boost pickup meter gain');
    bh.add(c, 'boostPadCooldown', 0, 5, 0.1).name('boost pad cooldown (s)');
    bh.add(c, 'hazardDamagePerSecond', 0, 150, 1).name('hazard dmg/s');
    bh.add(c, 'hazardTractionMult', 0.1, 1, 0.01).name('hazard traction ×');
    bh.add(c, 'healthPickupAmount', 0, 200, 5).name('health pickup amount');
    bh.add(c, 'overchargeDuration', 1, 20, 0.5).name('overcharge duration (s)');
    bh.add(c, 'overchargeFireRateMult', 1, 3, 0.01).name('overcharge fire rate ×');
    bh.add(c, 'overchargeDamageMult', 1, 3, 0.01).name('overcharge damage ×');
    const boostActions = {
      fillBoost: () => { v.boostMeter = c.boostMax; },
      triggerOvercharge: () => { v.overcharge = c.overchargeDuration; },
    };
    bh.add(boostActions, 'fillBoost').name('⚡ Fill boost meter');
    bh.add(boostActions, 'triggerOvercharge').name('✦ Trigger overcharge');

    const sw = gui.addFolder('Secondary Weapons');
    const secNum = (key, lo, hi, step, name) => sw.add(SEC, key, lo, hi, step).name(name);
    secNum('missileDamage', 10, 150, 1, 'missile damage');
    secNum('missileRadius', 2, 14, 0.1, 'missile splash radius');
    secNum('missileSpeed', 20, 120, 1, 'missile top speed');
    secNum('missileTurnRate', 0.3, 6, 0.05, 'missile turn rate');
    secNum('mineDamage', 10, 150, 1, 'mine damage');
    secNum('mineRadius', 2, 14, 0.1, 'mine splash radius');
    secNum('mineTrigger', 1, 8, 0.1, 'mine trigger radius');
    secNum('flakPellets', 3, 20, 1, 'flak pellets');
    secNum('flakDamage', 2, 30, 1, 'flak pellet damage');
    secNum('flakSpread', 0.02, 0.4, 0.01, 'flak spread (rad)');
    secNum('laserDamage', 5, 100, 1, 'laser damage');
    const grant = {};
    for (const [kind, def] of Object.entries(SECONDARY)) {
      grant[kind] = () => { game.p.secondary = { type: kind, ammo: def.ammo }; };
      sw.add(grant, kind).name(`+ give ${def.short}`);
    }

    // AI: 3 bots now, each on its own archetype-flavored profile (difficulty picker scales all 3 at once — see
    // Game.buildAIProfile / AI_ROSTER). Live per-field slider editing doesn't generalize cleanly to N distinct
    // profile objects with lil-gui's static bindings, so this folder trims to pause/debug-toggle (global, applies
    // to every bot) plus a read-only mode/HP readout per bot — still enough to watch/debug a live match.
    const aif = gui.addFolder('AI Opponents');
    aif.add(game, 'aiPaused').name('pause all AI');
    const debugState = { visible: false };
    aif.add(debugState, 'visible').name('show steering debug').onChange((val) => {
      for (const b of game.bots) b.debug.lines.visible = val;
    });
    this.botStats = game.bots.map((b) => ({ mode: '', hp: 100 }));
    game.bots.forEach((b, i) => {
      const bf = aif.addFolder(`${b.name} — ${b.roster.archetype}`);
      bf.add(this.botStats[i], 'mode').listen().disable();
      bf.add(this.botStats[i], 'hp').name('hp %').listen().disable();
      bf.close();
    });

    const actions = {
      copy: () => {
        const json = JSON.stringify({ vehicle: c, camera: cs, gravity: world.gravity }, null, 2);
        navigator.clipboard?.writeText(json);
        console.log(json);
      },
      reset: () => v.recover(true),
    };
    gui.add(actions, 'copy').name('📋 Copy tuning JSON');
    gui.add(actions, 'reset').name('↺ Reset car to spawn');

    for (const f of gui.folders) if (f._title !== 'Performance') f.close();
  }

  toggle() {
    this.visible = !this.visible;
    this.visible ? this.gui.show() : this.gui.hide();
  }
}
