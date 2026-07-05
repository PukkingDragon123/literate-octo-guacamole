/* =============================================================================
   LIMINAL.CO — game.js
   Main engine: input, fixed-follow camera, depth-sorted isometric renderer,
   dynamic light/darkness compositing, sanity distortion, flow-field navigation,
   level flow, HUD, and the title/dead/pause states.
   ============================================================================= */
(function (global) {
  'use strict';
  const L = global.L || (global.L = {});
  const { clamp, lerp, dist, norm, RNG } = L;
  const iso = L.iso;

  // ---- Input ------------------------------------------------------------------
  const KEYMAP = {
    up: ['KeyW', 'ArrowUp'], down: ['KeyS', 'ArrowDown'],
    left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'],
    sprint: ['ShiftLeft', 'ShiftRight'],
    interact: ['KeyE'], flashlight: ['KeyF'],
    slot1: ['Digit1'], slot2: ['Digit2'], slot3: ['Digit3'], slot4: ['Digit4'],
    nextWeapon: ['KeyQ'], pause: ['Escape', 'KeyP'], mute: ['KeyM'],
    fireKey: ['Space']
  };
  class Input {
    constructor(canvas) {
      this.keys = {}; this.prev = {};
      this.mouse = { x: 0, y: 0, down: false };
      this._codeToAction = {};
      for (const a in KEYMAP) for (const c of KEYMAP[a]) (this._codeToAction[c] = this._codeToAction[c] || []).push(a);
      this._state = {}; this._pstate = {};

      addEventListener('keydown', (e) => {
        const acts = this._codeToAction[e.code]; if (acts) { acts.forEach(a => this._state[a] = true); if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault(); }
      });
      addEventListener('keyup', (e) => { const acts = this._codeToAction[e.code]; if (acts) acts.forEach(a => this._state[a] = false); });
      const rect = () => canvas.getBoundingClientRect();
      canvas.addEventListener('mousemove', (e) => { const r = rect(); this.mouse.x = e.clientX - r.left; this.mouse.y = e.clientY - r.top; });
      canvas.addEventListener('mousedown', (e) => { if (e.button === 0) this.mouse.down = true; });
      addEventListener('mouseup', (e) => { if (e.button === 0) this.mouse.down = false; });
      canvas.addEventListener('contextmenu', (e) => e.preventDefault());
      addEventListener('blur', () => { this._state = {}; this.mouse.down = false; });
    }
    down(a) { if (a === 'fire') return this.mouse.down || this._state.fireKey; return !!this._state[a]; }
    pressed(a) { return !!this._state[a] && !this._pstate[a]; }
    endFrame() { this._pstate = Object.assign({}, this._state); }
  }

  const SPRITE_SCALE = 2.4;

  // Nostalgic intrusive-thought pool — surfaces on timers to build the tone.
  const MEMORIES = [
    'You remember a hallway that smelled like your first school.',
    'A television hums somewhere. You never owned that show.',
    'The carpet is the exact yellow of a waiting room in 1997.',
    'You almost remember the face of someone you were supposed to meet.',
    'For a second, the buzzing sounds like your mother calling you in for dinner.',
    'You think you have been here before. You think you never left.',
    'The light flickers in a rhythm you used to fall asleep to.',
    'Somewhere far off, an ice machine drops a load of cubes.',
    'You catch yourself humming a jingle for a product that never existed.',
    'The air tastes like the inside of an old paperback.'
  ];

  class Game {
    constructor() {
      this.canvas = document.getElementById('game');
      this.ctx = this.canvas.getContext('2d');
      this.overlay = document.createElement('canvas'); // reusable darkness layer
      this.octx = this.overlay.getContext('2d');
      this.input = new Input(this.canvas);
      this.audio = new L.AudioEngine();
      this.assets = L.buildAssets();
      this.state = 'title';
      this.time = 0;
      this.shakeAmt = 0;
      this.dmgFlash = 0;
      this.logs = [];
      this.cam = { x: 0, y: 0 };
      this.dpr = Math.min(global.devicePixelRatio || 1, 2);
      this._silCache = new WeakMap();
      this._resize();
      addEventListener('resize', () => this._resize());
      this._bindUI();
      this._last = 0;
      this._navT = 0;
      this.noiseTimer = 0;
      this.reviveProgress = 0;
      this._memT = 20 + Math.random() * 20;
      requestAnimationFrame((t) => this._frame(t));
    }

    _resize() {
      const w = global.innerWidth, h = global.innerHeight;
      this.vw = w; this.vh = h;
      this.canvas.width = w * this.dpr; this.canvas.height = h * this.dpr;
      this.canvas.style.width = w + 'px'; this.canvas.style.height = h + 'px';
      this.overlay.width = this.canvas.width; this.overlay.height = this.canvas.height;
      this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      this.octx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      this.ctx.imageSmoothingEnabled = false;
    }

    _bindUI() {
      const startBtn = document.getElementById('startBtn');
      const restartBtn = document.getElementById('restartBtn');
      const resumeBtn = document.getElementById('resumeBtn');
      if (startBtn) startBtn.onclick = () => this.startRun();
      if (restartBtn) restartBtn.onclick = () => this.startRun();
      if (resumeBtn) resumeBtn.onclick = () => this.togglePause();
    }

    // ---- Run / level management ----------------------------------------------
    startRun() {
      this.audio.start();
      this.runSeed = (Math.floor(Math.random() * 1e9)) >>> 0;
      this.levelIndex = 0;
      this.saved = 0; this.lost = 0; this.kills = 0;
      this.player = new L.Player(0, 0);
      this.teammates = [];
      this._pendingMates = 2; // created at level start near spawn
      this.startLevel(0, true);
      this.setScreen('none');
      this.state = 'playing';
    }

    startLevel(index, firstTime) {
      this.levelIndex = index;
      this.rng = new RNG((this.runSeed + index * 7919) >>> 0);
      this.world = new L.World(index, this.rng);
      const sp = this.world.spawn;
      this.player.x = sp.x; this.player.y = sp.y;
      this.player.invuln = 1.0;

      // (re)place teammates near spawn
      const near = () => this._openNear(sp.x, sp.y, 2.2);
      if (firstTime) {
        for (let i = 0; i < this._pendingMates; i++) {
          const c = near(); this.teammates.push(new L.Teammate(c.x, c.y, i));
        }
      } else {
        for (const t of this.teammates) { if (t.dead) continue; const c = near(); t.x = c.x; t.y = c.y; t.downed = false; t.hp = Math.max(t.hp, t.maxHp * 0.6); }
      }

      // survivors
      this.survivors = [];
      const nSurv = clamp(2 + Math.floor(index / 2), 2, 5);
      for (let i = 0; i < nSurv; i++) {
        const c = this.world.randomOpen(8);
        this.survivors.push(new L.Survivor(c.x, c.y, index * 3 + i));
      }
      this.survTotal = nSurv;

      // enemies scale with depth
      this.enemies = [];
      const budget = 6 + index * 3;
      const roster = this._enemyRoster(index);
      let spent = 0;
      while (spent < budget) {
        const type = this.rng.pick(roster);
        const cost = { hound: 1, smiler: 2, lurker: 2, wailer: 2 }[type];
        const c = this.world.randomOpen(9);
        this.enemies.push(new L.Enemy(c.x, c.y, type));
        spent += cost;
      }

      // items
      this.items = [];
      const drop = (kind, n, minD) => { for (let i = 0; i < n; i++) { const c = this.world.randomOpen(minD || 4); this.items.push(new L.Item(c.x, c.y, kind)); } };
      drop('medkit', 2 + (index % 2), 5);
      drop('battery', 3, 4);
      drop('ammo', 2 + Math.floor(index / 2), 4);
      drop('sanity', 1, 6);
      if (index === 0 || (!this.player.weapons.includes('shotgun') && this.rng.chance(0.7))) drop('shotgun', 1, 8);
      if (index === 1 || (!this.player.weapons.includes('smg') && this.rng.chance(0.7))) drop('smg', 1, 8);

      this.bullets = []; this.spits = []; this.particles = [];
      this._buildLightGrid();
      this._recomputeNav();
      this.transition = { t: 0, dur: 3.2, name: this.world.theme.name, blurb: this.world.theme.blurb };
      this.log('ENTERING ' + this.world.theme.name);
      this.audio.portal();
    }

    _enemyRoster(index) {
      const r = ['hound', 'hound'];
      if (index >= 0) r.push('smiler');
      if (index >= 1) r.push('lurker');
      if (index >= 2) r.push('wailer', 'smiler');
      if (index >= 3) r.push('lurker', 'hound');
      return r;
    }

    _openNear(cx, cy, rad) {
      for (let tries = 0; tries < 40; tries++) {
        const a = Math.random() * Math.PI * 2, d = 0.6 + Math.random() * rad;
        const x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d;
        if (this.world.isOpen(Math.round(x), Math.round(y))) return { x, y };
      }
      return { x: cx, y: cy };
    }

    descend() {
      // tally survivors
      for (const s of this.survivors) {
        if (s.saved || s.dead) continue;
        if (s.rescued) { s.saved = true; this.saved++; }
        else { this.lost++; }
      }
      const missed = this.survivors.filter(s => !s.rescued && !s.dead).length;
      if (missed > 0) { this.player.sanity = clamp(this.player.sanity - 6 * missed, 0, this.player.maxSanity); this.log('you left ' + missed + ' behind...'); }
      // restock a little on descend
      this.player.hp = clamp(this.player.hp + 15, 0, this.player.maxHp);
      this.player.battery = clamp(this.player.battery + 30, 0, this.player.maxBattery);
      this.startLevel(this.levelIndex + 1, false);
    }

    // ---- Lighting -------------------------------------------------------------
    _buildLightGrid() {
      const w = this.world.w, h = this.world.h;
      const grid = new Float32Array(w * h);
      const R = 4.2;
      for (const li of this.world.lights) {
        const x0 = Math.max(0, li.x - R | 0), x1 = Math.min(w - 1, li.x + R | 0);
        const y0 = Math.max(0, li.y - R | 0), y1 = Math.min(h - 1, li.y + R | 0);
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
          const d = Math.hypot(x - li.x, y - li.y);
          if (d < R) { const v = (1 - d / R); grid[y * w + x] = Math.min(1, grid[y * w + x] + v * 0.9); }
        }
      }
      this.lightGrid = grid;
    }
    lightLevelAt(x, y) {
      const cx = Math.round(x), cy = Math.round(y);
      if (!this.world.inBounds(cx, cy)) return 0;
      let v = this.lightGrid[cy * this.world.w + cx];
      const p = this.player;
      if (p && p.flashlightOn && dist(p.x, p.y, x, y) < 2) v += 0.3;
      return Math.min(1, v);
    }

    // ---- Navigation flow field (BFS from player) ------------------------------
    _recomputeNav() {
      const w = this.world.w, h = this.world.h;
      if (!this.navField || this.navField.length !== w * h) this.navField = new Int32Array(w * h);
      this.navField.fill(-1);
      const p = this.player;
      const sx = clamp(Math.round(p.x), 0, w - 1), sy = clamp(Math.round(p.y), 0, h - 1);
      if (!this.world.isOpen(sx, sy)) return;
      const q = [sy * w + sx]; this.navField[q[0]] = 0;
      let head = 0;
      while (head < q.length) {
        const cur = q[head++]; const cx = cur % w, cy = (cur / w) | 0; const d = this.navField[cur];
        if (d > 60) continue; // cap spread for perf
        const ns = [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]];
        for (const [nx, ny] of ns) {
          if (!this.world.isOpen(nx, ny)) continue;
          const ni = ny * w + nx;
          if (this.navField[ni] !== -1) continue;
          this.navField[ni] = d + 1; q.push(ni);
        }
      }
    }
    navDir(x, y) {
      const w = this.world.w, f = this.navField;
      const cx = Math.round(x), cy = Math.round(y);
      if (!this.world.inBounds(cx, cy)) return [0, 0];
      const cur = f[cy * w + cx];
      if (cur < 0) return [0, 0];
      if (cur <= 1) return norm(this.player.x - x, this.player.y - y);
      let best = cur, bx = cx, by = cy;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = cx + dx, ny = cy + dy;
        if (!this.world.isOpen(nx, ny)) continue;
        if (dx && dy && (!this.world.isOpen(cx + dx, cy) || !this.world.isOpen(cx, cy + dy))) continue; // no corner cut
        const v = f[ny * w + nx];
        if (v >= 0 && v < best) { best = v; bx = nx; by = ny; }
      }
      if (bx === cx && by === cy) return norm(this.player.x - x, this.player.y - y);
      return norm(bx - x + (this.player.x - x) * 0.05, by - y + (this.player.y - y) * 0.05);
    }

    hasLOS(ax, ay, bx, by) {
      const d = Math.hypot(bx - ax, by - ay);
      const steps = Math.ceil(d / 0.28);
      for (let i = 1; i < steps; i++) {
        const t = i / steps;
        if (this.world.isWall(Math.round(ax + (bx - ax) * t), Math.round(ay + (by - ay) * t))) return false;
      }
      return true;
    }

    nearestEnemy(x, y, range, needLOS) {
      let best = null, bd = range * range;
      for (const e of this.enemies) {
        if (e.dead) continue;
        const dd = (e.x - x) * (e.x - x) + (e.y - y) * (e.y - y);
        if (dd < bd && (!needLOS || this.hasLOS(x, y, e.x, e.y))) { bd = dd; best = e; }
      }
      return best;
    }

    // ---- Aim helpers ----------------------------------------------------------
    aimWorldDelta() {
      // mouse position relative to player screen position -> world delta
      const cxp = this.vw / 2, cyp = this.vh / 2;
      const dsx = this.input.mouse.x - cxp;
      const dsy = this.input.mouse.y - cyp;
      const wd = iso.screenToWorld(dsx, dsy);
      return wd;
    }
    screenAimAngle() { const d = this.aimWorldDelta(); return Math.atan2(d.y, d.x); }
    screenAimScreen() { const cxp = this.vw / 2, cyp = this.vh / 2; return Math.atan2(this.input.mouse.y - cyp, this.input.mouse.x - cxp); }

    // ---- Events ---------------------------------------------------------------
    log(msg) { this.logs.unshift({ msg, t: 5 }); if (this.logs.length > 5) this.logs.pop(); }
    shake(a) { this.shakeAmt = Math.min(this.shakeAmt + a, 14); }
    damageFlash() { this.dmgFlash = 1; }
    spawnMuzzle(x, y, ang) { this.particles.push({ x: x + Math.cos(ang) * 0.5, y: y + Math.sin(ang) * 0.5, vx: 0, vy: 0, life: 0.05, max: 0.05, kind: 'muzzle' }); this.noiseTimer = 1.2; }
    spawnBlood(x, y, dx, dy) { for (let i = 0; i < 6; i++) { const a = Math.atan2(dy, dx) + (Math.random() - 0.5) * 1.4; const s = 2 + Math.random() * 4; this.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.4 + Math.random() * 0.3, max: 0.7, kind: 'blood' }); } }
    spawnSpark(x, y, col) { for (let i = 0; i < 5; i++) { const a = Math.random() * Math.PI * 2, s = 2 + Math.random() * 3; this.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.2 + Math.random() * 0.2, max: 0.4, kind: 'spark', col: col || '#ffd66a' }); } }

    onEnemyKilled(e) {
      this.kills++;
      this.spawnBlood(e.x, e.y, 0, 0); this.spawnBlood(e.x, e.y, 1, 1);
      if (this.rng.chance(0.28)) { const k = this.rng.pick(['ammo', 'battery', 'medkit']); this.items.push(new L.Item(e.x, e.y, k)); }
    }
    onSurvivorLost(s) { this.log(s.name + ' didn\'t make it.'); this.lost++; this.player.sanity = clamp(this.player.sanity - 10, 0, this.player.maxSanity); this.audio.screech(); }
    onTeammateLost(t) { this.log(t.name + ' is gone.'); this.player.sanity = clamp(this.player.sanity - 12, 0, this.player.maxSanity); }
    onPlayerDeath() {
      if (this.state !== 'playing') return;
      this.state = 'dead';
      this.fillDeathScreen();
      this.setScreen('dead');
    }

    togglePause() {
      if (this.state === 'playing') { this.state = 'paused'; this.setScreen('pause'); }
      else if (this.state === 'paused') { this.state = 'playing'; this.setScreen('none'); }
    }

    setScreen(which) {
      ['title', 'dead', 'pause'].forEach(id => {
        const el = document.getElementById('scr-' + id);
        if (el) el.style.display = (which === id) ? 'flex' : 'none';
      });
    }

    // ---- Interaction (E) ------------------------------------------------------
    handleInteract() {
      const p = this.player;
      // rescue nearest survivor
      let target = null, bd = 1.5;
      for (const s of this.survivors) { if (s.rescued || s.dead || s.saved) continue; const d = dist(s.x, s.y, p.x, p.y); if (d < bd) { bd = d; target = s; } }
      if (target) { target.rescued = true; this.log('Rescued ' + target.name + '. Stay close.'); this.audio.rescue(); return; }
      // descend at exit
      if (dist(this.world.exit.x, this.world.exit.y, p.x, p.y) < 1.4) { this.descend(); }
    }

    // ---- Main loop ------------------------------------------------------------
    _frame(t) {
      const dt = Math.min(0.05, (t - this._last) / 1000 || 0);
      this._last = t;
      this.time += dt;
      try {
        if (this.state === 'playing') this.update(dt);
        this.render(dt);
        this.input.endFrame();
      } catch (err) {
        // Never let one bad frame kill the loop.
        if (!this._errLogged) { console.error('frame error:', err); this._errLogged = true; }
      }
      requestAnimationFrame((t2) => this._frame(t2));
    }

    update(dt) {
      const inp = this.input;
      if (inp.pressed('pause')) { this.togglePause(); return; }
      if (inp.pressed('mute')) { this.audio.setMuted(this.audio.enabled); this.log(this.audio.enabled ? 'SOUND ON' : 'SOUND OFF'); }
      if (inp.pressed('interact')) this.handleInteract();

      this.noiseTimer = Math.max(0, this.noiseTimer - dt);
      this.reviveProgress = 0;

      this.player.update(dt, this);

      this._navT -= dt;
      if (this._navT <= 0) { this._navT = 0.2; this._recomputeNav(); }

      for (const e of this.enemies) e.update(dt, this);
      for (const t of this.teammates) t.update(dt, this);
      for (const s of this.survivors) s.update(dt, this);
      for (const b of this.bullets) b.update(dt, this);
      for (const s of this.spits) s.update(dt, this);
      for (const it of this.items) it.update(dt, this);

      // particles
      for (const pt of this.particles) {
        pt.x += (pt.vx || 0) * dt; pt.y += (pt.vy || 0) * dt;
        if (pt.vx) { pt.vx *= 0.9; pt.vy *= 0.9; }
        pt.life -= dt;
      }
      this.particles = this.particles.filter(p => p.life > 0);
      this.bullets = this.bullets.filter(b => !b.dead);
      this.spits = this.spits.filter(s => !s.dead);
      this.items = this.items.filter(i => !i.dead);
      this.enemies = this.enemies.filter(e => !e.dead);

      // memory intrusions
      this._memT -= dt;
      if (this._memT <= 0) { this._memT = 22 + Math.random() * 26; this.log(MEMORIES[(Math.random() * MEMORIES.length) | 0]); }

      // logs decay
      for (const lg of this.logs) lg.t -= dt;
      this.logs = this.logs.filter(l => l.t > 0);

      // transition timer
      if (this.transition) { this.transition.t += dt; if (this.transition.t > this.transition.dur) this.transition = null; }

      // camera follow
      const sp = iso.worldToScreen(this.player.x, this.player.y);
      this.cam.x = lerp(this.cam.x, sp.x, clamp(dt * 8, 0, 1));
      this.cam.y = lerp(this.cam.y, sp.y, clamp(dt * 8, 0, 1));

      // effects decay
      this.shakeAmt *= Math.pow(0.001, dt);
      this.dmgFlash = Math.max(0, this.dmgFlash - dt * 2);

      // audio dread
      const ne = this.nearestEnemy(this.player.x, this.player.y, 12, false);
      let dread = 0;
      if (ne) dread = clamp(1 - dist(ne.x, ne.y, this.player.x, this.player.y) / 12, 0, 1);
      dread = Math.max(dread, 1 - this.player.sanity / 100);
      this.audio.setDread(dread);
      this.audio.update(dt);
      if (this.player.sanity < 25) { this._hbT = (this._hbT || 0) - dt; if (this._hbT <= 0) { this._hbT = 0.5 + this.player.sanity / 100; this.audio.heartbeat(1 - this.player.sanity / 100); } }

      this.updateHUD();
    }

    // ---- Rendering ------------------------------------------------------------
    render(dt) {
      const ctx = this.ctx, W = this.vw, H = this.vh;
      const th = (this.world && this.world.theme) || L.THEMES[0];
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = th.bg; ctx.fillRect(0, 0, W, H);

      // Title / no-world: just a dim animated backdrop behind the DOM screen.
      if (this.state === 'title' || !this.world) {
        ctx.globalAlpha = 0.5;
        for (let i = 0; i < 40; i++) {
          const x = ((i * 137 + this.time * 12) % (W + 60)) - 30;
          const y = ((i * 89) % H);
          ctx.fillStyle = 'rgba(232,223,174,0.06)'; ctx.fillRect(x, y, 2, 2);
        }
        ctx.globalAlpha = 1;
        return;
      }

      // camera shake
      const shx = (Math.random() - 0.5) * this.shakeAmt;
      const shy = (Math.random() - 0.5) * this.shakeAmt;
      // low-sanity screen breathing
      const san = this.player.sanity / 100;
      const breathe = san < 0.5 ? Math.sin(this.time * 3) * (0.5 - san) * 6 : 0;

      const originX = W / 2 - this.cam.x + shx;
      const originY = H / 2 - this.cam.y + shy + breathe;
      this._ox = originX; this._oy = originY;

      // visible tile bounds
      const corners = [
        iso.screenToWorld(-originX, -originY),
        iso.screenToWorld(W - originX, -originY),
        iso.screenToWorld(-originX, H - originY),
        iso.screenToWorld(W - originX, H - originY)
      ];
      let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
      for (const c of corners) { minX = Math.min(minX, c.x); maxX = Math.max(maxX, c.x); minY = Math.min(minY, c.y); maxY = Math.max(maxY, c.y); }
      minX = Math.max(0, (minX | 0) - 2); minY = Math.max(0, (minY | 0) - 2);
      maxX = Math.min(this.world.w - 1, (maxX | 0) + 2); maxY = Math.min(this.world.h - 1, (maxY | 0) + 3);

      // 1) floors
      for (let gy = minY; gy <= maxY; gy++) {
        for (let gx = minX; gx <= maxX; gx++) {
          if (this.world.isWall(gx, gy)) continue;
          const s = iso.worldToScreen(gx, gy);
          const sx = s.x + originX, sy = s.y + originY;
          if (this.world.isLiquid(gx, gy)) {
            iso.drawFloor(ctx, sx, sy, th.liquid || '#3e7d86');
            // ripple
            ctx.globalAlpha = 0.15; iso.drawFloor(ctx, sx, sy + Math.sin(this.time * 2 + gx + gy) * 1.2, '#ffffff'); ctx.globalAlpha = 1;
          } else {
            const vcol = th.floor[this.world.variant[gy * this.world.w + gx] % th.floor.length];
            iso.drawFloor(ctx, sx, sy, vcol);
          }
        }
      }
      // faint floor grid lines
      ctx.strokeStyle = th.floorLine; ctx.lineWidth = 1;
      for (let gy = minY; gy <= maxY; gy++) {
        for (let gx = minX; gx <= maxX; gx++) {
          if (this.world.isWall(gx, gy)) continue;
          const s = iso.worldToScreen(gx, gy); const sx = s.x + originX, sy = s.y + originY;
          iso.floorPath(ctx, sx, sy); ctx.stroke();
        }
      }

      // 2) build depth-sorted render list of walls + entities
      const list = [];
      for (let gy = minY; gy <= maxY; gy++) for (let gx = minX; gx <= maxX; gx++) {
        if (this.world.isWall(gx, gy)) list.push({ d: gx + gy - 0.01, kind: 'wall', gx, gy });
      }
      const exit = this.world.exit;
      list.push({ d: exit.x + exit.y, kind: 'exit' });
      for (const it of this.items) list.push({ d: it.depth(), kind: 'item', ref: it });
      for (const s of this.survivors) if (!s.saved && !s.dead) list.push({ d: s.depth(), kind: 'survivor', ref: s });
      for (const e of this.enemies) list.push({ d: e.depth(), kind: 'enemy', ref: e });
      for (const t of this.teammates) if (!t.dead) list.push({ d: t.depth(), kind: 'mate', ref: t });
      list.push({ d: this.player.depth(), kind: 'player' });
      for (const b of this.bullets) list.push({ d: b.depth() + 0.5, kind: 'bullet', ref: b });
      for (const s of this.spits) list.push({ d: s.depth() + 0.5, kind: 'spit', ref: s });
      list.sort((a, b) => a.d - b.d);

      for (const item of list) this._drawListItem(ctx, item, th, originX, originY);

      // 3) particles (blood/sparks) in world space
      for (const pt of this.particles) {
        if (pt.kind === 'muzzle') continue;
        const s = iso.worldToScreen(pt.x, pt.y); const sx = s.x + originX, sy = s.y + originY - 6;
        const a = clamp(pt.life / pt.max, 0, 1);
        if (pt.kind === 'blood') { ctx.fillStyle = `rgba(120,20,18,${a})`; ctx.fillRect(sx - 1, sy - 1, 3, 3); }
        else { ctx.fillStyle = pt.col || '#ffd66a'; ctx.globalAlpha = a; ctx.fillRect(sx - 1, sy - 1, 2, 2); ctx.globalAlpha = 1; }
      }

      // 4) lighting composite
      this._renderLighting(th, originX, originY, minX, maxX, minY, maxY);

      // 5) atmosphere: vignette, grain, scanlines, sanity distortion
      this._renderAtmosphere(dt);

      // 6) interaction prompts (world-space)
      this._renderPrompts(ctx, originX, originY);
    }

    _drawListItem(ctx, item, th, ox, oy) {
      if (item.kind === 'wall') {
        const s = iso.worldToScreen(item.gx, item.gy); const sx = s.x + ox, sy = s.y + oy;
        iso.drawWall(ctx, sx, sy, iso.WALL_H, th.wallTop, th.wallLeft, th.wallRight, th.wallEdge);
        return;
      }
      if (item.kind === 'exit') {
        const s = iso.worldToScreen(this.world.exit.x, this.world.exit.y); const sx = s.x + ox, sy = s.y + oy;
        const fr = this.assets.exit[(Math.floor(this.time * 6) % 2)];
        this._blit(ctx, fr, sx, sy - 6, 1.6);
        return;
      }
      if (item.kind === 'bullet') { const b = item.ref; const s = iso.worldToScreen(b.x, b.y); const sx = s.x + ox, sy = s.y + oy - 8; ctx.fillStyle = '#fff2b0'; ctx.fillRect(sx - 1.5, sy - 1.5, 3, 3); const ps = iso.worldToScreen(b.px, b.py); ctx.strokeStyle = 'rgba(255,230,140,0.5)'; ctx.beginPath(); ctx.moveTo(ps.x + ox, ps.y + oy - 8); ctx.lineTo(sx, sy); ctx.stroke(); return; }
      if (item.kind === 'spit') { const b = item.ref; const s = iso.worldToScreen(b.x, b.y); const sx = s.x + ox, sy = s.y + oy - 8; ctx.fillStyle = '#9ad06a'; ctx.beginPath(); ctx.arc(sx, sy, 3, 0, 7); ctx.fill(); return; }

      let ref = item.ref, spr, scale = SPRITE_SCALE, yoff = 0;
      if (item.kind === 'player') { ref = this.player; spr = this.player.sprite(this); }
      else if (item.kind === 'enemy') { spr = ref.sprite(this); }
      else if (item.kind === 'mate') { spr = ref.sprite(this); }
      else if (item.kind === 'survivor') { spr = ref.sprite(this); }
      else if (item.kind === 'item') { spr = this.assets.items[ref.kind]; scale = 2.0; yoff = Math.sin(ref.bob) * 3; }
      if (!spr) return;
      const s = iso.worldToScreen(ref.x, ref.y); const sx = s.x + ox, sy = s.y + oy;
      // shadow
      ctx.fillStyle = 'rgba(0,0,0,0.28)';
      ctx.beginPath(); ctx.ellipse(sx, sy + 2, 12, 6, 0, 0, 7); ctx.fill();

      // downed teammate: draw rotated-ish (just lower)
      const drawY = sy - spr.height * scale + 10 + yoff + (ref.downed ? spr.height * scale * 0.4 : 0);
      this._blit(ctx, spr, sx, sy + 6 + yoff, scale, ref.downed);

      // hit flash
      if (ref.hitFlash > 0) { const sil = this._silhouette(spr); ctx.globalAlpha = clamp(ref.hitFlash * 3, 0, 1); this._blit(ctx, sil, sx, sy + 6 + yoff, scale, ref.downed); ctx.globalAlpha = 1; }

      // rescued survivor marker
      if (item.kind === 'survivor' && ref.rescued) { ctx.fillStyle = '#7fe0a0'; ctx.font = '10px monospace'; ctx.textAlign = 'center'; ctx.fillText('♥', sx, sy - spr.height * scale + 4); }
    }

    _blit(ctx, img, cx, footY, scale, downed) {
      const w = img.width * scale, h = img.height * scale;
      if (downed) {
        ctx.save(); ctx.translate(cx, footY - h * 0.3); ctx.rotate(Math.PI / 2 * 0.9);
        ctx.drawImage(img, -w / 2, -h, w, h); ctx.restore();
        return;
      }
      ctx.drawImage(img, Math.round(cx - w / 2), Math.round(footY - h), Math.round(w), Math.round(h));
    }

    _silhouette(canvas) {
      let sil = this._silCache.get(canvas);
      if (sil) return sil;
      sil = L.makeCanvas(canvas.width, canvas.height);
      const g = sil.getContext('2d');
      g.drawImage(canvas, 0, 0);
      g.globalCompositeOperation = 'source-in';
      g.fillStyle = '#ffffff'; g.fillRect(0, 0, sil.width, sil.height);
      this._silCache.set(canvas, sil);
      return sil;
    }

    _renderLighting(th, ox, oy, minX, maxX, minY, maxY) {
      const octx = this.octx, W = this.vw, H = this.vh;
      const san = this.player.sanity / 100;
      octx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      octx.globalCompositeOperation = 'source-over';
      // base darkness (darker at low sanity)
      const darkA = clamp(0.62 + (1 - san) * 0.22, 0, 0.9);
      octx.fillStyle = `rgba(8,10,7,${darkA})`;
      octx.fillRect(0, 0, W, H);

      octx.globalCompositeOperation = 'destination-out';
      // ceiling light pools
      for (const li of this.world.lights) {
        if (li.x < minX - 2 || li.x > maxX + 2 || li.y < minY - 2 || li.y > maxY + 2) continue;
        const s = iso.worldToScreen(li.x, li.y); const sx = s.x + ox, sy = s.y + oy;
        const fl = 0.82 + Math.sin(this.time * 13 + li.x * 3 + li.y) * 0.08 + (Math.random() < 0.02 ? -0.4 : 0);
        this._lightBlob(octx, sx, sy, 120, fl);
      }
      // exit glow
      { const s = iso.worldToScreen(this.world.exit.x, this.world.exit.y); this._lightBlob(octx, s.x + ox, s.y + oy - 10, 90, 0.7 + Math.sin(this.time * 4) * 0.15); }
      // player ambient + flashlight
      const ps = iso.worldToScreen(this.player.x, this.player.y); const psx = ps.x + ox, psy = ps.y + oy - 6;
      this._lightBlob(octx, psx, psy, 60, 0.55);
      if (this.player.flashlightOn && this.player.battery > 0) {
        this._flashlight(octx, psx, psy, this.screenAimScreen(), 300, 0.55);
      }
      // muzzle flashes + teammate muzzles
      for (const pt of this.particles) if (pt.kind === 'muzzle') { const s = iso.worldToScreen(pt.x, pt.y); this._lightBlob(octx, s.x + ox, s.y + oy - 8, 90, 1); }
      if (this.player.muzzle > 0) this._lightBlob(octx, psx, psy - 6, 70, 1);
      for (const t of this.teammates) if (t.muzzle > 0 && !t.dead) { const s = iso.worldToScreen(t.x, t.y); this._lightBlob(octx, s.x + ox, s.y + oy - 8, 60, 0.9); }

      octx.globalCompositeOperation = 'source-over';
      // composite darkness over scene
      this.ctx.setTransform(1, 0, 0, 1, 0, 0);
      this.ctx.drawImage(this.overlay, 0, 0);
      this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

      // warm light tint additively in pools (subtle)
      const g2 = this.ctx;
      g2.globalCompositeOperation = 'overlay';
      g2.globalAlpha = 0.10;
      for (const li of this.world.lights) {
        if (li.x < minX - 2 || li.x > maxX + 2 || li.y < minY - 2 || li.y > maxY + 2) continue;
        const s = iso.worldToScreen(li.x, li.y);
        const grad = g2.createRadialGradient(s.x + ox, s.y + oy, 2, s.x + ox, s.y + oy, 110);
        grad.addColorStop(0, th.light); grad.addColorStop(1, 'rgba(0,0,0,0)');
        g2.fillStyle = grad; g2.fillRect(s.x + ox - 120, s.y + oy - 120, 240, 240);
      }
      g2.globalAlpha = 1; g2.globalCompositeOperation = 'source-over';
    }
    _lightBlob(octx, sx, sy, r, intensity) {
      const grad = octx.createRadialGradient(sx, sy, r * 0.1, sx, sy, r);
      grad.addColorStop(0, `rgba(255,255,255,${intensity})`);
      grad.addColorStop(0.6, `rgba(255,255,255,${intensity * 0.5})`);
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      octx.fillStyle = grad; octx.beginPath(); octx.arc(sx, sy, r, 0, 7); octx.fill();
    }
    _flashlight(octx, sx, sy, ang, len, intensity) {
      const half = 0.42;
      octx.save();
      octx.beginPath(); octx.moveTo(sx, sy);
      octx.arc(sx, sy, len, ang - half, ang + half); octx.closePath(); octx.clip();
      const grad = octx.createRadialGradient(sx, sy, 8, sx, sy, len);
      grad.addColorStop(0, `rgba(255,255,255,${intensity})`);
      grad.addColorStop(0.7, `rgba(255,255,255,${intensity * 0.4})`);
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      octx.fillStyle = grad; octx.fillRect(sx - len, sy - len, len * 2, len * 2);
      octx.restore();
    }

    _renderAtmosphere(dt) {
      const ctx = this.ctx, W = this.vw, H = this.vh;
      const san = this.player ? this.player.sanity / 100 : 1;
      // vignette
      const vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.7);
      vg.addColorStop(0, 'rgba(0,0,0,0)');
      vg.addColorStop(1, `rgba(0,0,0,${0.55 + (1 - san) * 0.3})`);
      ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);

      // damage flash
      if (this.dmgFlash > 0) { ctx.fillStyle = `rgba(140,10,10,${this.dmgFlash * 0.35})`; ctx.fillRect(0, 0, W, H); }

      // low sanity chromatic-ish edges (red/cyan vignette)
      if (san < 0.6) {
        const amt = (0.6 - san);
        ctx.globalCompositeOperation = 'screen';
        ctx.fillStyle = `rgba(120,0,0,${amt * 0.12 * (0.7 + Math.sin(this.time * 2) * 0.3)})`;
        ctx.fillRect(0, 0, W, H);
        ctx.globalCompositeOperation = 'source-over';
      }

      // grain
      ctx.globalAlpha = 0.05 + (1 - san) * 0.05;
      const gt = this.assets.carpetNoise;
      const gx = (Math.random() * 64) | 0, gy = (Math.random() * 64) | 0;
      ctx.imageSmoothingEnabled = false;
      for (let y = -gy; y < H; y += 64) for (let x = -gx; x < W; x += 64) ctx.drawImage(gt, x, y);
      ctx.globalAlpha = 1;

      // scanlines
      ctx.fillStyle = 'rgba(0,0,0,0.08)';
      for (let y = 0; y < H; y += 3) ctx.fillRect(0, y, W, 1);

      // occasional static bar at low sanity
      if (san < 0.4 && Math.random() < 0.06) {
        const by = Math.random() * H; const bh = 4 + Math.random() * 30;
        ctx.fillStyle = `rgba(255,255,255,${Math.random() * 0.06})`;
        ctx.fillRect(0, by, W, bh);
      }
    }

    _renderPrompts(ctx, ox, oy) {
      const p = this.player;
      ctx.font = 'bold 13px monospace'; ctx.textAlign = 'center';
      const drawPrompt = (wx, wy, text, col) => {
        const s = iso.worldToScreen(wx, wy); const sx = s.x + ox, sy = s.y + oy - 44;
        ctx.fillStyle = 'rgba(0,0,0,0.6)'; const w = ctx.measureText(text).width + 12;
        ctx.fillRect(sx - w / 2, sy - 12, w, 16);
        ctx.fillStyle = col; ctx.fillText(text, sx, sy);
      };
      for (const s of this.survivors) {
        if (s.rescued || s.dead || s.saved) continue;
        if (dist(s.x, s.y, p.x, p.y) < 1.5) drawPrompt(s.x, s.y, '[E] RESCUE', '#8fe0a8');
      }
      if (dist(this.world.exit.x, this.world.exit.y, p.x, p.y) < 1.6) {
        drawPrompt(this.world.exit.x, this.world.exit.y, '[E] DESCEND', '#a0e8f0');
      }
      // revive bar
      if (this.reviveProgress > 0) {
        const W = this.vw; ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(W / 2 - 80, this.vh - 120, 160, 12);
        ctx.fillStyle = '#7fe0a0'; ctx.fillRect(W / 2 - 78, this.vh - 118, 156 * this.reviveProgress, 8);
        ctx.fillStyle = '#cfeede'; ctx.fillText('REVIVING...', W / 2, this.vh - 128);
      }

      // transition banner
      if (this.transition) {
        const a = this.transition.t < 0.4 ? this.transition.t / 0.4 : clamp((this.transition.dur - this.transition.t) / 0.8, 0, 1);
        ctx.globalAlpha = a; ctx.textAlign = 'center';
        ctx.fillStyle = '#e8dfae'; ctx.font = 'bold 30px monospace';
        ctx.fillText(this.transition.name, this.vw / 2, this.vh / 2 - 10);
        ctx.fillStyle = '#9a9678'; ctx.font = '15px monospace';
        ctx.fillText(this.transition.blurb, this.vw / 2, this.vh / 2 + 18);
        ctx.globalAlpha = 1;
      }
    }

    // ---- HUD (DOM) ------------------------------------------------------------
    updateHUD() {
      const p = this.player;
      const set = (id, v) => { const e = document.getElementById(id); if (e) e.style.width = clamp(v, 0, 100) + '%'; };
      set('bar-hp', p.hp); set('bar-san', p.sanity); set('bar-stam', p.stamina); set('bar-batt', p.battery);
      const wq = document.getElementById('hud-weapon');
      if (wq) { const w = p.weapon(); const ammo = w.ammo === 'none' ? '∞' : p.ammo[w.ammo]; wq.textContent = w.name + '  ' + (w.ammo === 'none' ? '' : ammo); }
      const obj = document.getElementById('hud-obj');
      if (obj) { const rescued = this.survivors.filter(s => s.rescued && !s.saved && !s.dead).length; const remain = this.survivors.filter(s => !s.rescued && !s.dead && !s.saved).length; obj.textContent = 'FOLLOWING: ' + rescued + '   STILL LOST: ' + remain; }
      const lvl = document.getElementById('hud-level');
      if (lvl) lvl.textContent = this.world.theme.name + '   ·   DEPTH ' + this.levelIndex + '   ·   SAVED ' + this.saved + '  LOST ' + this.lost;
      const mates = document.getElementById('hud-mates');
      if (mates) mates.innerHTML = this.teammates.map(t => {
        if (t.dead) return `<span class="mate dead">${t.name} ✝</span>`;
        if (t.downed) return `<span class="mate down">${t.name} ⤓</span>`;
        const pct = Math.round(clamp(t.hp / t.maxHp * 100, 0, 100));
        return `<span class="mate">${t.name} ${pct}%</span>`;
      }).join('');
      const logEl = document.getElementById('hud-log');
      if (logEl) logEl.innerHTML = this.logs.map(l => `<div style="opacity:${clamp(l.t / 3, 0, 1)}">${l.msg}</div>`).join('');
    }

    fillDeathScreen() {
      const set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
      set('death-depth', this.levelIndex);
      set('death-saved', this.saved);
      set('death-lost', this.lost + this.survivors.filter(s => !s.saved && !s.dead).length);
      set('death-kills', this.kills);
    }
  }

  L.Game = Game;
  global.addEventListener('load', () => { global.GAME = new Game(); });

})(typeof window !== 'undefined' ? window : this);
