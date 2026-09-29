// Keyboard + gamepad input. Continuous controls are sampled per frame; one-shot actions are edge-triggered.

const BLOCK_DEFAULT = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Backquote', 'Tab']);

export class Input {
  constructor() {
    this.keys = new Set();
    this.pressed = new Set();
    this.padPrev = [];
    this.usingPad = false;
    this.mouseDown = false;
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      if (BLOCK_DEFAULT.has(e.code)) e.preventDefault();
      if (!e.repeat) this.pressed.add(e.code);
      this.keys.add(e.code);
      this.usingPad = false;
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    this.mouseDown2 = false;
    window.addEventListener('mousedown', (e) => {
      if (e.button === 0) { this.mouseDown = true; this.usingPad = false; }
      if (e.button === 2) { this.mouseDown2 = true; this.usingPad = false; }
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouseDown = false;
      if (e.button === 2) this.mouseDown2 = false;
    });
    window.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.mouseDown = false;
      this.mouseDown2 = false;
    });
  }

  _pad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) if (p && p.connected) return p;
    return null;
  }

  /** Call once per frame before reading. Converts gamepad button edges into the same `pressed` set. */
  poll() {
    const pad = this._pad();
    if (!pad) return;
    // Y = recover, Start = confirm, Back = tuning, B = back (menus), D-pad L/R = vehicle, LB/RB = arena
    const map = { 3: 'KeyR', 9: 'Enter', 8: 'Backquote', 1: 'Escape', 14: 'ArrowLeft', 15: 'ArrowRight', 4: 'BracketLeft', 5: 'BracketRight' };
    for (const [idx, code] of Object.entries(map)) {
      const down = pad.buttons[idx]?.pressed;
      if (down && !this.padPrev[idx]) {
        this.pressed.add(code);
        this.usingPad = true;
      }
      this.padPrev[idx] = down;
    }
  }

  wasPressed(code) {
    return this.pressed.has(code);
  }

  /** Clear edge-triggered presses (end of frame). */
  endFrame() {
    this.pressed.clear();
  }

  getControls() {
    const k = (c) => this.keys.has(c);
    let throttle = k('KeyW') || k('ArrowUp') ? 1 : 0;
    let brake = k('KeyS') || k('ArrowDown') ? 1 : 0;
    let steer = (k('KeyD') || k('ArrowRight') ? 1 : 0) - (k('KeyA') || k('ArrowLeft') ? 1 : 0);
    let handbrake = k('Space');
    let lookBack = k('KeyC');
    let fire = this.mouseDown || k('ControlLeft') || k('ControlRight');
    let boost = k('ShiftLeft') || k('ShiftRight');
    let fire2 = this.mouseDown2 || k('KeyE');

    const pad = this._pad();
    if (pad) {
      const rt = pad.buttons[7]?.value ?? 0;
      const lt = pad.buttons[6]?.value ?? 0;
      let sx = pad.axes[0] ?? 0;
      const dz = 0.12;
      sx = Math.abs(sx) < dz ? 0 : Math.sign(sx) * ((Math.abs(sx) - dz) / (1 - dz));
      if (rt > 0.05 || lt > 0.05 || Math.abs(sx) > 0 || pad.buttons[0]?.pressed) this.usingPad = true;
      throttle = Math.max(throttle, rt > 0.05 ? rt : 0);
      brake = Math.max(brake, lt > 0.05 ? lt : 0);
      if (Math.abs(sx) > Math.abs(steer)) steer = sx * Math.abs(sx) * 0.5 + sx * 0.5; // mild response curve
      handbrake = handbrake || !!pad.buttons[0]?.pressed || !!pad.buttons[1]?.pressed;
      lookBack = lookBack || !!pad.buttons[2]?.pressed;
      fire = fire || !!pad.buttons[5]?.pressed; // RB
      boost = boost || !!pad.buttons[4]?.pressed; // LB
      fire2 = fire2 || !!pad.buttons[11]?.pressed || !!pad.buttons[13]?.pressed; // R3 / D-pad down
    }
    return { throttle, brake, steer, handbrake, lookBack, fire, boost, fire2 };
  }
}
