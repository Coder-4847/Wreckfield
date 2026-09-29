import * as THREE from 'three';

// World-space billboard above a vehicle: driver name + segmented health bar. Redrawn only when the health
// segment count changes (or on a hit flash), scaled with camera distance so it stays readable far away.

const W = 512, H = 112, SEGS = 10;

export class Nameplate {
  constructor(scene, name, color = '#ff3344') {
    this.name = name;
    this.color = color;
    this.canvas = document.createElement('canvas');
    this.canvas.width = W;
    this.canvas.height = H;
    this.ctx = this.canvas.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex, transparent: true, depthWrite: false, toneMapped: false, fog: false }));
    this.sprite.renderOrder = 8;
    this.sprite.center.set(0.5, 0);
    scene.add(this.sprite);
    this._lastFilled = -1;
    this._flash = 0;
    this._drawnFlash = false;
    this.draw(1);
  }

  setName(name) {
    this.name = name;
    this._lastFilled = -1;
  }

  flash() {
    this._flash = 0.12;
  }

  draw(pct) {
    const filled = Math.ceil(pct * SEGS - 1e-6);
    const flashing = this._flash > 0;
    if (filled === this._lastFilled && flashing === this._drawnFlash) return;
    this._lastFilled = filled;
    this._drawnFlash = flashing;
    const g = this.ctx;
    g.clearRect(0, 0, W, H);
    // Name
    g.font = '700 46px Rajdhani, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineWidth = 6;
    g.strokeStyle = 'rgba(8,4,16,0.85)';
    g.strokeText(this.name, W / 2, 30);
    g.fillStyle = flashing ? '#ffffff' : this.color;
    g.fillText(this.name, W / 2, 30);
    // Bar
    const bx = 56, by = 62, bw = W - 112, bh = 30;
    g.fillStyle = 'rgba(8,5,16,0.78)';
    g.fillRect(bx - 6, by - 5, bw + 12, bh + 10);
    const segW = (bw - (SEGS - 1) * 5) / SEGS;
    const col = pct > 0.5 ? '#7ed957' : pct > 0.22 ? '#f5b83d' : '#e5484d';
    for (let i = 0; i < SEGS; i++) {
      g.fillStyle = i < filled ? (flashing ? '#ffffff' : col) : 'rgba(255,255,255,0.1)';
      const x = bx + i * (segW + 5);
      g.beginPath();
      g.moveTo(x + 6, by); g.lineTo(x + segW, by); g.lineTo(x + segW - 6, by + bh); g.lineTo(x, by + bh);
      g.closePath();
      g.fill();
    }
    this.tex.needsUpdate = true;
  }

  update(dt, pos, camera, health, visible = true) {
    if (this._flash > 0) this._flash = Math.max(0, this._flash - dt);
    this.sprite.visible = visible && !health.dead;
    if (!this.sprite.visible) return;
    this.draw(health.pct);
    this.sprite.position.set(pos.x, pos.y + 1.7, pos.z);
    const d = camera.position.distanceTo(this.sprite.position);
    // Constant-ish screen size beyond ~11 m so it stays legible across the arena.
    const s = Math.max(1, d / 11) * 2.2;
    this.sprite.scale.set(s, s * (H / W), 1);
  }
}
