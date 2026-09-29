// DOM-based HUD and screens. All styling lives in styles.css.
// Keyboard/gamepad navigation of these screens is driven by Game (via Input), not by listeners here, so there is
// exactly one input path; the screens only handle mouse clicks themselves.
import { AI_PROFILES } from '../ai/AIController.js';
import { CAR_TYPES, CAR_KEYS } from '../vehicle/CarTypes.js';
import { SECONDARY } from '../combat/SecondaryWeapons.js';
import { MAPS, MAP_KEYS } from '../world/maps/index.js';
import { PRIMARY, PRIMARY_KEYS } from '../combat/PrimaryWeapons.js';

const DIFF_KEYS = ['easy', 'normal', 'hard'];

// Pickup legend on the title screen (color, label).
const LEGEND = [
  ['#4fd16a', 'REPAIR'], ['#3aa7ff', 'NITRO'], ['#ffd23a', 'OVERCHARGE'],
  ['#ff8a3c', 'MISSILE'], ['#ff4b4b', 'MINES'], ['#ffc04a', 'FLAK'], ['#5cd6ff', 'LASER'],
];

// Small stroke glyphs (24x24 viewBox) for the kill feed and weapon panel.
const ICONS = {
  cannon: '<path d="M2 12h13"/><path d="M15 7l7 5-7 5z" fill="currentColor"/>',
  ram: '<path d="M4 6l7 6-7 6M12 6l7 6-7 6"/>',
  missile: '<path d="M12 2c3 3 4 7 4 11l-4 3-4-3c0-4 1-8 4-11z" fill="currentColor"/><path d="M8 14l-4 5h4M16 14l4 5h-4"/>',
  mine: '<circle cx="12" cy="12" r="5" fill="currentColor"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4M5 5l3 3M16 16l3 3M19 5l-3 3M8 16l-3 3"/>',
  scatter: '<path d="M3 12l18-7M3 12h18M3 12l18 7"/>',
  laser: '<circle cx="6" cy="12" r="3" fill="currentColor"/><path d="M10 12h12"/><path d="M18 8l4 4-4 4"/>',
  hazard: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18v1"/>',
  minigun: '<path d="M2 8h14M2 12h14M2 16h14"/><path d="M16 6v12" /><path d="M19 9l3 3-3 3"/>',
  shotgun: '<path d="M3 9h7M3 15h7M3 12h7"/><path d="M13 12l8-6M13 12h9M13 12l8 6"/>',
  sniper: '<circle cx="12" cy="12" r="6"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5"/><circle cx="12" cy="12" r="1" fill="currentColor"/>',
  breacher: '<circle cx="9" cy="12" r="5" fill="currentColor"/><path d="M14 12h8"/><path d="M17 8l4 4-4 4"/>',
  flame: '<path d="M12 2c1 4 6 6 6 12a6 6 0 0 1-12 0c0-3 2-4 3-7 1 2 2 2 3 1z" fill="currentColor"/>',
};
ICONS.shell = ICONS.breacher;
const icon = (name, cls = 'kf-icon') => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] ?? ICONS.cannon}</svg>`;

const ARC_R = 80;
const ARC_C = 2 * Math.PI * ARC_R;
const ARC_L = (ARC_C * 240) / 360;
const RPM_R = 66;
const RPM_C = 2 * Math.PI * RPM_R;
const RPM_L = (RPM_C * 240) / 360;
const MAX_KMH = 160;

const HP_SEGMENTS = 10;

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

function gaugeSVG() {
  let ticks = '';
  for (let i = 0; i <= 16; i++) {
    const a = ((150 + (240 * i) / 16) * Math.PI) / 180;
    const major = i % 2 === 0;
    const r1 = major ? 88 : 90, r2 = 95;
    ticks += `<line x1="${100 + Math.cos(a) * r1}" y1="${100 + Math.sin(a) * r1}" x2="${100 + Math.cos(a) * r2}" y2="${100 + Math.sin(a) * r2}" class="${major ? 'tick major' : 'tick'}"/>`;
    if (major) {
      const rl = 108;
      ticks += `<text x="${100 + Math.cos(a) * rl}" y="${100 + Math.sin(a) * rl + 3}" class="tick-label">${(i / 16) * MAX_KMH}</text>`;
    }
  }
  return `
  <svg viewBox="-20 -20 240 240" class="gauge-svg">
    <defs>
      <linearGradient id="spdGrad" x1="0" y1="1" x2="1" y2="0">
        <stop offset="0%" stop-color="#6fc3ff"/>
        <stop offset="62%" stop-color="#e9f2ff"/>
        <stop offset="100%" stop-color="#ff7a2f"/>
      </linearGradient>
      <linearGradient id="rpmGrad" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stop-color="#f5b83d"/>
        <stop offset="100%" stop-color="#e5484d"/>
      </linearGradient>
      <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="3" result="b"/>
        <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>
    </defs>
    <circle cx="100" cy="100" r="98" class="gauge-bg"/>
    ${ticks}
    <circle cx="100" cy="100" r="${ARC_R}" class="arc-track" stroke-dasharray="${ARC_L} ${ARC_C}" transform="rotate(150 100 100)"/>
    <circle cx="100" cy="100" r="${ARC_R}" class="arc-fill" id="spdArc" stroke-dasharray="0 ${ARC_C}" transform="rotate(150 100 100)" filter="url(#glow)"/>
    <circle cx="100" cy="100" r="${RPM_R}" class="rpm-track" stroke-dasharray="${RPM_L} ${RPM_C}" transform="rotate(150 100 100)"/>
    <circle cx="100" cy="100" r="${RPM_R}" class="rpm-fill" id="rpmArc" stroke-dasharray="0 ${RPM_C}" transform="rotate(150 100 100)"/>
  </svg>`;
}

export class HUD {
  constructor(root) {
    this.root = root;
    this.helpVisible = true;
    this.onSfx = null;          // (name) => void — Game routes UI sounds through the audio engine
    this.onPauseAction = null;  // ('resume' | 'menu') => void
    this._buildLoading();
    this._buildStart();
    this._buildHud();
    this._buildResults();
    this._buildPause();
    this._lastSpeed = -1;
    this._lastGear = null;
  }

  // ---------------------------------------------------------------- Loading
  _buildLoading() {
    this.loading = el('div', 'screen loading-screen');
    this.loading.innerHTML = `
      <div class="logo small"><span class="logo-a">WRECK</span><span class="logo-b">FIELD</span></div>
      <div class="load-bar"><div class="load-fill"></div></div>
      <div class="load-text">INITIALIZING PHYSICS</div>`;
    this.root.appendChild(this.loading);
    this.loadFill = this.loading.querySelector('.load-fill');
    this.loadText = this.loading.querySelector('.load-text');
  }

  setLoading(p, text) {
    this.loadFill.style.transform = `scaleX(${p})`;
    if (text) this.loadText.textContent = text;
  }

  hideLoading() {
    this.loading.classList.add('out');
    setTimeout(() => this.loading.remove(), 900);
  }

  // ---------------------------------------------------------------- Start
  _buildStart() {
    this.start = el('div', 'screen start-screen hidden');
    this.start.innerHTML = `
      <div class="start-inner">
        <div class="kicker">VEHICLE COMBAT ARENA</div>
        <div class="logo big"><span class="logo-a">WRECK</span><span class="logo-b">FIELD</span></div>
        <div class="section-label">SELECT VEHICLE <span class="hint"><kbd>←</kbd><kbd>→</kbd></span></div>
        <div class="car-row" id="carRow">
          ${CAR_KEYS.map((k) => `
            <button class="car-card" data-key="${k}">
              <div class="cc-name">${CAR_TYPES[k].name}</div>
              <div class="cc-role">${CAR_TYPES[k].role}</div>
            </button>`).join('')}
        </div>
        <div class="car-detail" id="carDetail"></div>
        <div class="section-label">PRIMARY WEAPON <span class="hint"><kbd>Z</kbd><kbd>X</kbd></span></div>
        <div class="wp-row" id="wpRow">
          ${PRIMARY_KEYS.map((k) => `
            <button class="wp-card" data-key="${k}" style="--wc:${PRIMARY[k].color}">
              ${icon(k === 'cannon' ? 'cannon' : k, 'wpc-icon')}
              <div class="wpc-name">${PRIMARY[k].short}</div>
            </button>`).join('')}
        </div>
        <div class="wp-blurb" id="wpBlurb"></div>
        <div class="section-label">SELECT ARENA <span class="hint"><kbd>Q</kbd><kbd>E</kbd></span></div>
        <div class="map-row" id="mapRow">
          ${MAP_KEYS.map((k) => {
            const m = MAPS[k];
            const [a, b, c] = m.thumb;
            return `
            <button class="map-card" data-key="${k}">
              <div class="mc-thumb" style="background:linear-gradient(180deg,${a} 0%,${b} 52%,${c} 53%,${c} 100%)"></div>
              <div class="mc-name">${m.short ?? m.name}</div>
              <div class="mc-tags">${m.tags.slice(0, 2).join(' · ')}</div>
            </button>`;
          }).join('')}
        </div>
        <div class="map-blurb" id="mapBlurb"></div>
        <div class="section-label">DIFFICULTY <span class="hint"><kbd>↑</kbd><kbd>↓</kbd></span></div>
        <div class="diff-row" id="diffRow">
          ${DIFF_KEYS.map((k, i) => `
            <button class="diff-card" data-key="${k}">
              <div class="dc-top"><span class="dc-label">${AI_PROFILES[k].label}</span><span class="dc-tier">${'■'.repeat(i + 1)}${'□'.repeat(2 - i)}</span></div>
              <div class="dc-blurb">${AI_PROFILES[k].blurb}</div>
            </button>`).join('')}
        </div>
        <button class="btn-primary" id="btnDrive"><span>ENTER THE PIT</span><kbd>ENTER</kbd></button>
        <div class="legend">
          ${LEGEND.map(([color, label]) => `<span class="lg-item"><i style="background:${color}"></i>${label}</span>`).join('')}
        </div>
        <div class="start-controls">
          <div><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd><span>DRIVE</span></div>
          <div><kbd class="wide">CLICK</kbd><span>FIRE PRIMARY</span></div>
          <div><kbd>E</kbd><span>SECONDARY</span></div>
          <div><kbd class="wide">SHIFT</kbd><span>NITRO</span></div>
          <div><kbd class="wide">SPACE</kbd><span>HANDBRAKE</span></div>
          <div><kbd>ESC</kbd><span>PAUSE</span></div>
        </div>
      </div>
      <div class="build-tag">GAMEPAD SUPPORTED</div>
      <div class="touch-note">WRECKFIELD NEEDS A KEYBOARD OR GAMEPAD</div>`;
    this.root.appendChild(this.start);
    this.diffCards = [...this.start.querySelectorAll('.diff-card')];
    this.carCards = [...this.start.querySelectorAll('.car-card')];
    this.carDetail = this.start.querySelector('#carDetail');
    this.wpCards = [...this.start.querySelectorAll('.wp-card')];
    this.wpBlurb = this.start.querySelector('#wpBlurb');
    this.wpIndex = 0;
    this._onWp = null;
    this.wpCards.forEach((card, i) => card.addEventListener('click', () => this.selectWeapon(i)));
    this._renderWeapon();
    this.mapCards = [...this.start.querySelectorAll('.map-card')];
    this.mapBlurb = this.start.querySelector('#mapBlurb');
    this.diffIndex = 1;
    this.carIndex = 0;
    this.mapIndex = 0;
    this._onCar = null;
    this._onMap = null;
    this.mapCards.forEach((card, i) => card.addEventListener('click', () => this.selectMap(i)));
    this._renderMap();
    this.diffCards.forEach((card, i) => card.addEventListener('click', () => this.selectDifficulty(i)));
    this.carCards.forEach((card, i) => card.addEventListener('click', () => this.selectCar(i)));
    this.start.querySelector('#btnDrive').addEventListener('click', () => this.pressStart());
    this._renderDifficulty();
    this._renderCar();
  }

  get difficulty() {
    return DIFF_KEYS[this.diffIndex];
  }

  selectDifficulty(i) {
    const next = (i + DIFF_KEYS.length) % DIFF_KEYS.length;
    if (next !== this.diffIndex) this.onSfx?.('move');
    this.diffIndex = next;
    this._renderDifficulty();
  }

  stepDifficulty(delta) {
    this.selectDifficulty(this.diffIndex + delta);
  }

  _renderDifficulty() {
    this.diffCards.forEach((c, i) => c.classList.toggle('selected', i === this.diffIndex));
  }

  /** Register the menu car picker: `onSelect(carKey)` fires when the highlighted vehicle changes. */
  setCarChoices(currentKey, onSelect) {
    this._onCar = onSelect;
    this.carIndex = Math.max(0, CAR_KEYS.indexOf(currentKey));
    this._renderCar();
  }

  selectCar(i) {
    const next = (i + CAR_KEYS.length) % CAR_KEYS.length;
    if (next !== this.carIndex) this.onSfx?.('move');
    this.carIndex = next;
    this._renderCar();
    this._onCar?.(CAR_KEYS[this.carIndex]);
  }

  stepCar(delta) {
    this.selectCar(this.carIndex + delta);
  }

  /** Register the menu weapon picker: `onSelect(weaponKey)` fires when the highlighted primary weapon changes. */
  setWeaponChoices(currentKey, onSelect) {
    this._onWp = onSelect;
    this.wpIndex = Math.max(0, PRIMARY_KEYS.indexOf(currentKey));
    this._renderWeapon();
  }

  selectWeapon(i) {
    const next = (i + PRIMARY_KEYS.length) % PRIMARY_KEYS.length;
    if (next === this.wpIndex) return;
    this.onSfx?.('move');
    this.wpIndex = next;
    this._renderWeapon();
    this._onWp?.(PRIMARY_KEYS[this.wpIndex]);
  }

  stepWeapon(delta) {
    this.selectWeapon(this.wpIndex + delta);
  }

  _renderWeapon() {
    this.wpCards.forEach((c, i) => c.classList.toggle('selected', i === this.wpIndex));
    const d = PRIMARY[PRIMARY_KEYS[this.wpIndex]];
    this.wpBlurb.innerHTML = `<b>${d.name}</b> · ${d.role} — ${d.desc}`;
  }

  /** In-match readout of the primary weapon: name, icon, reload / wind-up bar (0..1). */
  setPrimaryBadge(key) {
    const d = PRIMARY[key] ?? PRIMARY.cannon;
    this.primaryBadge.style.setProperty('--wc', d.color);
    this.primaryBadge.classList.toggle('bar', d.hud !== 'none');
    this.primaryBadge.querySelector('.pb-name').textContent = d.name;
    this.primaryBadge.querySelector('.pb-icon').innerHTML = icon(key, 'pb-svg');
    this._pbKind = d.hud;
  }

  setPrimaryFrac(f) {
    if (this._pbLast === f) return;
    this._pbLast = f;
    this.pbFill.style.transform = `scaleX(${f})`;
    this.primaryBadge.classList.toggle('ready', f >= 0.999);
  }

  /** Register the menu arena picker: `onSelect(mapId)` fires when the highlighted arena changes. */
  setMapChoices(currentId, onSelect) {
    this._onMap = onSelect;
    this.mapIndex = Math.max(0, MAP_KEYS.indexOf(currentId));
    this._renderMap();
  }

  selectMap(i) {
    const next = (i + MAP_KEYS.length) % MAP_KEYS.length;
    if (next === this.mapIndex) return;
    this.onSfx?.('move');
    this.mapIndex = next;
    this._renderMap();
    this._onMap?.(MAP_KEYS[this.mapIndex]);
  }

  stepMap(delta) {
    this.selectMap(this.mapIndex + delta);
  }

  _renderMap() {
    this.mapCards.forEach((c, i) => c.classList.toggle('selected', i === this.mapIndex));
    this.mapBlurb.textContent = MAPS[MAP_KEYS[this.mapIndex]].blurb;
  }

  /** Brief veil while a new arena is (synchronously) built. */
  showMapLoading(on) {
    if (!this.mapVeil) {
      this.mapVeil = el('div', 'map-veil', '<span>BUILDING ARENA</span>');
      this.root.appendChild(this.mapVeil);
    }
    this.mapVeil.classList.toggle('on', !!on);
  }

  _renderCar() {
    this.carCards.forEach((c, i) => c.classList.toggle('selected', i === this.carIndex));
    const key = CAR_KEYS[this.carIndex];
    const t = CAR_TYPES[key];
    const bar = (label, v, lo, hi) => {
      const pct = Math.round(18 + 82 * Math.min(1, Math.max(0, (v - lo) / (hi - lo))));
      return `<div class="cd-stat"><span>${label}</span><div class="cd-bar"><i style="width:${pct}%"></i></div></div>`;
    };
    this.carDetail.innerHTML = `
      <div class="cd-blurb">${t.blurb}</div>
      <div class="cd-stats">
        ${bar('ARMOR', t.stats.health, 0.85, 1.32)}
        ${bar('POWER', t.stats.engine, 0.98, 1.15)}
        ${bar('SPEED', t.stats.top, 0.92, 1.08)}
        ${bar('WEIGHT', t.stats.mass, 0.85, 1.22)}
      </div>`;
  }

  get startVisible() {
    return !!this._onStart;
  }

  /** Show the title screen; `onStart(difficultyKey)` fires on Enter / click / gamepad Start. */
  showStart(onStart) {
    clearTimeout(this._startHideTimer);
    this._onStart = onStart;
    this.start.classList.remove('hidden', 'out');
  }

  pressStart() {
    const cb = this._onStart;
    if (!cb || this.mapVeil?.classList.contains('on')) return; // arena still building
    this._onStart = null;
    this.onSfx?.('confirm');
    this.start.classList.add('out');
    this._startHideTimer = setTimeout(() => this.start.classList.add('hidden'), 700);
    cb(this.difficulty);
  }

  // ---------------------------------------------------------------- HUD
  _buildHud() {
    this.hud = el('div', 'hud hidden');
    this.hud.innerHTML = `
      <div class="hud-brand"><span class="logo-a">WRECK</span><span class="logo-b">FIELD</span></div>
      <div class="scoreboard" id="scoreboard">
        <div class="sb-list" id="sbList"></div>
        <div class="sb-sub"><span id="sbGoal">FIRST TO 5</span> · <span id="sbTime">0:00</span></div>
      </div>
      <div class="countdown" id="countdown"><span id="countdownText">3</span></div>
      <div class="threat-indicators" id="threatIndicators"></div>
      <div class="health-panel" id="healthPanel">
        <svg class="hp-icon" viewBox="0 0 24 26"><path d="M12 1l10 3.5v7c0 6-4.5 10.5-10 13.5C6.5 21 2 16.5 2 10.5v-7L12 1z"/></svg>
        <div class="hp-body">
          <div class="hp-label">HULL</div>
          <div class="hp-bar"><div class="hp-segments" id="hpSegments"></div></div>
        </div>
        <div class="hp-num"><span id="hpNum">200</span></div>
      </div>
      <div class="crosshair" id="crosshair">
        <div class="ch-tick ch-top"></div><div class="ch-tick ch-bottom"></div>
        <div class="ch-tick ch-left"></div><div class="ch-tick ch-right"></div>
        <div class="ch-dot"></div>
        <div class="hitmarker" id="hitmarker">
          <span></span><span></span><span></span><span></span>
        </div>
      </div>
      <div class="kill-banner" id="killBanner"><span id="killText">TARGET DESTROYED</span></div>
      <div class="damage-flash" id="damageFlash"></div>
      <div class="wreck-overlay" id="wreckOverlay">
        <div class="wo-title">WRECKED</div>
        <div class="wo-by" id="wreckBy"></div>
        <div class="wo-bar"><i></i></div>
        <div class="wo-sub">RESPAWNING</div>
      </div>
      <div class="gauge">
        ${gaugeSVG()}
        <div class="gauge-readout">
          <div class="gauge-speed" id="spdNum">0</div>
          <div class="gauge-unit">KM/H</div>
          <div class="gauge-gear"><span id="gearNum">N</span></div>
        </div>
        <div class="gauge-status" id="gaugeStatus"></div>
      </div>
      <div class="boost-panel" id="boostPanel">
        <svg class="boost-icon" viewBox="0 0 24 24"><path d="M13 2L3 14h7l-1 8 11-14h-7l1-6z"/></svg>
        <div class="boost-bar"><div class="boost-fill" id="boostFill"></div></div>
      </div>
      <div class="weapon-panel hidden" id="weaponPanel">
        <div class="wp-icon" id="wpIcon"></div>
        <div class="wp-body">
          <div class="wp-name" id="wpName">MISSILE</div>
          <div class="wp-pips" id="wpPips"></div>
        </div>
        <kbd>E</kbd>
      </div>
      <div class="primary-badge" id="primaryBadge">
        <span class="pb-icon"></span>
        <div class="pb-body"><div class="pb-name">AUTOCANNON</div><div class="pb-bar"><i id="pbFill"></i></div></div>
      </div>
      <div class="kill-feed" id="killFeed"></div>
      <div class="pickup-toast" id="pickupToast"><span id="pickupToastText"></span></div>
      <div class="controls-card" id="helpCard">
        <div class="cc-title">CONTROLS <span class="cc-hint">H TO HIDE</span></div>
        <div class="cc-row"><span class="keys"><kbd>W</kbd><kbd>↑</kbd></span><span>ACCELERATE</span></div>
        <div class="cc-row"><span class="keys"><kbd>S</kbd><kbd>↓</kbd></span><span>BRAKE / REVERSE</span></div>
        <div class="cc-row"><span class="keys"><kbd>A</kbd><kbd>D</kbd></span><span>STEER · AIR YAW</span></div>
        <div class="cc-row"><span class="keys"><kbd class="wide">SPACE</kbd></span><span>HANDBRAKE / DRIFT</span></div>
        <div class="cc-row"><span class="keys"><kbd class="wide">CLICK</kbd></span><span>FIRE PRIMARY</span></div>
        <div class="cc-row"><span class="keys"><kbd>E</kbd><kbd>R-CLICK</kbd></span><span>SECONDARY</span></div>
        <div class="cc-row"><span class="keys"><kbd class="wide">SHIFT</kbd></span><span>NITRO BOOST</span></div>
        <div class="cc-row"><span class="keys"><kbd>C</kbd></span><span>LOOK BACK</span></div>
        <div class="cc-row"><span class="keys"><kbd>R</kbd></span><span>RECOVER</span></div>
        <div class="cc-row"><span class="keys"><kbd>\`</kbd></span><span>TUNING PANEL</span></div>
      </div>
      <div class="recover-prompt hidden" id="recoverPrompt">
        <div class="rp-icon">⟲</div>
        <div><div class="rp-title">VEHICLE FLIPPED</div><div class="rp-sub">PRESS <kbd>R</kbd> TO RECOVER</div></div>
        <div class="rp-bar"><div class="rp-fill" id="rpFill"></div></div>
      </div>
      <div class="air-badge hidden" id="airBadge">AIRTIME <span id="airNum">0.0</span>s</div>
      <div class="overcharge-badge hidden" id="overchargeBadge">OVERCHARGE <span id="overchargeNum">0.0</span>s</div>
    `;
    this.root.appendChild(this.hud);
    this.primaryBadge = this.hud.querySelector('#primaryBadge');
    this.pbFill = this.hud.querySelector('#pbFill');
    this.spdArc = this.hud.querySelector('#spdArc');
    this.rpmArc = this.hud.querySelector('#rpmArc');
    this.spdNum = this.hud.querySelector('#spdNum');
    this.gearNum = this.hud.querySelector('#gearNum');
    this.status = this.hud.querySelector('#gaugeStatus');
    this.recoverPrompt = this.hud.querySelector('#recoverPrompt');
    this.rpFill = this.hud.querySelector('#rpFill');
    this.helpCard = this.hud.querySelector('#helpCard');
    this.airBadge = this.hud.querySelector('#airBadge');
    this.airNum = this.hud.querySelector('#airNum');
    this._airShown = false;
    this._bestAir = 0;

    this.boostPanel = this.hud.querySelector('#boostPanel');
    this.boostFill = this.hud.querySelector('#boostFill');
    this._lastBoostPct = -1;
    this._lastBoostRaw = undefined;
    this.overchargeBadge = this.hud.querySelector('#overchargeBadge');
    this.overchargeNum = this.hud.querySelector('#overchargeNum');
    this._overchargeShown = false;
    this.pickupToastEl = this.hud.querySelector('#pickupToast');
    this.pickupToastText = this.hud.querySelector('#pickupToastText');
    this.weaponPanel = this.hud.querySelector('#weaponPanel');
    this.wpIcon = this.hud.querySelector('#wpIcon');
    this.wpName = this.hud.querySelector('#wpName');
    this.wpPips = this.hud.querySelector('#wpPips');
    this._wpKey = '';
    this.killFeedEl = this.hud.querySelector('#killFeed');
    this.sbList = this.hud.querySelector('#sbList');
    this.threatContainer = this.hud.querySelector('#threatIndicators');
    this._threatEls = new Map();

    // Combat HUD
    this.healthPanel = this.hud.querySelector('#healthPanel');
    this.hpSegmentsEl = this.hud.querySelector('#hpSegments');
    this.hpNum = this.hud.querySelector('#hpNum');
    for (let i = 0; i < HP_SEGMENTS; i++) this.hpSegmentsEl.appendChild(el('div', 'hp-seg'));
    this.hpSegEls = [...this.hpSegmentsEl.children];
    this._lastHpFilled = -1;
    this.crosshair = this.hud.querySelector('#crosshair');
    this.hitmarker = this.hud.querySelector('#hitmarker');
    this.damageFlashEl = this.hud.querySelector('#damageFlash');
    this.killBannerEl = this.hud.querySelector('#killBanner');
    this.killTextEl = this.hud.querySelector('#killText');
  }

  /** current/max health -> segmented bar + numeric readout + low-hull pulse. */
  setHealth(current, max) {
    const pct = max > 0 ? current / max : 0;
    const filled = Math.round(pct * HP_SEGMENTS);
    if (filled !== this._lastHpFilled) {
      this._lastHpFilled = filled;
      const tier = pct > 0.5 ? 'ok' : pct > 0.22 ? 'warn' : 'crit';
      for (let i = 0; i < HP_SEGMENTS; i++) {
        const seg = this.hpSegEls[i];
        seg.classList.toggle('filled', i < filled);
        seg.className = 'hp-seg' + (i < filled ? ' filled ' + tier : '');
      }
      this.healthPanel.classList.toggle('critical', pct <= 0.22 && pct > 0);
      this.hpNum.textContent = Math.ceil(current);
    }
  }

  /** Brief red vignette pulse when the player takes damage. */
  damageFlash() {
    this.damageFlashEl.classList.remove('pulse');
    void this.damageFlashEl.offsetWidth;
    this.damageFlashEl.classList.add('pulse');
  }

  /** Confirmed-hit feedback on the crosshair (shot connected with a damageable target). */
  hitMarker(kill = false) {
    this.hitmarker.classList.remove('show', 'kill');
    void this.hitmarker.offsetWidth;
    this.hitmarker.classList.add('show');
    if (kill) this.hitmarker.classList.add('kill');
  }

  /** Subtle crosshair kick on every shot fired. */
  crosshairPulse() {
    this.crosshair.classList.remove('fire');
    void this.crosshair.offsetWidth;
    this.crosshair.classList.add('fire');
  }

  /** Centre banner for the player's own kills. */
  killBanner(text) {
    clearTimeout(this._killTimer);
    this.killTextEl.textContent = text;
    this.killBannerEl.classList.remove('show');
    void this.killBannerEl.offsetWidth;
    this.killBannerEl.classList.add('show');
    this._killTimer = setTimeout(() => this.killBannerEl.classList.remove('show'), 1600);
  }

  /** Player destroyed: big "WRECKED" card naming the killer, with a respawn progress bar. */
  showWrecked(byName, color, seconds) {
    const o = this.hud.querySelector('#wreckOverlay');
    const by = this.hud.querySelector('#wreckBy');
    by.innerHTML = byName ? `BY <b style="color:${color}">${byName}</b>` : 'HULL BREACH';
    o.style.setProperty('--dur', `${seconds}s`);
    o.classList.remove('show');
    void o.offsetWidth;
    o.classList.add('show');
    this.hud.classList.add('dead');
  }

  hideWrecked() {
    this.hud.querySelector('#wreckOverlay').classList.remove('show');
    this.hud.classList.remove('dead');
  }

  hide() {
    this.hideWrecked();
    this.hud.classList.remove('in');
    this.hud.classList.add('hidden');
    this.killFeedEl.innerHTML = '';
  }

  /** Kill-feed row: [killer] (weapon icon) [victim]. `killer` null = environmental / self-destruct. */
  killFeed({ killer, victim, cause }) {
    const row = el('div', 'kf-row');
    const name = (p) => `<span class="kf-name${p.you ? ' kf-you' : ''}" style="color:${p.color}">${p.name}</span>`;
    row.innerHTML = `${killer ? name(killer) : ''}<span class="kf-cause">${icon(cause)}</span>${name(victim)}`;
    if (killer?.you || victim.you) row.classList.add('kf-mine');
    this.killFeedEl.appendChild(row);
    while (this.killFeedEl.children.length > 5) this.killFeedEl.firstChild.remove();
    setTimeout(() => { row.classList.add('out'); setTimeout(() => row.remove(), 500); }, 5200);
  }

  /** Secondary-weapon panel: icon, name, ammo pips. Pass null to hide. */
  updateWeapon(sec) {
    if (!sec || sec.ammo <= 0) {
      if (this._wpKey !== '') { this._wpKey = ''; this.weaponPanel.classList.add('hidden'); }
      return;
    }
    const key = `${sec.type}:${sec.ammo}`;
    if (key === this._wpKey) return;
    const fresh = this._wpKey.split(':')[0] !== sec.type;
    this._wpKey = key;
    const def = SECONDARY[sec.type];
    this.weaponPanel.classList.remove('hidden');
    this.weaponPanel.style.setProperty('--wp-color', def.color);
    this.wpIcon.innerHTML = icon(sec.type, 'wp-svg');
    this.wpName.textContent = def.label;
    this.wpPips.innerHTML = Array.from({ length: Math.max(sec.ammo, def.ammo) }, (_, i) => `<i class="${i < sec.ammo ? 'on' : ''}"></i>`).join('');
    if (fresh) {
      this.weaponPanel.classList.remove('equip');
      void this.weaponPanel.offsetWidth;
      this.weaponPanel.classList.add('equip');
    }
  }

  // ---------------------------------------------------------------- Pause
  _buildPause() {
    this.pause = el('div', 'screen pause-screen hidden');
    this.pause.innerHTML = `
      <div class="pause-inner">
        <div class="res-kicker">MATCH PAUSED</div>
        <div class="pause-title">PAUSED</div>
        <div class="res-buttons">
          <button class="btn-primary" id="btnResume"><span>RESUME</span><kbd>ESC</kbd></button>
          <button class="btn-secondary" id="btnQuit"><span>QUIT TO MENU</span><kbd>Q</kbd></button>
        </div>
      </div>`;
    this.root.appendChild(this.pause);
    this.pause.querySelector('#btnResume').addEventListener('click', () => this.onPauseAction?.('resume'));
    this.pause.querySelector('#btnQuit').addEventListener('click', () => this.onPauseAction?.('menu'));
  }

  showPause() { this.pause.classList.remove('hidden', 'out'); }
  hidePause() { this.pause.classList.add('hidden'); }

  /** 0..1 boost meter -> smooth gradient fill, pulse near full/dim near empty, pop on a big refill jump. */
  setBoost(pct) {
    const p = Math.max(0, Math.min(1, pct));
    if (this._lastBoostRaw !== undefined && p - this._lastBoostRaw > 0.1) {
      this.boostPanel.classList.remove('refill');
      void this.boostPanel.offsetWidth;
      this.boostPanel.classList.add('refill');
    }
    this._lastBoostRaw = p;
    const shown = Math.round(p * 100);
    if (shown !== this._lastBoostPct) {
      this._lastBoostPct = shown;
      this.boostFill.style.transform = `scaleX(${p})`;
    }
    this.boostPanel.classList.toggle('full', p > 0.97);
    this.boostPanel.classList.toggle('low', p < 0.12);
  }

  /** Small transient popup (pickup collected) — smaller/faster than killBanner. */
  pickupToast(text, color) {
    clearTimeout(this._pickupToastTimer);
    this.pickupToastText.textContent = text;
    this.pickupToastEl.style.setProperty('--toast-color', color);
    this.pickupToastEl.classList.remove('show');
    void this.pickupToastEl.offsetWidth;
    this.pickupToastEl.classList.add('show');
    this._pickupToastTimer = setTimeout(() => this.pickupToastEl.classList.remove('show'), 1000);
  }

  // ---------------------------------------------------------------- Match HUD
  /** roster: [{key,name,isPlayer,color}] — builds one leaderboard row per combatant. */
  setupMatch(roster, killsToWin) {
    this.killsToWin = killsToWin;
    this.hud.querySelector('#sbGoal').textContent = `FIRST TO ${killsToWin}`;
    this.sbList.innerHTML = roster.map((r) => `
      <div class="sb-row${r.isPlayer ? ' sb-you' : ''}" data-key="${r.key}" style="--row-color:${r.color}">
        <span class="sb-swatch"></span>
        <span class="sb-rowname">${r.isPlayer ? 'YOU' : r.name}</span>
        <span class="sb-rowscore" id="sbScore-${r.key}">0</span>
      </div>`).join('');
    this._lastTimeStr = null;
    this.setMatchTime(0);
  }

  /** list: [{key,score}] — updates rows in place, bumps ones that went up, then re-sorts by score. */
  setScore(list) {
    let changed = false;
    for (const { key, score } of list) {
      const el2 = this.hud.querySelector(`#sbScore-${key}`);
      if (!el2) continue;
      const prev = +el2.textContent;
      if (score === prev) continue;
      changed = true;
      el2.textContent = score;
      if (score > prev) {
        el2.classList.remove('bump');
        void el2.offsetWidth;
        el2.classList.add('bump');
      }
    }
    if (!changed) return;
    const rows = [...this.sbList.children];
    rows.sort((a, b) => +b.querySelector('.sb-rowscore').textContent - +a.querySelector('.sb-rowscore').textContent);
    rows.forEach((r) => this.sbList.appendChild(r));
  }

  setMatchTime(seconds) {
    const s = Math.floor(seconds);
    const str = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    if (str === this._lastTimeStr) return;
    this._lastTimeStr = str;
    this.hud.querySelector('#sbTime').textContent = str;
  }

  /** Big center countdown: 3 / 2 / 1 / "WRECK!" (text shown pops in via CSS). Pass null to hide. */
  countdown(text) {
    const box = this.hud.querySelector('#countdown');
    const t = this.hud.querySelector('#countdownText');
    if (text === null) {
      box.classList.remove('show', 'go');
      return;
    }
    t.textContent = text;
    box.classList.remove('show', 'go');
    void box.offsetWidth;
    box.classList.add('show');
    if (text.length > 1) box.classList.add('go');
  }

  /**
   * Off-screen threat indicators, one per AI opponent. `list`: [{key,ndc:{x,y},behind,dist,show,color}].
   * Each shows an edge chevron (tinted to that bot's livery color) pointing toward it, with distance, only
   * while it's off-screen. A small DOM-element pool is kept per `key` so rows don't get rebuilt every frame.
   */
  updateThreatIndicators(list) {
    const seen = new Set();
    for (const t of list) {
      seen.add(t.key);
      let entry = this._threatEls.get(t.key);
      if (!entry) {
        const wrap = el('div', 'enemy-arrow hidden', '<div class="ea-chevron"></div><div class="ea-dist">0M</div>');
        this.threatContainer.appendChild(wrap);
        entry = { el: wrap, chevron: wrap.querySelector('.ea-chevron'), dist: wrap.querySelector('.ea-dist') };
        this._threatEls.set(t.key, entry);
      }
      let x = t.ndc.x, y = t.ndc.y;
      if (t.behind) { x = -x; y = -y; }
      const onScreen = !t.behind && Math.abs(x) < 0.94 && Math.abs(y) < 0.9;
      if (!t.show || onScreen) {
        entry.el.classList.add('hidden');
        continue;
      }
      entry.el.classList.remove('hidden');
      entry.el.style.setProperty('--threat-color', t.color);
      if (t.behind && Math.abs(x) < 0.05 && Math.abs(y) < 0.05) y = -1; // directly behind: point down
      const k = Math.min(0.88 / Math.max(Math.abs(x), 1e-3), 0.8 / Math.max(Math.abs(y), 1e-3));
      const px = (x * k * 0.5 + 0.5) * window.innerWidth;
      const py = (-y * k * 0.5 + 0.5) * window.innerHeight;
      entry.el.style.transform = `translate(${px}px, ${py}px) translate(-50%, -50%)`;
      entry.chevron.style.transform = `rotate(${-Math.atan2(y, x)}rad)`;
      entry.dist.textContent = `${Math.round(t.dist)}M`;
    }
    for (const [key, entry] of this._threatEls) if (!seen.has(key)) entry.el.classList.add('hidden');
  }

  // ---------------------------------------------------------------- Results
  _buildResults() {
    this.results = el('div', 'screen results-screen hidden');
    this.results.innerHTML = `
      <div class="results-inner">
        <div class="res-kicker" id="resKicker">MATCH OVER</div>
        <div class="res-title" id="resTitle">VICTORY</div>
        <div class="res-score" id="resScore"></div>
        <div class="res-stats" id="resStats"></div>
        <div class="res-buttons">
          <button class="btn-primary" id="btnRematch"><span>REMATCH</span><kbd>ENTER</kbd></button>
          <button class="btn-secondary" id="btnMenu"><span>MAIN MENU</span><kbd>ESC</kbd></button>
        </div>
      </div>`;
    this.root.appendChild(this.results);
    this.results.querySelector('#btnRematch').addEventListener('click', () => this.resultsAction('rematch'));
    this.results.querySelector('#btnMenu').addEventListener('click', () => this.resultsAction('menu'));
  }

  get resultsVisible() {
    return !!this._onResults;
  }

  /** data: { win, winnerName, roster: [{key,name,isPlayer,color,score}] (rank order), difficulty,
   *   stats: [[label,value],...] }; onAction('rematch'|'menu') */
  showResults(data, onAction) {
    clearTimeout(this._resultsHideTimer);
    this._onResults = onAction;
    const r = this.results;
    r.classList.toggle('win', data.win);
    r.classList.toggle('loss', !data.win);
    r.querySelector('#resKicker').textContent = `MATCH OVER · ${data.difficulty}`
      + (!data.win && data.winnerName ? ` · ${data.winnerName} WINS` : '');
    r.querySelector('#resTitle').textContent = data.win ? 'VICTORY' : 'WRECKED';
    r.querySelector('#resScore').innerHTML = data.roster.map((x, i) => `
      <div class="rs-row${x.isPlayer ? ' rs-you' : ''}${i === 0 ? ' rs-winner' : ''}" style="--row-color:${x.color}">
        <span class="rs-rank">${i + 1}</span>
        <span class="rs-rowname">${x.isPlayer ? 'YOU' : x.name}</span>
        <span class="rs-rowscore">${x.score}</span>
      </div>`).join('');
    r.querySelector('#resStats').innerHTML = data.stats
      .map(([k, v]) => `<div class="stat"><div class="stat-v">${v}</div><div class="stat-k">${k}</div></div>`)
      .join('');
    r.classList.remove('hidden', 'out');
  }

  resultsAction(action) {
    const cb = this._onResults;
    if (!cb) return;
    this._onResults = null;
    this.onSfx?.(action === 'rematch' ? 'confirm' : 'back');
    this.results.classList.add('out');
    this._resultsHideTimer = setTimeout(() => this.results.classList.add('hidden'), 600);
    cb(action);
  }

  show() {
    this.hud.classList.remove('hidden');
    requestAnimationFrame(() => this.hud.classList.add('in'));
    clearTimeout(this._helpTimer);
    this._helpTimer = setTimeout(() => this.setHelp(false), 12000);
  }

  setHelp(v) {
    this.helpVisible = v;
    this.helpCard.classList.toggle('collapsed', !v);
  }

  toggleHelp() {
    clearTimeout(this._helpTimer);
    this.setHelp(!this.helpVisible);
  }

  /** v: vehicle */
  update(v, dt, secondary = null) {
    this.setHealth(v.health.current, v.health.max);
    this.setBoost(v.boostMeter / v.cfg.boostMax);
    this.updateWeapon(secondary);

    if (v.overcharge > 0) {
      if (!this._overchargeShown) {
        this._overchargeShown = true;
        this.overchargeBadge.classList.remove('hidden', 'land');
      }
      this.overchargeNum.textContent = v.overcharge.toFixed(1);
    } else if (this._overchargeShown) {
      this._overchargeShown = false;
      this.overchargeBadge.classList.add('land');
      clearTimeout(this._overchargeTimer);
      this._overchargeTimer = setTimeout(() => this.overchargeBadge.classList.add('hidden'), 900);
    }

    const kmh = Math.abs(v.fwdSpeed) * 3.6;
    const shown = Math.round(kmh);
    if (shown !== this._lastSpeed) {
      this._lastSpeed = shown;
      this.spdNum.textContent = shown;
      const t = Math.min(1, kmh / MAX_KMH);
      this.spdArc.setAttribute('stroke-dasharray', `${ARC_L * t} ${ARC_C}`);
    }
    const rpmT = Math.min(1, v.rpm / v.cfg.maxRpm);
    this.rpmArc.setAttribute('stroke-dasharray', `${RPM_L * rpmT} ${RPM_C}`);
    this.rpmArc.classList.toggle('redline', rpmT > 0.9);

    let gear = v.gear === -1 ? 'R' : String(v.gear);
    if (Math.abs(v.fwdSpeed) < 0.5 && v.drive === 0) gear = 'N';
    if (gear !== this._lastGear) {
      this._lastGear = gear;
      this.gearNum.textContent = gear;
      this.gearNum.parentElement.classList.remove('pop');
      void this.gearNum.offsetWidth;
      this.gearNum.parentElement.classList.add('pop');
    }

    let status = '';
    if (v.handbrake) status = 'HANDBRAKE';
    else if (v.skidAmount > 0.35 && v.groundedCount > 2) status = 'DRIFT';
    else if (v.groundedCount === 0 && v.airTime > 0.3) status = 'AIRBORNE';
    if (status !== this._lastStatus) {
      this._lastStatus = status;
      this.status.textContent = status;
      this.status.className = 'gauge-status' + (status ? ' on ' + status.toLowerCase() : '');
    }

    // Recover prompt
    const flipped = v.isFlipped;
    this.recoverPrompt.classList.toggle('hidden', !flipped);
    if (flipped) {
      const p = Math.min(1, (v.flippedTime - v.cfg.flipDetectDelay) / (v.cfg.autoRecoverDelay - v.cfg.flipDetectDelay));
      this.rpFill.style.transform = `scaleX(${p})`;
    }

    // Airtime badge
    if (v.groundedCount === 0 && v.airTime > 0.5) {
      if (!this._airShown) {
        this._airShown = true;
        this.airBadge.classList.remove('hidden', 'land');
      }
      this.airNum.textContent = v.airTime.toFixed(1);
    } else if (this._airShown) {
      this._airShown = false;
      this.airBadge.classList.add('land');
      clearTimeout(this._airTimer);
      this._airTimer = setTimeout(() => this.airBadge.classList.add('hidden'), 900);
    }
  }
}
