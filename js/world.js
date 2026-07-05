/* =============================================================================
   LIMINAL.CO — world.js
   Procedural level generation. Each "level" of the liminal spaces has a theme
   (palette + layout algorithm). Layouts: pillar halls, room clusters, office
   cubicles, and wide mazes. Connectivity is guaranteed via flood-fill; the exit
   is placed at the reachable cell farthest from spawn.
   ============================================================================= */
(function (global) {
  'use strict';
  const L = global.L || (global.L = {});

  // Themed backrooms "levels". Difficulty scales with index; palette cycles.
  const THEMES = [
    {
      name: 'LEVEL 0 — THE LOBBY',
      blurb: 'Mono-yellow. The hum of ten thousand fluorescent lights.',
      bg: '#20221a',
      floor: ['#c9c18a', '#c3bb82', '#cdc590', '#bfb77e'],
      floorLine: 'rgba(120,110,70,0.35)',
      wallTop: '#d9cf94', wallLeft: '#b6a862', wallRight: '#a89a56', wallEdge: 'rgba(90,80,40,0.5)',
      liquid: null,
      fog: '#23251b',
      light: 'rgba(255,247,200,0.55)', lightSpacing: 5,
      layout: 'pillars'
    },
    {
      name: 'LEVEL ! — DAMP HALLS',
      blurb: 'The walls sweat. Something breathes in the next room.',
      bg: '#1a2018',
      floor: ['#a9ad82', '#a3a77c', '#adb188', '#9da175'],
      floorLine: 'rgba(80,90,60,0.4)',
      wallTop: '#b9bd8c', wallLeft: '#8a9060', wallRight: '#7c8254', wallEdge: 'rgba(60,70,40,0.5)',
      liquid: null,
      fog: '#182018',
      light: 'rgba(230,240,200,0.42)', lightSpacing: 6,
      layout: 'maze'
    },
    {
      name: 'LEVEL 4 — THE OFFICES',
      blurb: 'Abandoned cubicles. Coffee still warm. No one clocked out.',
      bg: '#22201a',
      floor: ['#b8ac86', '#b2a680', '#bcb08a', '#aca07a'],
      floorLine: 'rgba(90,80,55,0.4)',
      wallTop: '#cabf92', wallLeft: '#9a8c5e', wallRight: '#8c7e52', wallEdge: 'rgba(70,60,35,0.5)',
      liquid: null,
      fog: '#201e18',
      light: 'rgba(250,244,205,0.5)', lightSpacing: 5,
      layout: 'offices'
    },
    {
      name: 'LEVEL 37 — THE POOLROOMS',
      blurb: 'Warm water and white tile. Peaceful, and deeply wrong.',
      bg: '#16201f',
      floor: ['#a9c4c0', '#a2bdb9', '#b0cbc7', '#9ab6b2'],
      floorLine: 'rgba(70,110,108,0.4)',
      wallTop: '#c2d6d2', wallLeft: '#7fa3a0', wallRight: '#6f938f', wallEdge: 'rgba(50,90,88,0.5)',
      liquid: '#3e7d86',
      fog: '#122020',
      light: 'rgba(210,240,240,0.5)', lightSpacing: 6,
      layout: 'rooms'
    },
    {
      name: 'LEVEL 5 — HABITABLE ZONE',
      blurb: 'Someone built a home here once. The wallpaper is peeling red.',
      bg: '#241a18',
      floor: ['#b89c86', '#b29680', '#bca08a', '#ac907a'],
      floorLine: 'rgba(100,70,55,0.4)',
      wallTop: '#c8a68e', wallLeft: '#96705c', wallRight: '#886452', wallEdge: 'rgba(80,50,40,0.5)',
      liquid: null,
      fog: '#1e1614',
      light: 'rgba(250,230,205,0.46)', lightSpacing: 6,
      layout: 'rooms'
    }
  ];

  class World {
    constructor(levelIndex, rng) {
      this.levelIndex = levelIndex;
      this.rng = rng;
      this.theme = THEMES[levelIndex % THEMES.length];
      // world grows a little with depth, capped
      const grow = Math.min(levelIndex * 2, 20);
      this.w = 42 + grow;
      this.h = 42 + grow;
      const n = this.w * this.h;
      this.wall = new Uint8Array(n);
      this.liquid = new Uint8Array(n);
      this.variant = new Uint8Array(n);
      this.lights = [];
      this.openCells = [];
      this.spawn = { x: 2, y: 2 };
      this.exit = { x: this.w - 3, y: this.h - 3 };
      this._generate();
    }

    idx(x, y) { return y * this.w + x; }
    inBounds(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h; }
    isWall(x, y) { return !this.inBounds(x, y) || this.wall[this.idx(x, y)] === 1; }
    isLiquid(x, y) { return this.inBounds(x, y) && this.liquid[this.idx(x, y)] === 1; }
    isBlocked(x, y) { return this.isWall(x, y) || this.isLiquid(x, y); }
    isOpen(x, y) { return this.inBounds(x, y) && this.wall[this.idx(x, y)] === 0 && this.liquid[this.idx(x, y)] === 0; }

    _fill(v) { this.wall.fill(v); }
    _carve(x, y) { if (this.inBounds(x, y)) this.wall[this.idx(x, y)] = 0; }
    _setWall(x, y) { if (this.inBounds(x, y)) this.wall[this.idx(x, y)] = 1; }

    _generate() {
      const rng = this.rng;
      // random floor variants everywhere
      for (let i = 0; i < this.variant.length; i++) this.variant[i] = rng.int(0, this.theme.floor.length - 1);

      switch (this.theme.layout) {
        case 'pillars': this._genPillars(); break;
        case 'rooms': this._genRooms(); break;
        case 'offices': this._genOffices(); break;
        case 'maze': this._genMaze(); break;
        default: this._genPillars();
      }
      this._border();
      this._finalize();
    }

    _border() {
      for (let x = 0; x < this.w; x++) { this._setWall(x, 0); this._setWall(x, this.h - 1); }
      for (let y = 0; y < this.h; y++) { this._setWall(0, y); this._setWall(this.w - 1, y); }
    }

    // Iconic open hall with a lattice of pillars.
    _genPillars() {
      this._fill(0); // all floor
      const rng = this.rng;
      const sp = 3 + rng.int(0, 1);
      for (let y = 2; y < this.h - 2; y += sp) {
        for (let x = 2; x < this.w - 2; x += sp) {
          if (rng.chance(0.22)) continue; // gaps
          const jx = x + rng.int(-1, 1), jy = y + rng.int(-1, 1);
          this._setWall(jx, jy);
          if (rng.chance(0.35)) this._setWall(jx + 1, jy); // occasional doubles
        }
      }
    }

    // Room clusters connected by corridors.
    _genRooms() {
      this._fill(1);
      const rng = this.rng;
      const rooms = [];
      const target = 8 + Math.floor(this.w / 8);
      for (let a = 0; a < target * 6 && rooms.length < target; a++) {
        const rw = rng.int(5, 10), rh = rng.int(5, 9);
        const rx = rng.int(2, this.w - rw - 2), ry = rng.int(2, this.h - rh - 2);
        let overlap = false;
        for (const r of rooms) {
          if (rx < r.x + r.w + 1 && rx + rw + 1 > r.x && ry < r.y + r.h + 1 && ry + rh + 1 > r.y) { overlap = true; break; }
        }
        if (overlap && rooms.length > 3) continue;
        for (let y = ry; y < ry + rh; y++) for (let x = rx; x < rx + rw; x++) this._carve(x, y);
        rooms.push({ x: rx, y: ry, w: rw, h: rh, cx: (rx + rw / 2) | 0, cy: (ry + rh / 2) | 0 });
      }
      // connect
      for (let i = 1; i < rooms.length; i++) this._corridor(rooms[i - 1], rooms[i]);
      // a couple of loops
      for (let k = 0; k < 3 && rooms.length > 4; k++) this._corridor(rng.pick(rooms), rng.pick(rooms));
      // optional water pools
      if (this.theme.liquid) {
        for (const r of rooms) {
          if (rng.chance(0.5)) {
            const px = r.x + 1 + rng.int(0, Math.max(0, r.w - 4));
            const py = r.y + 1 + rng.int(0, Math.max(0, r.h - 4));
            const pw = rng.int(2, Math.max(2, r.w - 3)), ph = rng.int(2, Math.max(2, r.h - 3));
            for (let y = py; y < py + ph && y < r.y + r.h - 1; y++)
              for (let x = px; x < px + pw && x < r.x + r.w - 1; x++)
                if (!this.isWall(x, y)) this.liquid[this.idx(x, y)] = 1;
          }
        }
      }
      this._rooms = rooms;
    }

    _corridor(a, b) {
      let x = a.cx, y = a.cy;
      const carveWide = (cx, cy) => { this._carve(cx, cy); this._carve(cx + 1, cy); this._carve(cx, cy + 1); };
      while (x !== b.cx) { carveWide(x, y); x += x < b.cx ? 1 : -1; }
      while (y !== b.cy) { carveWide(x, y); y += y < b.cy ? 1 : -1; }
      carveWide(x, y);
    }

    // Grid of cubicle rooms with doorways.
    _genOffices() {
      this._fill(1);
      const rng = this.rng;
      const bs = 8; // block size
      for (let by = 1; by < this.h - bs; by += bs) {
        for (let bx = 1; bx < this.w - bs; bx += bs) {
          const rw = bs - 1, rh = bs - 1;
          for (let y = by; y < by + rh - 1; y++) for (let x = bx; x < bx + rw - 1; x++) this._carve(x, y);
          // doors to the right and down neighbours
          const doorY = by + rng.int(1, rh - 3);
          const doorX = bx + rng.int(1, rw - 3);
          this._carve(bx + rw - 1, doorY); this._carve(bx + rw, doorY);
          this._carve(doorX, by + rh - 1); this._carve(doorX, by + rh);
          // a few interior desks (single pillars)
          if (rng.chance(0.7)) this._setWall(bx + rng.int(1, rw - 3), by + rng.int(1, rh - 3));
        }
      }
    }

    // Wide randomized maze (2-cell corridors).
    _genMaze() {
      this._fill(1);
      const rng = this.rng;
      const cw = Math.floor((this.w - 1) / 3), ch = Math.floor((this.h - 1) / 3);
      const visited = new Uint8Array(cw * ch);
      const stack = [[0, 0]];
      visited[0] = 1;
      const cellToTile = (cx, cy) => [1 + cx * 3, 1 + cy * 3];
      const carveCell = (cx, cy) => {
        const [tx, ty] = cellToTile(cx, cy);
        for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) this._carve(tx + x, ty + y);
      };
      carveCell(0, 0);
      while (stack.length) {
        const [cx, cy] = stack[stack.length - 1];
        const nb = [];
        if (cx > 0 && !visited[cy * cw + (cx - 1)]) nb.push([cx - 1, cy, -1, 0]);
        if (cx < cw - 1 && !visited[cy * cw + (cx + 1)]) nb.push([cx + 1, cy, 1, 0]);
        if (cy > 0 && !visited[(cy - 1) * cw + cx]) nb.push([cx, cy - 1, 0, -1]);
        if (cy < ch - 1 && !visited[(cy + 1) * cw + cx]) nb.push([cx, cy + 1, 0, 1]);
        if (!nb.length) { stack.pop(); continue; }
        const [nx, ny, dx, dy] = rng.pick(nb);
        // carve wall between
        const [tx, ty] = cellToTile(cx, cy);
        for (let s = 0; s < 3; s++) { this._carve(tx + dx * s + (dy ? 0 : 0), ty + dy * s); }
        for (let s = 0; s < 3; s++) { this._carve(tx + dx * s, ty + dy * s); this._carve(tx + dx * s + (dy !== 0 ? 1 : 0), ty + dy * s + (dx !== 0 ? 1 : 0)); }
        carveCell(nx, ny);
        visited[ny * cw + nx] = 1;
        stack.push([nx, ny]);
      }
      // punch some loops so it's less claustrophobic
      for (let k = 0; k < cw * ch * 0.15; k++) {
        const x = rng.int(2, this.w - 3), y = rng.int(2, this.h - 3);
        this._carve(x, y); this._carve(x + 1, y);
      }
    }

    _finalize() {
      const rng = this.rng;
      // pick a spawn: first open cell scanning from a random-ish corner
      let spawn = null;
      for (let y = 2; y < this.h - 2 && !spawn; y++)
        for (let x = 2; x < this.w - 2 && !spawn; x++)
          if (this.isOpen(x, y)) spawn = { x, y };
      if (!spawn) { this._carve(2, 2); spawn = { x: 2, y: 2 }; }
      this.spawn = spawn;

      // BFS reachability + distance from spawn
      const dist = new Int32Array(this.w * this.h).fill(-1);
      const q = [this.idx(spawn.x, spawn.y)];
      dist[q[0]] = 0;
      let head = 0, far = q[0], farD = 0;
      while (head < q.length) {
        const cur = q[head++]; const cx = cur % this.w, cy = (cur / this.w) | 0;
        const d = dist[cur];
        if (d > farD) { farD = d; far = cur; }
        const ns = [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]];
        for (const [nx, ny] of ns) {
          if (!this.isOpen(nx, ny)) continue;
          const ni = this.idx(nx, ny);
          if (dist[ni] !== -1) continue;
          dist[ni] = d + 1; q.push(ni);
        }
      }
      this.dist = dist;
      this.exit = { x: far % this.w, y: (far / this.w) | 0 };

      // reachable open cells (exclude too-close-to-spawn for spawns list)
      this.openCells = [];
      for (let i = 0; i < dist.length; i++) {
        if (dist[i] >= 0) {
          const x = i % this.w, y = (i / this.w) | 0;
          this.openCells.push({ x, y, d: dist[i] });
        }
      }

      // ceiling lights on a coarse lattice over reachable floor
      const sp = this.theme.lightSpacing;
      for (let y = 2; y < this.h - 2; y += sp) {
        for (let x = 2; x < this.w - 2; x += sp) {
          if (this.isOpen(x, y) && dist[this.idx(x, y)] >= 0) {
            const jx = x + rng.int(-1, 1), jy = y + rng.int(-1, 1);
            if (this.isOpen(jx, jy)) this.lights.push({ x: jx, y: jy });
            else this.lights.push({ x, y });
          }
        }
      }
      // guarantee light at spawn and exit
      this.lights.push({ x: spawn.x, y: spawn.y });
      this.lights.push({ x: this.exit.x, y: this.exit.y });
    }

    // Get a spawn cell at least minD from spawn (for enemies/survivors).
    randomOpen(minD, maxD) {
      const rng = this.rng;
      const pool = this.openCells.filter(c => c.d >= (minD || 0) && (maxD == null || c.d <= maxD));
      const src = pool.length ? pool : this.openCells;
      return rng.pick(src);
    }
  }

  L.World = World;
  L.THEMES = THEMES;

})(typeof window !== 'undefined' ? window : this);
