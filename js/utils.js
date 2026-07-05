/* =============================================================================
   LIMINAL.CO — utils.js
   Math, seeded RNG, vectors, small helpers. Attaches to global L namespace.
   ============================================================================= */
(function (global) {
  'use strict';

  const L = global.L || (global.L = {});

  // ---- Seeded RNG (mulberry32) ------------------------------------------------
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // A tiny RNG object with helpers built on a seed.
  class RNG {
    constructor(seed) {
      this.seed = (seed >>> 0) || 1;
      this._r = mulberry32(this.seed);
    }
    next() { return this._r(); }                       // [0,1)
    range(a, b) { return a + (b - a) * this._r(); }    // [a,b)
    int(a, b) { return Math.floor(this.range(a, b + 1)); } // inclusive ints
    pick(arr) { return arr[Math.floor(this._r() * arr.length)]; }
    chance(p) { return this._r() < p; }
    sign() { return this._r() < 0.5 ? -1 : 1; }
    shuffle(arr) {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(this._r() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    }
  }

  // ---- Math helpers -----------------------------------------------------------
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const dist2 = (ax, ay, bx, by) => { const dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; };
  const dist = (ax, ay, bx, by) => Math.sqrt(dist2(ax, ay, bx, by));
  const len = (x, y) => Math.hypot(x, y);
  const angleTo = (ax, ay, bx, by) => Math.atan2(by - ay, bx - ax);
  const angLerp = (a, b, t) => {
    let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
    if (d < -Math.PI) d += Math.PI * 2;
    return a + d * t;
  };
  const norm = (x, y) => { const l = Math.hypot(x, y) || 1; return [x / l, y / l]; };
  const approach = (v, target, step) => (v < target ? Math.min(v + step, target) : Math.max(v - step, target));

  // Smooth noise-ish flicker generator (deterministic per call sequence).
  function makeFlicker(rng, baseHz) {
    let t = 0, val = 1, targ = 1, nextChange = 0;
    return function (dt) {
      t += dt;
      if (t >= nextChange) {
        nextChange = t + rng.range(0.04, 0.22) / (baseHz || 1);
        targ = rng.chance(0.12) ? rng.range(0.3, 0.7) : rng.range(0.86, 1.0);
      }
      val = lerp(val, targ, clamp(dt * 14, 0, 1));
      return val;
    };
  }

  L.mulberry32 = mulberry32;
  L.RNG = RNG;
  L.clamp = clamp;
  L.lerp = lerp;
  L.dist = dist;
  L.dist2 = dist2;
  L.len = len;
  L.norm = norm;
  L.angleTo = angleTo;
  L.angLerp = angLerp;
  L.approach = approach;
  L.makeFlicker = makeFlicker;

})(typeof window !== 'undefined' ? window : this);
