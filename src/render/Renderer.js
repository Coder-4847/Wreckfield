import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

// MSAA resolve copy that also scrubs NaN/Inf pixels — a single bad pixel would otherwise be smeared across
// the whole frame by the bloom blur.
const _white = new THREE.Color(1.0, 0.96, 0.9);

const ResolveShader = {
  uniforms: { tDiffuse: { value: null } },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    varying vec2 vUv;
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      if (any(isnan(c)) || any(isinf(c))) c = vec4(0.0, 0.0, 0.0, 1.0);
      gl_FragColor = vec4(min(c.rgb, vec3(512.0)), c.a);
    }`,
};

// Final display-space pass: speed/boost radial blur, subtle chromatic aberration, filmic grade (gentle S-curve,
// slightly cool shadows / warm highlights, saturation), vignette, low-hull danger tint, fine film grain.
const FinalShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uAberration: { value: 0.0008 },
    uVignette: { value: 0.55 },
    uGrain: { value: 0.022 },
    uFlash: { value: 0 },
    uBlur: { value: 0 },
    uDanger: { value: 0 },
    uDead: { value: 0 },
    uFlashColor: { value: new THREE.Color(1.0, 0.96, 0.9) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime, uAberration, uVignette, uGrain, uFlash, uBlur, uDanger, uDead;
    uniform vec3 uFlashColor;
    varying vec2 vUv;
    float rand(vec2 co){ return fract(sin(dot(co, vec2(12.9898,78.233))) * 43758.5453); }
    void main(){
      vec2 c = vUv - 0.5;
      float d = length(c);
      vec2 off = c * uAberration * (0.4 + d * 2.0);
      vec3 col;
      col.r = texture2D(tDiffuse, vUv + off).r;
      col.g = texture2D(tDiffuse, vUv).g;
      col.b = texture2D(tDiffuse, vUv - off).b;
      // Radial motion blur toward the screen center: strongest at the edges, clear around the car.
      if (uBlur > 0.01) {
        vec3 acc = vec3(0.0);
        for (int i = 0; i < 7; i++) {
          acc += texture2D(tDiffuse, vUv - c * uBlur * 0.09 * (float(i) / 6.0)).rgb;
        }
        col = mix(col, acc / 7.0, smoothstep(0.1, 0.55, d) * min(1.0, uBlur * 1.3));
      }
      col = clamp(col, 0.0, 1.0);
      // Filmic grade: gentle S-curve, cool shadows / warm highlights, saturation (drops when the hull is critical).
      float l = dot(col, vec3(0.2126,0.7152,0.0722));
      col = mix(col, col * col * (3.0 - 2.0 * col), 0.22);
      col += vec3(-0.006, 0.0, 0.014) * (1.0 - smoothstep(0.0, 0.4, l));
      col *= mix(vec3(1.0), vec3(1.035, 1.0, 0.965), smoothstep(0.45, 1.0, l));
      float lum = dot(col, vec3(0.2126,0.7152,0.0722));
      col = mix(vec3(lum), col, 1.06 - uDanger * 0.5);
      // Wrecked (player dead): drained, warm-tinted, heavy vignette — the fire in the frame still reads bright.
      col = mix(col, vec3(lum) * vec3(1.08, 0.96, 0.86), uDead * 0.78);
      // Vignette
      float v = smoothstep(0.95, 0.3, d);
      col *= mix(1.0, v, min(1.0, uVignette + uDead * 0.4));
      // Low-hull warning: red at the screen edges, pulsing
      col += vec3(0.55, 0.03, 0.02) * uDanger * smoothstep(0.3, 0.85, d) * (0.6 + 0.4 * sin(uTime * 6.0));
      // Grain
      col += (rand(vUv * 1000.0 + fract(uTime * 7.13)) - 0.5) * uGrain;
      // Impact / spawn flash
      col += uFlashColor * uFlash;
      gl_FragColor = vec4(col, 1.0);
    }`,
};

export class Renderer {
  constructor(container) {
    const r = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false });
    this.maxPixelRatio = 1.5;
    r.setPixelRatio(Math.min(window.devicePixelRatio, this.maxPixelRatio));
    r.setSize(window.innerWidth, window.innerHeight);
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.0;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(r.domElement);
    this.renderer = r;
    this.flash = 0;
    this.look = { blur: 0, danger: 0, dead: 0 }; // set per frame by Game (speed/boost blur, low-hull warning, wrecked)
    this.flashColor = new THREE.Color(1.0, 0.96, 0.9);
  }

  setupPost(scene, camera) {
    const r = this.renderer;
    // The composer owns its HalfFloat ping-pong targets (sizing follows pixel ratio). The scene renders into
    // renderTarget2 with 4x MSAA; a copy pass then resolves it into the non-MSAA target, because
    // UnrealBloomPass composites in place and that breaks on a multisampled target.
    this.composer = new EffectComposer(r);
    this.composer.renderTarget2.samples = 4;
    this.composer.addPass(new RenderPass(scene, camera));
    this.composer.addPass(new ShaderPass(ResolveShader));
    // Restrained bloom: only genuinely bright sources (sun glare, lamps, lasers, explosions) should bleed.
    this.bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.22, 0.45, 1.0);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.finalPass = new ShaderPass(FinalShader);
    this.composer.addPass(this.finalPass);
    this.scene = scene;
    this.camera = camera;
  }

  /** Render-resolution scale (dynamic resolution). 1 = native up to maxPixelRatio. */
  setResolutionScale(k) {
    this.resScale = k;
    this.resize();
  }

  get pixelRatio() {
    return Math.max(0.5, Math.min(window.devicePixelRatio, this.maxPixelRatio) * (this.resScale ?? 1));
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(w, h);
    this.composer.setPixelRatio(this.pixelRatio);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  render(dt, time, speedT = 0) {
    const u = this.finalPass.uniforms;
    u.uTime.value = time;
    u.uAberration.value = 0.0006 + speedT * speedT * 0.0022;
    u.uBlur.value = this.look.blur;
    u.uDanger.value = this.look.danger;
    u.uDead.value = this.look.dead;
    u.uAberration.value += this.look.dead * 0.0018;
    // Flash tint eases back to neutral white after a coloured (explosion) flash.
    this.flashColor.lerp(_white, Math.min(1, dt * 2.5));
    u.uFlashColor.value.copy(this.flashColor);
    this.flash = Math.max(0, this.flash - dt * 3.5);
    u.uFlash.value = this.flash * this.flash * 0.45;
    this.composer.render(dt);
  }
}
