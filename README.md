# LIMINAL.CO

> A 2D pixel-art **isometric** survival-horror roguelite inspired by the Backrooms.
> You are a field operative of **Liminal Co.** — the only company that goes *in*.

People slip through the seams of reality into the endless spaces behind it: the
mono-yellow lobby, the humming offices, the warm and wrong poolrooms. They are
still down there. So are the things that found them first. Take your team, take
your weapons, go as deep as you can, and **rescue everyone you find** before the
place takes your mind.

The game is built to feel **weird, liminal, endless, and nostalgic** — muted
fluorescent light pools swallowed by darkness, a constant electrical hum,
intrusive half-memories, and procedurally generated levels that never end.

---

## Play

It's a single, self-contained web page with **no build step and no external
assets** — all art is drawn procedurally and all audio is synthesized in the
browser. Just serve the folder and open it:

```bash
# from the repo root
python3 -m http.server 8000
# then open http://localhost:8000
```

(Opening `index.html` directly via `file://` also works in most browsers, but
serving over HTTP is recommended.)

### Controls

| Action | Keys |
| --- | --- |
| Move | `W` `A` `S` `D` / Arrow keys (screen-relative) |
| Aim | Mouse |
| Fire | Left click / `Space` |
| Sprint | `Shift` (drains stamina) |
| Switch weapon | `1`–`4` or `Q` |
| Flashlight | `F` (drains battery) |
| Rescue survivor / Descend | `E` |
| Pause | `P` / `Esc` |
| Mute | `M` |

### Goal

Each level of the liminal spaces holds a handful of trapped **survivors**. Walk
up to one and press `E` to rescue them — they'll follow you. Get them to the
**exit rift**, press `E` to **descend**, and they're saved. Leave people behind
and you lose them (and a piece of your sanity). The spaces are endless; you will
not save everyone. Descend as deep as you can.

### Survival

Four things keep you alive — and the place attacks all of them:

- **Health** — entities hit hard. Find medkits.
- **Sanity** — drains in the dark, near entities, and every second you stay.
  It restores near your team and in the light. At zero, the place starts eating
  you. Low sanity warps the screen and sound.
- **Stamina** — for sprinting away from things faster than you.
- **Battery** — powers your flashlight, your only reliable light in the dark.

### The entities

- **Hounds** — fast, low-damage swarmers.
- **Smilers** — lurk in the dark, then rush; tear at your mind.
- **Lurkers** — bloated ranged spitters that keep their distance.
- **Wailers** — drifting sanity-drainers; kill them or lose your grip.

---

## Architecture

Plain ES5-ish JavaScript, no dependencies, classic `<script>` tags sharing a
global `L` namespace. Loaded in dependency order:

| File | Responsibility |
| --- | --- |
| `js/utils.js` | Seeded RNG (`mulberry32`), vector/math helpers |
| `js/audio.js` | Fully synthesized WebAudio ambience + SFX |
| `js/assets.js` | Procedural pixel-art sprite generation (all characters, entities, items, props) |
| `js/iso.js` | Isometric projection + floor/wall drawing primitives |
| `js/world.js` | Themed procedural level generation (4 layout algorithms) + connectivity |
| `js/entities.js` | Player, Teammate, Survivor, Enemy AI, projectiles, items |
| `js/game.js` | Main loop, camera, depth-sorted renderer, dynamic lighting, HUD, state |
| `index.html` / `style.css` | Shell, HUD, and title / pause / death screens |

**Rendering**: tiles are drawn as isometric diamonds; walls as 3-face blocks.
Walls and actors are sorted into one depth-ordered list per frame so the player
is correctly occluded by geometry. A second offscreen canvas builds the darkness
layer each frame and "punches out" light pools, the flashlight cone, and muzzle
flashes with `destination-out` compositing.

**AI/navigation**: a breadth-first flow field is recomputed from the player a few
times per second; enemies and teammates descend its gradient, so they path
correctly through mazes without per-entity A*.

**Levels**: five themes (Lobby, Damp Halls, Offices, Poolrooms, Habitable Zone)
cycle as you descend, each with its own palette and layout algorithm. World size,
enemy count, and difficulty scale with depth. Every level is validated with a
flood fill and the exit is placed at the reachable cell farthest from spawn.

---

*Contains flashing light, sudden sound, and the feeling of a place you almost
remember. Headphones recommended.*
