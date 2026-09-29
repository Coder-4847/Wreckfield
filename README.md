# WRECKFIELD

A browser vehicle-combat arena shooter: think Rocket League meets Twisted Metal. Pick a car and an arena, then
fight three AI drivers in a free-for-all. The first to 5 wrecks wins.

**Play:** https://coder-4847.github.io/Wreckfield/

Built with **Three.js** (rendering) and **Rapier** (physics). There are **zero binary assets**: every texture is
generated on a canvas at load, every sound is synthesized with WebAudio, and every car and arena is procedural geometry.

## Features

- **Five cars**, each a different silhouette with its own stat spread: APEX GT (sport coupe), BRUTE V8 (muscle car), WARDEN (armored SUV), HAULER (pickup truck), STING (rally hatch).
- **Five arenas**: Salvage Yard 7 (golden hour), Harbor Docks (dusk), Desert Quarry (high noon, dust), Alpine Pass (snowfall, frozen lake), Downtown Rain (night storm).
- **Weapons**: a roof-mounted autocannon with unlimited ammo, plus crate-earned secondaries: homing missiles, proximity mines, flak scatter and a pulse laser.
- **Arena play**: boost pads, jumps, repair, nitro and overcharge crates, and hazard ground (toxic spills, oil and rain slicks, sand, ice, crevasses, a live power line).
- **AI drivers**: context steering, per-map navigation graphs, three difficulty tiers and three fighting styles.
- **Destruction**: fireballs, torn-off wheels, burning debris, scorch marks and secondary explosions. You get a death camera when you're wrecked and a hit-stop when you score.
- **Rendering**: custom raycast-suspension vehicle physics at a fixed 120 Hz with interpolation, a post-processing chain (bloom, radial motion blur, grade) and dynamic resolution.

## Controls

| Action | Keyboard / mouse | Gamepad |
| --- | --- | --- |
| Drive / steer | `W A S D` or arrows | RT / LT, left stick |
| Autocannon | Left click / Ctrl | RB |
| Secondary weapon | `E` / right click | R3 / D-pad down |
| Nitro | `Shift` | LB |
| Handbrake | `Space` | A / B |
| Look back · recover | `C` · `R` | X · Y |
| Pause | `Esc` / `P` | Start |
| Menu: car · arena · difficulty | `←/→` · `Q/E` · `↑/↓` | D-pad · LB/RB |

## Develop

```bash
npm install
npm run dev      # http://localhost:5174
npm run build    # production build in dist/
```

Pushing to `main` builds the game and publishes it to GitHub Pages (`.github/workflows/deploy.yml`, `gh-pages` branch).
