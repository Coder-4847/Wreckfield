// Fully synthesized audio (WebAudio) — no sample files.
// Engine: detuned saw/square stack at the firing frequency -> soft clipper -> throttle-driven lowpass.
// Tires: band-passed noise gated by skid amount. Wind: low-passed noise by speed. Impacts: noise burst + thump.

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.enabled = false;
    this.volume = 0.7;
  }

  start() {
    if (this.ctx) {
      this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;

    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);

    this.noiseBuf = this._noiseBuffer(2);

    // --- Engine ---
    this.engGain = ctx.createGain();
    this.engGain.gain.value = 0;
    this.engFilter = ctx.createBiquadFilter();
    this.engFilter.type = 'lowpass';
    this.engFilter.frequency.value = 600;
    this.engFilter.Q.value = 3.5;
    const shaper = ctx.createWaveShaper();
    shaper.curve = this._driveCurve(2.4);
    shaper.oversample = '2x';
    const mix = ctx.createGain();
    mix.gain.value = 0.3;
    this.oscs = [
      { type: 'sawtooth', mul: 1, detune: 0, gain: 0.55 },
      { type: 'sawtooth', mul: 0.5, detune: 7, gain: 0.7 },
      { type: 'square', mul: 0.25, detune: -5, gain: 0.35 },
      { type: 'sine', mul: 0.5, detune: 0, gain: 0.8 },
    ].map((o) => {
      const osc = ctx.createOscillator();
      osc.type = o.type;
      osc.detune.value = o.detune;
      const g = ctx.createGain();
      g.gain.value = o.gain;
      osc.connect(g).connect(mix);
      osc.start();
      return { osc, mul: o.mul };
    });
    // Amplitude "chug" modulation for low-rpm texture
    this.chug = ctx.createOscillator();
    this.chug.type = 'sine';
    const chugDepth = ctx.createGain();
    chugDepth.gain.value = 0.12;
    this.chug.connect(chugDepth).connect(mix.gain);
    this.chug.start();
    mix.connect(shaper).connect(this.engFilter).connect(this.engGain).connect(this.master);

    // --- Tire screech ---
    this.tireGain = ctx.createGain();
    this.tireGain.gain.value = 0;
    const tireSrc = this._loopNoise();
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1400;
    bp.Q.value = 2.2;
    this.tireBP = bp;
    const squeal = ctx.createOscillator();
    squeal.type = 'triangle';
    squeal.frequency.value = 820;
    const squealG = ctx.createGain();
    squealG.gain.value = 0.18;
    squeal.connect(squealG).connect(this.tireGain);
    squeal.start();
    this.squeal = squeal;
    tireSrc.connect(bp).connect(this.tireGain).connect(this.master);

    // --- Wind ---
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    const windSrc = this._loopNoise();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 500;
    this.windLP = lp;
    windSrc.connect(lp).connect(this.windGain).connect(this.master);

    // --- Boost turbine (continuous layer while boosting) ---
    this.boostGain = ctx.createGain();
    this.boostGain.gain.value = 0;
    const boostSrc = this._loopNoise();
    const boostBP = ctx.createBiquadFilter();
    boostBP.type = 'bandpass';
    boostBP.frequency.value = 900;
    boostBP.Q.value = 1.6;
    this.boostBP = boostBP;
    boostSrc.connect(boostBP).connect(this.boostGain).connect(this.master);
    const boostPulse = ctx.createOscillator();
    boostPulse.type = 'sine';
    boostPulse.frequency.value = 55;
    this.boostPulseGain = ctx.createGain();
    this.boostPulseGain.gain.value = 0;
    boostPulse.connect(this.boostPulseGain).connect(this.master);
    boostPulse.start();

    // --- Hazard buzz (electrical crackle while standing in a hazard zone) ---
    this.hazardGain = ctx.createGain();
    this.hazardGain.gain.value = 0;
    const hazardSrc = this._loopNoise();
    const hazardBP = ctx.createBiquadFilter();
    hazardBP.type = 'bandpass';
    hazardBP.frequency.value = 2600;
    hazardBP.Q.value = 5;
    this.hazardBP = hazardBP;
    hazardSrc.connect(hazardBP).connect(this.hazardGain).connect(this.master);

    // --- Ambient arena hum (distant electrical buzz) ---
    const hum = ctx.createOscillator();
    hum.type = 'sawtooth';
    hum.frequency.value = 55;
    const humF = ctx.createBiquadFilter();
    humF.type = 'lowpass';
    humF.frequency.value = 180;
    const humG = ctx.createGain();
    humG.gain.value = 0.025;
    hum.connect(humF).connect(humG).connect(this.master);
    hum.start();

    // --- Remote engines: one cheap voice per AI car (distance-attenuated by the caller) ---
    this.remotes = [0, 1, 2].map((i) => {
      const a = ctx.createOscillator();
      a.type = 'sawtooth';
      const b = ctx.createOscillator();
      b.type = 'square';
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 500;
      lp.Q.value = 2;
      const g = ctx.createGain();
      g.gain.value = 0;
      const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
      const bg = ctx.createGain();
      bg.gain.value = 0.5;
      a.connect(lp);
      b.connect(bg).connect(lp);
      lp.connect(g);
      if (pan) g.connect(pan).connect(this.master); else g.connect(this.master);
      a.start();
      b.start();
      return { a, b, lp, g, detune: 1 + i * 0.045 };
    });
    this._nextAmbient = 0;

    this.enabled = true;
  }

  /** list: [{rpmN 0..1, throttle 0..1, vol 0..1}] — one entry per AI car (extra voices are silenced). */
  updateRemotes(list) {
    if (!this.enabled) return;
    const t = this.ctx.currentTime;
    this.remotes.forEach((r, i) => {
      const s = list[i];
      if (!s || s.vol < 0.01) { r.g.gain.setTargetAtTime(0, t, 0.1); return; }
      const f = (900 + s.rpmN * 6500) / 60 * 3 * 0.5 * r.detune;
      r.a.frequency.setTargetAtTime(f, t, 0.05);
      r.b.frequency.setTargetAtTime(f * 0.5, t, 0.05);
      r.lp.frequency.setTargetAtTime(280 + s.throttle * 700 + s.rpmN * 900, t, 0.08);
      r.g.gain.setTargetAtTime(s.vol * (0.05 + s.throttle * 0.05), t, 0.08);
    });
  }

  /** Freeze/unfreeze all audio (pause menu). */
  pause() { if (this.ctx && this.ctx.state === 'running') this.ctx.suspend(); }
  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }

  _tone(freq, dur, { type = 'square', vol = 0.1, slideTo = null, delay = 0 } = {}) {
    const ctx = this.ctx;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.03);
  }

  /** Menu / UI sounds: 'move' | 'confirm' | 'back' | 'pause' */
  ui(name) {
    if (!this.enabled) return;
    if (name === 'move') this._tone(620, 0.06, { type: 'triangle', vol: 0.08, slideTo: 760 });
    else if (name === 'confirm') { this._tone(520, 0.08, { type: 'triangle', vol: 0.1 }); this._tone(780, 0.12, { type: 'triangle', vol: 0.1, delay: 0.06 }); }
    else if (name === 'back') this._tone(520, 0.1, { type: 'triangle', vol: 0.09, slideTo: 340 });
    else if (name === 'pause') this._tone(440, 0.09, { type: 'triangle', vol: 0.09, slideTo: 330 });
  }

  _noiseBurst({ freq = 1200, q = 1, dur = 0.3, vol = 0.3, type = 'bandpass', sweepTo = null, delay = 0 }) {
    const ctx = this.ctx;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(freq, t);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.05);
  }

  missileLaunch(volume = 1) {
    if (!this.enabled || volume < 0.02) return;
    this._noiseBurst({ freq: 500, q: 0.9, dur: 0.7, vol: 0.34 * volume, sweepTo: 3200 });
    this._tone(140, 0.4, { type: 'sawtooth', vol: 0.16 * volume, slideTo: 60 });
  }

  mineDrop(volume = 1) {
    if (!this.enabled || volume < 0.02) return;
    this._tone(210, 0.12, { type: 'triangle', vol: 0.2 * volume, slideTo: 90 });
    this._noiseBurst({ freq: 1800, q: 2, dur: 0.1, vol: 0.12 * volume, type: 'highpass' });
  }

  mineArm(volume = 1) {
    if (!this.enabled || volume < 0.02) return;
    this._tone(1500, 0.07, { type: 'square', vol: 0.07 * volume });
    this._tone(1500, 0.07, { type: 'square', vol: 0.07 * volume, delay: 0.12 });
  }

  scatter(volume = 1) {
    if (!this.enabled || volume < 0.02) return;
    this._noiseBurst({ freq: 3200, q: 0.5, dur: 0.22, vol: 0.5 * volume, type: 'lowpass', sweepTo: 500 });
    this._tone(130, 0.22, { type: 'sine', vol: 0.5 * volume, slideTo: 40 });
    this._noiseBurst({ freq: 900, q: 1.2, dur: 0.5, vol: 0.14 * volume, delay: 0.05 });
  }

  laser(volume = 1) {
    if (!this.enabled || volume < 0.02) return;
    this._tone(2400, 0.32, { type: 'sawtooth', vol: 0.13 * volume, slideTo: 380 });
    this._tone(1200, 0.34, { type: 'square', vol: 0.06 * volume, slideTo: 190 });
    this._noiseBurst({ freq: 5000, q: 0.8, dur: 0.18, vol: 0.12 * volume, type: 'highpass' });
  }

  /** Occasional distant industrial ambience (clangs, low horn) layered over the wind/hum bed. */
  _ambientTick(t) {
    if (t < this._nextAmbient) return;
    this._nextAmbient = t + 7 + Math.random() * 9;
    if (Math.random() < 0.6) {
      const f = 180 + Math.random() * 260;
      this._tone(f, 1.4, { type: 'triangle', vol: 0.018, slideTo: f * 0.97 });
      this._tone(f * 2.76, 0.9, { type: 'sine', vol: 0.008 });
    } else {
      this._tone(96, 1.9, { type: 'sawtooth', vol: 0.012, slideTo: 90 });
    }
  }

  _noiseBuffer(seconds) {
    const ctx = this.ctx;
    const buf = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  _loopNoise() {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    src.start();
    return src;
  }

  _driveCurve(k) {
    const n = 1024;
    const c = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      c[i] = Math.tanh(x * k) / Math.tanh(k);
    }
    return c;
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  /** state: { rpm, maxRpm, throttle, skid, speed, grounded, boost, hazard } */
  update(state) {
    if (!this.enabled) return;
    const t = this.ctx.currentTime;
    const rpmN = Math.min(1, state.rpm / state.maxRpm);
    const fire = (state.rpm / 60) * 3; // 6-cylinder firing frequency
    for (const o of this.oscs) o.osc.frequency.setTargetAtTime(fire * o.mul, t, 0.03);
    this.chug.frequency.setTargetAtTime(fire * 0.25, t, 0.03);
    this.engFilter.frequency.setTargetAtTime(350 + state.throttle * 1800 + rpmN * 1600, t, 0.05);
    this.engGain.gain.setTargetAtTime(0.16 + state.throttle * 0.16 + rpmN * 0.08, t, 0.06);

    const skid = state.grounded ? state.skid : 0;
    this.tireGain.gain.setTargetAtTime(Math.min(0.5, skid * 0.55), t, 0.05);
    this.tireBP.frequency.setTargetAtTime(1100 + Math.min(1, state.speed / 30) * 700, t, 0.1);
    this.squeal.frequency.setTargetAtTime(700 + Math.min(1, state.speed / 30) * 300 + Math.sin(t * 13) * 25, t, 0.05);

    const s = Math.min(1, state.speed / 40);
    this.windGain.gain.setTargetAtTime(s * s * 0.22, t, 0.1);
    this.windLP.frequency.setTargetAtTime(300 + s * 1400, t, 0.1);

    const boostT = state.boost ? 1 : 0;
    this.boostGain.gain.setTargetAtTime(boostT * 0.3, t, 0.08);
    this.boostBP.frequency.setTargetAtTime(700 + boostT * 1500 + s * 300, t, 0.12);
    this.boostPulseGain.gain.setTargetAtTime(boostT * 0.05, t, 0.08);

    this._ambientTick(t);

    const hazT = state.hazard ? 1 : 0;
    this.hazardGain.gain.setTargetAtTime(hazT * 0.16, t, 0.06);
    this.hazardBP.frequency.setTargetAtTime(2200 + Math.sin(t * 41) * 500 + Math.sin(t * 97) * 250, t, 0.015);
  }

  /** Collision thump; strength 0..1 */
  impact(strength, metallic = true) {
    if (!this.enabled) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const s = Math.min(1, strength);

    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 900 + s * 2500;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5 * s + 0.05, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18 + s * 0.25);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random() * 1.5);
    src.stop(t + 0.5);

    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(110 + s * 40, t);
    o.frequency.exponentialRampToValueAtTime(38, t + 0.25);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.0001, t);
    og.gain.exponentialRampToValueAtTime(0.6 * s + 0.05, t + 0.008);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    o.connect(og).connect(this.master);
    o.start(t);
    o.stop(t + 0.35);

    if (metallic && s > 0.25) {
      // Metallic clang partials
      for (const fr of [523, 787, 1210]) {
        const m = ctx.createOscillator();
        m.type = 'triangle';
        m.frequency.value = fr * (0.9 + Math.random() * 0.2);
        const mg = ctx.createGain();
        mg.gain.setValueAtTime(0.0001, t);
        mg.gain.exponentialRampToValueAtTime(0.06 * s, t + 0.004);
        mg.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
        m.connect(mg).connect(this.master);
        m.start(t);
        m.stop(t + 0.45);
      }
    }
  }

  /** Cannon shot: a short kinetic "crack" (filtered noise) plus a fast descending tone for punch. */
  fire(volume = 1) {
    if (!this.enabled || volume < 0.02) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;

    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 900;
    const f2 = ctx.createBiquadFilter();
    f2.type = 'lowpass';
    f2.frequency.value = 6000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.28 * volume + 0.0002, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    src.connect(f).connect(f2).connect(g).connect(this.master);
    src.start(t, Math.random() * 1.5);
    src.stop(t + 0.15);

    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(1400, t);
    o.frequency.exponentialRampToValueAtTime(220, t + 0.07);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.0001, t);
    og.gain.exponentialRampToValueAtTime(0.22 * volume + 0.0002, t + 0.003);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
    o.connect(og).connect(this.master);
    o.start(t);
    o.stop(t + 0.1);
  }

  /** Bigger boom for a target/vehicle kill: deep sub-thump + longer noise decay + a few crackle pops. */
  explosion(strength = 1) {
    if (!this.enabled) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const s = Math.min(1, strength);

    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(2200, t);
    f.frequency.exponentialRampToValueAtTime(300, t + 0.6);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.55 * s + 0.15, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.7 + s * 0.3);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random() * 1.5);
    src.stop(t + 1.1);

    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(85, t);
    o.frequency.exponentialRampToValueAtTime(28, t + 0.4);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.0001, t);
    og.gain.exponentialRampToValueAtTime(0.7 * s + 0.1, t + 0.012);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
    o.connect(og).connect(this.master);
    o.start(t);
    o.stop(t + 0.6);

    // Secondary debris crackle pops, staggered
    for (let i = 0; i < 5; i++) {
      const dt = 0.08 + Math.random() * 0.35;
      const cs = ctx.createBufferSource();
      cs.buffer = this.noiseBuf;
      const cf = ctx.createBiquadFilter();
      cf.type = 'bandpass';
      cf.frequency.value = 500 + Math.random() * 2000;
      cf.Q.value = 1.5;
      const cg = ctx.createGain();
      cg.gain.setValueAtTime(0.0001, t + dt);
      cg.gain.exponentialRampToValueAtTime(0.12 * s, t + dt + 0.005);
      cg.gain.exponentialRampToValueAtTime(0.0001, t + dt + 0.1);
      cs.connect(cf).connect(cg).connect(this.master);
      cs.start(t + dt, Math.random() * 1.5);
      cs.stop(t + dt + 0.15);
    }
  }

  /**
   * A car being destroyed: the explosion plus a long sub-bass drop, a tearing-metal screech, a rumbling fire tail and
   * scattered debris clatter landing over the next second. `volume` is distance attenuation (1 = at the listener).
   */
  wreck(volume = 1) {
    if (!this.enabled || volume < 0.02) return;
    const s = Math.min(1, volume);
    this.explosion(0.5 + s * 0.5);
    // deep drop
    this._tone(62, 1.2, { type: 'sine', vol: 0.55 * s, slideTo: 22 });
    // tearing metal
    this._tone(780, 0.5, { type: 'sawtooth', vol: 0.05 * s, slideTo: 260, delay: 0.03 });
    this._noiseBurst({ freq: 2600, q: 6, dur: 0.45, vol: 0.12 * s, sweepTo: 700, delay: 0.02 });
    // fire rumble tail
    this._noiseBurst({ freq: 420, q: 0.7, dur: 1.8, vol: 0.2 * s, type: 'lowpass', sweepTo: 140, delay: 0.1 });
    // debris landing: metallic ticks and thuds
    for (let i = 0; i < 9; i++) {
      const d = 0.45 + Math.random() * 1.1;
      const fr = 900 + Math.random() * 2600;
      this._tone(fr, 0.12, { type: 'triangle', vol: (0.02 + Math.random() * 0.03) * s, slideTo: fr * 0.8, delay: d });
      if (i % 3 === 0) this._noiseBurst({ freq: 300, q: 1, dur: 0.12, vol: 0.12 * s, type: 'lowpass', delay: d });
    }
  }

  /** Secondary fuel-tank pop after a wreck. */
  pop(volume = 1) {
    if (!this.enabled || volume < 0.02) return;
    this._noiseBurst({ freq: 1400, q: 0.6, dur: 0.35, vol: 0.28 * volume, type: 'lowpass', sweepTo: 200 });
    this._tone(90, 0.3, { type: 'sine', vol: 0.3 * volume, slideTo: 35 });
  }

  /** Kill-confirm sting for the player: a bright rising two-note ping over the explosion. */
  killConfirm() {
    if (!this.enabled) return;
    this._tone(990, 0.12, { type: 'triangle', vol: 0.12 });
    this._tone(1480, 0.22, { type: 'triangle', vol: 0.12, delay: 0.08 });
    this._tone(1980, 0.28, { type: 'sine', vol: 0.06, delay: 0.08 });
  }

  /** Match countdown: short beeps for 3-2-1, a bright two-tone chord for GO. */
  countdown(go = false) {
    if (!this.enabled) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const freqs = go ? [880, 1320] : [520];
    for (const f of freqs) {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.12, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + (go ? 0.55 : 0.18));
      o.connect(g).connect(this.master);
      o.start(t);
      o.stop(t + 0.6);
    }
  }

  /** End-of-match stinger: rising major arpeggio for a win, falling minor one for a loss. */
  stinger(win) {
    if (!this.enabled) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const notes = win ? [523.25, 659.25, 783.99, 1046.5] : [440, 349.23, 293.66, 220];
    notes.forEach((f, i) => {
      const st = t + i * 0.13;
      for (const [type, mul, vol] of [['sawtooth', 1, 0.07], ['square', 0.5, 0.05]]) {
        const o = ctx.createOscillator();
        o.type = type;
        o.frequency.value = f * mul;
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 2400;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, st);
        g.gain.exponentialRampToValueAtTime(vol, st + 0.015);
        g.gain.exponentialRampToValueAtTime(0.0001, st + (i === notes.length - 1 ? 0.9 : 0.25));
        o.connect(lp).connect(g).connect(this.master);
        o.start(st);
        o.stop(st + 1);
      }
    });
  }

  /** UI blip */
  blip(freq = 880, dur = 0.08, vol = 0.12) {
    if (!this.enabled) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(freq * 1.5, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  /** Pickup collected: short 2-note ascending chime, pitch varies by kind. `volume` lets remote (AI) pickups attenuate. */
  pickup(kind = 'health', volume = 1) {
    if (!this.enabled || volume < 0.02) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const base = { health: 587, boost: 740, overcharge: 466, missile: 392, mine: 349, scatter: 415, laser: 831 }[kind] ?? 587;
    for (const [i, f] of [base, base * 1.5].entries()) {
      const st = t + i * 0.07;
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, st);
      g.gain.exponentialRampToValueAtTime(0.24 * volume, st + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, st + 0.16);
      o.connect(g).connect(this.master);
      o.start(st);
      o.stop(st + 0.2);
    }
  }

  /** Boost pad crossed: bright rising sweep, distinct timbre from the pickup chime. */
  boostPadChime(volume = 1) {
    if (!this.enabled || volume < 0.02) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(300, t);
    o.frequency.exponentialRampToValueAtTime(1600, t + 0.18);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 4200;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.26 * volume, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    o.connect(lp).connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.25);
  }

  /** Whoosh for respawn / recover. */
  whoosh() {
    if (!this.enabled) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 1.2;
    f.frequency.setValueAtTime(300, t);
    f.frequency.exponentialRampToValueAtTime(3000, t + 0.35);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.35, t + 0.1);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    src.connect(f).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + 0.6);
  }
}
