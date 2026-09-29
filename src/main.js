import '@fontsource/orbitron/latin-700.css';
import '@fontsource/orbitron/latin-900.css';
import '@fontsource/rajdhani/latin-500.css';
import '@fontsource/rajdhani/latin-600.css';
import '@fontsource/rajdhani/latin-700.css';
import './ui/styles.css';
import { HUD } from './ui/HUD.js';

// The HUD (and its loading screen) comes in the first, small chunk; the physics engine (Rapier WASM, the bulk of the
// download) and the game itself are fetched as separate chunks while the loading bar is already on screen.
const hud = new HUD(document.getElementById('ui-root'));
document.getElementById('boot-splash')?.remove();

// Yield so the loading bar can paint; the timeout keeps loading moving if rAF is throttled (background tab).
const nextPaint = () =>
  new Promise((r) => {
    const t = setTimeout(r, 60);
    requestAnimationFrame(() => requestAnimationFrame(() => (clearTimeout(t), r())));
  });

async function boot() {
  hud.setLoading(0.05, 'LOADING PHYSICS ENGINE');
  await nextPaint();
  const [{ default: RAPIER }, { Game }] = await Promise.all([
    import('@dimforge/rapier3d-compat'),
    import('./core/Game.js'),
  ]);
  hud.setLoading(0.14, 'INITIALIZING PHYSICS');
  await nextPaint();
  await RAPIER.init();

  hud.setLoading(0.2, 'LOADING TYPEFACES');
  await Promise.all([
    document.fonts.load('900 64px Orbitron'),
    document.fonts.load('700 40px Rajdhani'),
    document.fonts.load('600 26px Rajdhani'),
  ]).catch(() => {});

  const game = new Game(RAPIER, document.getElementById('app'), hud);
  await game.init((p, text) => {
    hud.setLoading(p, text);
    return nextPaint();
  });

  hud.setLoading(1, 'READY');
  game.run();
  await nextPaint();
  hud.hideLoading();
  game.toMenu();
}

boot().catch((err) => {
  console.error(err);
  hud.setLoading(1, `ERROR: ${err.message ?? err}`);
});
