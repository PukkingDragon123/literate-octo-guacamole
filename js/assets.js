/* =============================================================================
   LIMINAL.CO — assets.js
   Procedural pixel-art sprite generation. Everything is drawn to small offscreen
   canvases at load, then blitted with nearest-neighbor scaling by the renderer.
   No image files are shipped; the whole look is generated in code.
   ============================================================================= */
(function (global) {
  'use strict';
  const L = global.L || (global.L = {});

  function makeCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    return c;
  }
  const px = (g, x, y, w, h, col) => { g.fillStyle = col; g.fillRect(x | 0, y | 0, w | 0, h | 0); };

  function mirror(src) {
    const c = makeCanvas(src.width, src.height);
    const g = c.getContext('2d');
    g.translate(src.width, 0); g.scale(-1, 1);
    g.drawImage(src, 0, 0);
    return c;
  }

  // ---- Humanoid (worker / teammate / survivor) --------------------------------
  // facing: 0=S(front) 1=E(right) 2=N(back). West is mirror of East.
  // pal: skin, skinSh, hair, vest, vestSh, pants, pantsSh, boot, out, hat
  function drawHuman(pal, facing, frame) {
    const W = 18, H = 26, c = makeCanvas(W, H), g = c.getContext('2d');
    const cx = 9;
    const legShift = frame === 1 ? 1 : 0;
    const O = pal.out;

    // shadow
    px(g, cx - 5, H - 2, 10, 2, 'rgba(0,0,0,0.25)');

    // legs
    const lyTop = 17, lyH = 7;
    px(g, cx - 4, lyTop, 3, lyH, O); px(g, cx + 1, lyTop, 3, lyH, O);
    px(g, cx - 4 + (facing === 1 ? legShift : 0), lyTop, 2, lyH - 1, pal.pants);
    px(g, cx + 2 - (facing === 1 ? legShift : 0), lyTop, 2, lyH - 1, pal.pantsSh);
    // boots
    px(g, cx - 4, H - 3, 3, 2, pal.boot); px(g, cx + 1, H - 3, 3, 2, pal.boot);

    // torso / vest
    const ty = 9, th = 8;
    px(g, cx - 5, ty, 10, th, O);
    px(g, cx - 4, ty + 1, 8, th - 1, pal.vest);
    // vest shading + hi-vis stripe
    px(g, cx + 1, ty + 1, 3, th - 1, pal.vestSh);
    px(g, cx - 4, ty + 3, 8, 1, pal.stripe || '#f6f0c0');
    if (facing === 2) { // backpack when facing away
      px(g, cx - 3, ty + 1, 6, 5, pal.hat || '#3a3a44');
      px(g, cx - 2, ty + 2, 4, 3, '#2b2b33');
    }
    // arms
    px(g, cx - 6, ty + 1, 2, 6, O); px(g, cx + 4, ty + 1, 2, 6, O);
    px(g, cx - 6, ty + 1, 1, 5, pal.vestSh); px(g, cx + 5, ty + 1, 1, 5, pal.vest);
    // hands
    px(g, cx - 6, ty + 6, 2, 2, pal.skin); px(g, cx + 4, ty + 6, 2, 2, pal.skin);

    // head
    const hy = 2, hh = 7;
    px(g, cx - 4, hy, 8, hh, O);
    px(g, cx - 3, hy + 1, 6, hh - 1, pal.skin);
    // hat / hard-hat
    if (pal.hat) {
      px(g, cx - 4, hy, 8, 2, pal.hat);
      px(g, cx - 5, hy + 1, 10, 1, pal.hat);
    } else {
      px(g, cx - 3, hy, 6, 2, pal.hair);
    }
    if (facing === 0) { // front face
      px(g, cx - 2, hy + 3, 1, 2, O); px(g, cx + 1, hy + 3, 1, 2, O); // eyes
      px(g, cx - 1, hy + 5, 3, 1, pal.skinSh);
    } else if (facing === 2) { // back of head
      px(g, cx - 3, hy + 1, 6, 4, pal.hair);
    } else { // profile (east)
      px(g, cx + 1, hy + 3, 1, 2, O); // one eye
      px(g, cx - 3, hy + 1, 3, 4, pal.hair);
      px(g, cx + 3, hy + 3, 1, 2, pal.skinSh); // nose
    }
    return c;
  }

  function humanSet(pal) {
    const set = { S: [], E: [], N: [], W: [] };
    for (let f = 0; f < 2; f++) {
      set.S.push(drawHuman(pal, 0, f));
      set.E.push(drawHuman(pal, 1, f));
      set.N.push(drawHuman(pal, 2, f));
      set.W.push(mirror(set.E[f]));
    }
    return set;
  }

  // ---- Entities (monsters) ----------------------------------------------------
  function drawSmiler(frame) {
    // Tall dark figure, only a wide grin + eyes glow. Backrooms "Smiler".
    const W = 20, H = 30, c = makeCanvas(W, H), g = c.getContext('2d');
    const cx = 10;
    px(g, cx - 6, H - 2, 12, 2, 'rgba(0,0,0,0.3)');
    // body — inky, ragged
    for (let y = 6; y < H - 2; y++) {
      const wob = Math.sin((y + frame * 3) * 0.6) * 1.2;
      const w = 7 - (y - 6) * 0.06;
      px(g, cx - w + wob, y, w * 2, 1, y % 2 ? '#0b0d0b' : '#141712');
    }
    // head
    px(g, cx - 6, 2, 12, 8, '#0a0c0a');
    // glowing grin
    const grin = '#eef0c8';
    for (let i = -4; i <= 4; i++) {
      const yy = 7 + Math.abs(i) * 0.4;
      px(g, cx + i, yy, 1, 1, grin);
    }
    px(g, cx - 4, 6, 1, 1, grin); px(g, cx + 3, 6, 1, 1, grin);
    // eyes
    px(g, cx - 3, 4, 2, 2, '#f4f6d0'); px(g, cx + 1, 4, 2, 2, '#f4f6d0');
    return c;
  }

  function drawHound(frame) {
    // Low, fast quadruped.
    const W = 26, H = 18, c = makeCanvas(W, H), g = c.getContext('2d');
    px(g, 3, H - 2, 20, 2, 'rgba(0,0,0,0.3)');
    const O = '#0c0e0c';
    // body
    px(g, 5, 6, 15, 7, O); px(g, 6, 7, 13, 5, '#242017');
    // head
    px(g, 18, 5, 7, 6, O); px(g, 19, 6, 5, 4, '#2c261a');
    px(g, 23, 7, 2, 1, '#c94b2b'); // snout/teeth
    px(g, 21, 6, 1, 1, '#e86b2b'); // eye
    // legs (animated)
    const s = frame === 1 ? 2 : 0;
    px(g, 6 + s, 12, 2, 5, O); px(g, 11 - s, 12, 2, 5, O);
    px(g, 15 + s, 12, 2, 5, O); px(g, 18 - s, 12, 2, 5, O);
    // tail
    px(g, 2, 5, 4, 2, O);
    return c;
  }

  function drawLurker(frame) {
    // Bloated, ranged spitter — pale and sickly.
    const W = 22, H = 24, c = makeCanvas(W, H), g = c.getContext('2d');
    const cx = 11;
    px(g, cx - 6, H - 2, 12, 2, 'rgba(0,0,0,0.3)');
    const O = '#141410';
    const bob = frame === 1 ? 1 : 0;
    px(g, cx - 6, 8 + bob, 12, 12, O);
    px(g, cx - 5, 9 + bob, 10, 10, '#8a8a5a');
    px(g, cx - 3, 11 + bob, 6, 5, '#a6a66e'); // pale belly
    // head lump
    px(g, cx - 3, 3 + bob, 6, 6, O); px(g, cx - 2, 4 + bob, 4, 4, '#9a9a62');
    px(g, cx - 1, 5 + bob, 1, 1, '#d8452b'); px(g, cx + 1, 5 + bob, 1, 1, '#d8452b'); // eyes
    // little limbs
    px(g, cx - 7, 14 + bob, 2, 5, O); px(g, cx + 5, 14 + bob, 2, 5, O);
    return c;
  }

  function drawWailer(frame) {
    // Floating sanity-drainer — translucent, drifting.
    const W = 20, H = 26, c = makeCanvas(W, H), g = c.getContext('2d');
    const cx = 10;
    const drift = frame === 1 ? 1 : -1;
    // wispy trailing body
    for (let y = 6; y < H; y++) {
      const t = (y - 6) / (H - 6);
      const w = (6 - t * 5);
      const a = 0.5 * (1 - t);
      g.fillStyle = `rgba(150,160,180,${a.toFixed(3)})`;
      const wob = Math.sin(y * 0.5 + drift) * 2;
      g.fillRect((cx - w + wob) | 0, y, (w * 2) | 0, 1);
    }
    // hollow face
    px(g, cx - 5, 2, 10, 8, 'rgba(90,100,120,0.75)');
    px(g, cx - 3, 4, 2, 3, '#05060a'); px(g, cx + 1, 4, 2, 3, '#05060a'); // eye holes
    px(g, cx - 2, 8, 4, 2, '#05060a'); // wailing mouth
    return c;
  }

  function entitySet(drawFn) { return [drawFn(0), drawFn(1)]; }

  // ---- Items ------------------------------------------------------------------
  function drawMedkit() {
    const c = makeCanvas(12, 12), g = c.getContext('2d');
    px(g, 1, 2, 10, 8, '#12140f'); px(g, 2, 3, 8, 6, '#d8d2c0');
    px(g, 5, 4, 2, 4, '#c23a2a'); px(g, 4, 5, 4, 2, '#c23a2a'); // red cross
    return c;
  }
  function drawBattery() {
    const c = makeCanvas(12, 12), g = c.getContext('2d');
    px(g, 3, 2, 6, 9, '#12140f'); px(g, 4, 1, 4, 1, '#12140f');
    px(g, 4, 3, 4, 7, '#e3c33a'); px(g, 4, 6, 4, 1, '#0c0c0a');
    px(g, 5, 4, 1, 2, '#fff2a0');
    return c;
  }
  function drawAmmo() {
    const c = makeCanvas(12, 12), g = c.getContext('2d');
    px(g, 1, 4, 10, 6, '#2a2a1c'); px(g, 2, 5, 8, 4, '#5a5030');
    px(g, 3, 3, 1, 3, '#c9a23a'); px(g, 5, 3, 1, 3, '#c9a23a'); px(g, 7, 3, 1, 3, '#c9a23a');
    return c;
  }
  function drawWeaponPickup(kind) {
    const c = makeCanvas(16, 10), g = c.getContext('2d');
    px(g, 1, 5, 14, 3, '#15140f');
    if (kind === 'shotgun') { px(g, 2, 4, 12, 3, '#3a2a1a'); px(g, 2, 4, 8, 1, '#6a5030'); }
    else if (kind === 'smg') { px(g, 2, 3, 9, 4, '#2a2c2e'); px(g, 5, 6, 2, 3, '#1a1c1e'); }
    else { px(g, 3, 4, 8, 3, '#2c2e30'); px(g, 4, 6, 2, 2, '#1a1c1e'); }
    return c;
  }

  // ---- Props ------------------------------------------------------------------
  function drawExit(frame) {
    // "Noclip" extraction rift — a shimmering vertical tear.
    const W = 28, H = 44, c = makeCanvas(W, H), g = c.getContext('2d');
    const cx = 14;
    for (let y = 0; y < H; y++) {
      const t = y / H;
      const w = (2 + Math.sin(t * 3.14) * 8) * (1 + Math.sin(y * 0.4 + frame) * 0.15);
      const hue = 190 + Math.sin(t * 6 + frame) * 20;
      g.fillStyle = `hsla(${hue},60%,${60 + Math.sin(y * 0.5) * 15}%,0.85)`;
      g.fillRect((cx - w / 2) | 0, y, w | 0, 1);
    }
    // bright core
    px(g, cx - 1, 2, 2, H - 4, 'rgba(240,255,255,0.9)');
    return c;
  }

  function drawLightFixture() {
    const c = makeCanvas(24, 12), g = c.getContext('2d');
    px(g, 2, 3, 20, 4, '#1a1a12');
    px(g, 3, 4, 18, 2, '#f8f4cc');
    return c;
  }

  function drawPillar() {
    // A partial standing wall segment / column prop.
    const c = makeCanvas(20, 40), g = c.getContext('2d');
    px(g, 4, 4, 12, 34, '#141410');
    px(g, 5, 5, 10, 32, '#b8a866');
    px(g, 5, 5, 4, 32, '#c8b876');
    for (let y = 8; y < 36; y += 4) px(g, 5, y, 10, 1, '#9a8a4e');
    return c;
  }

  // ---- Noise textures (for carpet / wallpaper overlays) -----------------------
  function noiseTexture(w, h, base, amp, alpha) {
    const c = makeCanvas(w, h), g = c.getContext('2d');
    const img = g.createImageData(w, h);
    for (let i = 0; i < w * h; i++) {
      const n = (Math.random() - 0.5) * amp;
      img.data[i * 4 + 0] = base[0] + n;
      img.data[i * 4 + 1] = base[1] + n;
      img.data[i * 4 + 2] = base[2] + n;
      img.data[i * 4 + 3] = alpha;
    }
    g.putImageData(img, 0, 0);
    return c;
  }

  // ---- Build registry ---------------------------------------------------------
  function build() {
    const A = {};

    A.player = humanSet({
      skin: '#d8a878', skinSh: '#b8865a', hair: '#3a2a1a',
      vest: '#e8b52a', vestSh: '#c8952a', stripe: '#fff6c0',
      pants: '#3a3f4a', pantsSh: '#2a2f38', boot: '#1a1a18',
      out: '#0d0f0c', hat: '#e8b52a'
    });
    A.teammates = [
      humanSet({ skin: '#c89060', skinSh: '#a06a44', hair: '#1a1a1a', vest: '#e07b2a', vestSh: '#b85f1a', stripe: '#ffe0a0', pants: '#33383f', pantsSh: '#242830', boot: '#181816', out: '#0d0f0c', hat: '#d8d2c0' }),
      humanSet({ skin: '#e0b890', skinSh: '#bd9366', hair: '#5a3a1a', vest: '#3a8a6a', vestSh: '#2a6a50', stripe: '#c0f0d8', pants: '#3a3540', pantsSh: '#2a2630', boot: '#181816', out: '#0d0f0c', hat: '#d8d2c0' }),
      humanSet({ skin: '#b87850', skinSh: '#96603c', hair: '#2a1a10', vest: '#8a5aa8', vestSh: '#6a4288', stripe: '#e8d0f0', pants: '#33383f', pantsSh: '#242830', boot: '#181816', out: '#0d0f0c', hat: '#d8d2c0' })
    ];
    A.survivor = humanSet({
      skin: '#c89878', skinSh: '#a67456', hair: '#4a4038',
      vest: '#8a8478', vestSh: '#6a655c', stripe: '#9a948a',
      pants: '#4a4640', pantsSh: '#38352f', boot: '#201e1a',
      out: '#0d0f0c', hat: null
    });

    A.entities = {
      smiler: entitySet(drawSmiler),
      hound: entitySet(drawHound),
      lurker: entitySet(drawLurker),
      wailer: entitySet(drawWailer)
    };

    A.items = {
      medkit: drawMedkit(),
      battery: drawBattery(),
      ammo: drawAmmo(),
      pistol: drawWeaponPickup('pistol'),
      shotgun: drawWeaponPickup('shotgun'),
      smg: drawWeaponPickup('smg')
    };

    A.exit = entitySet(drawExit);
    A.light = drawLightFixture();
    A.pillar = drawPillar();

    A.carpetNoise = noiseTexture(64, 64, [0, 0, 0], 26, 30);
    A.wallNoise = noiseTexture(48, 48, [0, 0, 0], 22, 26);

    return A;
  }

  L.buildAssets = build;
  L.makeCanvas = makeCanvas;

})(typeof window !== 'undefined' ? window : this);
