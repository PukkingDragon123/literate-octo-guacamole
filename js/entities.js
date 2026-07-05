/* =============================================================================
   LIMINAL.CO — entities.js
   Actors: Player, Teammate, Survivor, Enemy (4 kinds), Bullet, Spit, Item.
   Positions are in fractional tile coordinates; tile (i,j) is centered at (i,j).
   Enemies/teammates navigate via a flow-field computed by game.js (game.navDir).
   ============================================================================= */
(function (global) {
  'use strict';
  const L = global.L || (global.L = {});
  const { clamp, dist, norm, angleTo, angLerp } = L;

  // ---- collision --------------------------------------------------------------
  function blockedAt(world, x, y, r) {
    // check the 4 corners of the entity's bounding box against blocked cells
    const pts = [[x - r, y - r], [x + r, y - r], [x - r, y + r], [x + r, y + r]];
    for (const [px, py] of pts) {
      if (world.isBlocked(Math.round(px), Math.round(py))) return true;
    }
    return false;
  }
  function moveEntity(e, dx, dy, world) {
    const r = e.r;
    if (dx !== 0) { const nx = e.x + dx; if (!blockedAt(world, nx, e.y, r)) e.x = nx; }
    if (dy !== 0) { const ny = e.y + dy; if (!blockedAt(world, e.x, ny, r)) e.y = ny; }
  }

  // ---- weapon definitions -----------------------------------------------------
  const WEAPONS = {
    baton:   { name: 'BATON',   melee: true,  dmg: 30, rate: 0.42, range: 1.15, ammo: 'none',  sfx: 'melee' },
    pistol:  { name: 'PISTOL',  dmg: 24, rate: 0.30, speed: 22, spread: 0.03, pellets: 1, ammo: 'light',  knock: 0.18, sfx: 'pistol' },
    shotgun: { name: 'SHOTGUN', dmg: 12, rate: 0.72, speed: 20, spread: 0.20, pellets: 7, ammo: 'shells', knock: 0.4,  sfx: 'shotgun' },
    smg:     { name: 'SMG',     dmg: 13, rate: 0.085,speed: 24, spread: 0.10, pellets: 1, ammo: 'smg',    knock: 0.10, sfx: 'smg' }
  };

  // ---- base -------------------------------------------------------------------
  class Entity {
    constructor(x, y) {
      this.x = x; this.y = y; this.r = 0.30;
      this.facing = 0; this.frame = 0; this._animT = 0; this._stepT = 0;
      this.dead = false;
      this.dir = 'S';
      this.hitFlash = 0;
      this.kb = { x: 0, y: 0 }; // knockback velocity
    }
    depth() { return this.x + this.y; }
    animate(dt, moving, speedScale) {
      this._animT += dt * (moving ? (6 * (speedScale || 1)) : 0);
      this.frame = (Math.floor(this._animT) % 2);
      if (this.hitFlash > 0) this.hitFlash -= dt;
    }
    faceFromVel(vx, vy) {
      if (Math.abs(vx) < 0.001 && Math.abs(vy) < 0.001) return;
      const a = Math.atan2(vy, vx);
      this.dir = dirFromAngle(a);
    }
    applyKnockback(dt, world) {
      if (this.kb.x || this.kb.y) {
        moveEntity(this, this.kb.x * dt, this.kb.y * dt, world);
        this.kb.x *= 0.86; this.kb.y *= 0.86;
        if (Math.abs(this.kb.x) < 0.05) this.kb.x = 0;
        if (Math.abs(this.kb.y) < 0.05) this.kb.y = 0;
      }
    }
  }

  // Map a WORLD-space movement/aim angle to one of 4 on-screen iso facings.
  // Screen axes: screenX ∝ (x - y), screenY ∝ (x + y).
  function dirFromAngle(a) {
    const vx = Math.cos(a), vy = Math.sin(a);
    const sdx = vx - vy, sdy = vx + vy;
    if (Math.abs(sdx) >= Math.abs(sdy)) return sdx >= 0 ? 'E' : 'W';
    return sdy >= 0 ? 'S' : 'N';
  }

  // ---- Player -----------------------------------------------------------------
  class Player extends Entity {
    constructor(x, y) {
      super(x, y);
      this.r = 0.28;
      this.maxHp = 100; this.hp = 100;
      this.maxSanity = 100; this.sanity = 100;
      this.maxStamina = 100; this.stamina = 100;
      this.maxBattery = 100; this.battery = 100;
      this.flashlightOn = true;
      this.aim = 0;
      this.weapons = ['baton', 'pistol'];
      this.wi = 1;
      this.ammo = { light: 60, shells: 12, smg: 0 };
      this.cooldown = 0;
      this.speed = 4.3; this.sprintSpeed = 6.6;
      this.muzzle = 0; // muzzle flash timer
      this.invuln = 0;
    }
    weapon() { return WEAPONS[this.weapons[this.wi]]; }
    hasAmmo() { const w = this.weapon(); return w.ammo === 'none' || this.ammo[w.ammo] > 0; }

    update(dt, game) {
      const input = game.input, world = game.world;
      // aim toward mouse (world direction)
      const aimW = game.screenAimAngle();
      this.aim = aimW;
      this.dir = dirFromAngle(aimW);

      // movement (screen-relative WASD, converted to iso world axes)
      let ix = 0, iy = 0;
      if (input.down('up')) iy -= 1;
      if (input.down('down')) iy += 1;
      if (input.down('left')) ix -= 1;
      if (input.down('right')) ix += 1;
      // convert screen intent to world tile axes (iso): screen up = -y world-ish.
      // world x increases toward screen down-right, world y toward down-left.
      let wx = (ix + iy), wy = (iy - ix);
      const l = Math.hypot(wx, wy) || 1; wx /= l; wy /= l;
      const moving = (ix || iy) ? 1 : 0;

      const wantSprint = input.down('sprint') && this.stamina > 1 && moving;
      const spd = wantSprint ? this.sprintSpeed : this.speed;
      if (moving) {
        moveEntity(this, wx * spd * dt, wy * spd * dt, world);
        this._stepT -= dt;
        if (this._stepT <= 0) { this._stepT = wantSprint ? 0.28 : 0.4; game.audio.step(); }
      }
      // stamina
      if (wantSprint) this.stamina = clamp(this.stamina - 26 * dt, 0, this.maxStamina);
      else this.stamina = clamp(this.stamina + 14 * dt, 0, this.maxStamina);

      this.animate(dt, moving, wantSprint ? 1.6 : 1);
      this.applyKnockback(dt, world);

      // weapon switch
      for (let i = 0; i < this.weapons.length; i++) {
        if (input.pressed('slot' + (i + 1))) { this.wi = i; game.audio.click(); }
      }
      if (input.pressed('nextWeapon')) { this.wi = (this.wi + 1) % this.weapons.length; game.audio.click(); }

      // flashlight toggle
      if (input.pressed('flashlight')) { this.flashlightOn = !this.flashlightOn; game.audio.click(); }

      // shooting
      this.cooldown -= dt;
      this.muzzle = Math.max(0, this.muzzle - dt);
      if (input.down('fire') && this.cooldown <= 0) this.fire(game);

      // battery
      if (this.flashlightOn) this.battery = clamp(this.battery - 1.6 * dt, 0, this.maxBattery);
      if (this.battery <= 0) this.flashlightOn = false;

      // sanity dynamics
      let sanDrain = 0.35; // baseline slow drain (the place gets to you)
      const inLight = game.lightLevelAt(this.x, this.y);
      if (inLight < 0.25) sanDrain += 1.2;     // darkness
      if (!this.flashlightOn && inLight < 0.4) sanDrain += 0.6;
      // nearby teammates reassure
      let mates = 0;
      for (const t of game.teammates) if (!t.dead && !t.downed && dist(t.x, t.y, this.x, this.y) < 5) mates++;
      sanDrain -= mates * 0.25;
      // nearby entities dread
      for (const e of game.enemies) {
        if (e.dead) continue;
        const d = dist(e.x, e.y, this.x, this.y);
        if (e.type === 'wailer' && d < 5) sanDrain += (5 - d) * 0.8;
        else if (d < 4) sanDrain += (4 - d) * 0.15;
      }
      this.sanity = clamp(this.sanity - sanDrain * dt, 0, this.maxSanity);
      // low sanity slowly chips health (panic)
      if (this.sanity <= 0) this.hurt(4 * dt, game, 0, 0, true);

      if (this.invuln > 0) this.invuln -= dt;
      if (this.hp <= 0) game.onPlayerDeath();
    }

    fire(game) {
      const w = this.weapon();
      if (!this.hasAmmo()) { game.audio.click(); this.cooldown = 0.2; return; }
      this.cooldown = w.rate;
      if (w.ammo !== 'none') this.ammo[w.ammo]--;
      game.audio.shoot(w.sfx);
      this.muzzle = 0.06;
      const ang = this.aim;
      if (w.melee) {
        // arc melee hit
        for (const e of game.enemies) {
          if (e.dead) continue;
          const d = dist(e.x, e.y, this.x, this.y);
          if (d <= w.range + e.r) {
            const ea = angleTo(this.x, this.y, e.x, e.y);
            let da = Math.abs(((ea - ang + Math.PI) % (Math.PI * 2)) - Math.PI);
            if (da < 1.1) { e.damage(w.dmg, game, Math.cos(ang), Math.sin(ang), 0.5); }
          }
        }
        game.shake(3);
        return;
      }
      for (let p = 0; p < w.pellets; p++) {
        const spread = (Math.random() - 0.5) * 2 * w.spread;
        const a = ang + spread;
        game.bullets.push(new Bullet(
          this.x + Math.cos(a) * 0.4, this.y + Math.sin(a) * 0.4,
          Math.cos(a) * w.speed, Math.sin(a) * w.speed,
          w.dmg, true, w.knock
        ));
      }
      game.spawnMuzzle(this.x, this.y, ang);
      game.shake(w.sfx === 'shotgun' ? 5 : 2);
    }

    hurt(amount, game, kx, ky, ignoreInvuln) {
      if (this.invuln > 0 && !ignoreInvuln) return;
      this.hp = clamp(this.hp - amount, 0, this.maxHp);
      this.hitFlash = 0.25;
      if (!ignoreInvuln) {
        this.invuln = 0.35;
        game.audio.hurt(); game.shake(6); game.damageFlash();
        if (kx || ky) { this.kb.x = kx * 4; this.kb.y = ky * 4; }
      }
    }
    giveWeapon(id) { if (!this.weapons.includes(id)) { this.weapons.push(id); this.wi = this.weapons.length - 1; } }
    sprite(game) { return game.assets.player[this.dir][this.frame]; }
  }

  // ---- Teammate ---------------------------------------------------------------
  const MATE_NAMES = ['REEVES', 'OKONKWO', 'VASQUEZ', 'DELACROIX', 'HARPER', 'MOSS'];
  class Teammate extends Entity {
    constructor(x, y, idx) {
      super(x, y);
      this.r = 0.28;
      this.skin = idx % 3;
      this.name = MATE_NAMES[idx % MATE_NAMES.length];
      this.maxHp = 70; this.hp = 70;
      this.speed = 4.5;
      this.cooldown = 0;
      this.wdmg = 13; this.wrate = 0.38; this.wrange = 7.5; this.wspeed = 22;
      this.downed = false; this.downT = 0;
      this.muzzle = 0;
    }
    update(dt, game) {
      if (this.dead) return;
      const world = game.world, p = game.player;
      this.muzzle = Math.max(0, this.muzzle - dt);
      if (this.downed) {
        this.downT += dt;
        // player revives by proximity
        if (dist(p.x, p.y, this.x, this.y) < 1.3) {
          this._reviveT = (this._reviveT || 0) + dt;
          game.reviveProgress = clamp(this._reviveT / 2.5, 0, 1);
          if (this._reviveT >= 2.5) { this.downed = false; this.hp = this.maxHp * 0.5; this._reviveT = 0; game.audio.pickup(); game.reviveProgress = 0; }
        } else { this._reviveT = 0; }
        this.animate(dt, 0, 1);
        return;
      }
      // follow player, keep a loose formation distance
      const dToP = dist(p.x, p.y, this.x, this.y);
      let moving = 0;
      if (dToP > 2.2) {
        const [nx, ny] = game.navDir(this.x, this.y);
        if (nx || ny) {
          moveEntity(this, nx * this.speed * dt, ny * this.speed * dt, world);
          this.faceFromVel(nx, ny); moving = 1;
        } else {
          const [dx, dy] = norm(p.x - this.x, p.y - this.y);
          moveEntity(this, dx * this.speed * dt, dy * this.speed * dt, world);
          this.faceFromVel(dx, dy); moving = 1;
        }
      }
      this.applyKnockback(dt, world);
      // engage nearest enemy
      this.cooldown -= dt;
      const target = game.nearestEnemy(this.x, this.y, this.wrange, true);
      if (target) {
        const a = angleTo(this.x, this.y, target.x, target.y);
        this.dir = dirFromAngle(a);
        if (this.cooldown <= 0) {
          this.cooldown = this.wrate;
          const spread = (Math.random() - 0.5) * 0.12;
          game.bullets.push(new Bullet(this.x + Math.cos(a) * 0.4, this.y + Math.sin(a) * 0.4,
            Math.cos(a + spread) * this.wspeed, Math.sin(a + spread) * this.wspeed, this.wdmg, true, 0.12));
          game.spawnMuzzle(this.x, this.y, a);
          this.muzzle = 0.05;
          game.audio.shoot('smg');
        }
      }
      this.animate(dt, moving, 1);
    }
    damage(amount, game, kx, ky) {
      if (this.downed) { // finished off
        this.hp -= amount;
        if (this.hp < -30) { this.dead = true; game.onTeammateLost(this); }
        return;
      }
      this.hp -= amount; this.hitFlash = 0.2;
      if (this.hp <= 0) { this.downed = true; this.downT = 0; game.log(this.name + ' is down!'); game.audio.hurt(); }
    }
    sprite(game) {
      const set = game.assets.teammates[this.skin];
      if (this.downed) return set['S'][0];
      return set[this.dir][this.frame];
    }
  }

  // ---- Survivor ---------------------------------------------------------------
  const SURV_NAMES = ['a trembling clerk', 'a lost child', 'a night guard', 'a delivery driver',
    'an old woman', 'a teenager', 'a maintenance worker', 'a cartographer'];
  class Survivor extends Entity {
    constructor(x, y, idx) {
      super(x, y);
      this.r = 0.26;
      this.name = SURV_NAMES[idx % SURV_NAMES.length];
      this.rescued = false;
      this.saved = false;
      this.speed = 4.7;
      this.cowerT = Math.random() * 6;
      this.maxHp = 40; this.hp = 40;
    }
    update(dt, game) {
      if (this.dead || this.saved) return;
      const world = game.world, p = game.player;
      if (!this.rescued) { this.animate(dt, 0, 1); return; }
      // follow player closely
      const dToP = dist(p.x, p.y, this.x, this.y);
      let moving = 0;
      if (dToP > 1.6) {
        const [nx, ny] = game.navDir(this.x, this.y);
        const dx = nx || (p.x - this.x), dy = ny || (p.y - this.y);
        const [ux, uy] = norm(dx, dy);
        moveEntity(this, ux * this.speed * dt, uy * this.speed * dt, world);
        this.faceFromVel(ux, uy); moving = 1;
      }
      this.applyKnockback(dt, world);
      this.animate(dt, moving, 1);
    }
    damage(amount, game) {
      this.hp -= amount; this.hitFlash = 0.2;
      if (this.hp <= 0 && !this.dead) { this.dead = true; game.onSurvivorLost(this); }
    }
    sprite(game) { return game.assets.survivor[this.dir][this.frame]; }
  }

  // ---- Enemies ----------------------------------------------------------------
  const ENEMY_DEFS = {
    smiler: { hp: 60, r: 0.34, wander: 1.6, chase: 5.8, contact: 16, atkCd: 0.85, sanity: 8, aggro: 6.5, ranged: false, growl: 90 },
    hound:  { hp: 38, r: 0.30, wander: 1.8, chase: 5.4, contact: 7,  atkCd: 0.55, sanity: 0, aggro: 7.5, ranged: false, growl: 150 },
    lurker: { hp: 90, r: 0.40, wander: 1.2, chase: 2.4, contact: 9,  atkCd: 1.0,  sanity: 0, aggro: 8.0, ranged: true, prefRange: 5.5, spitDmg: 11, growl: 70 },
    wailer: { hp: 46, r: 0.32, wander: 1.0, chase: 1.9, contact: 0,  atkCd: 1.0,  sanity: 0, aggro: 9.0, ranged: false, aura: 5, growl: 60 }
  };
  class Enemy extends Entity {
    constructor(x, y, type) {
      super(x, y);
      const d = ENEMY_DEFS[type];
      this.type = type; this.def = d;
      this.r = d.r; this.maxHp = d.hp; this.hp = d.hp;
      this.state = 'wander';
      this.atkT = 0;
      this.wanderDir = Math.random() * Math.PI * 2;
      this.wanderT = 0;
      this.growlT = Math.random() * 6 + 3;
      this.alertT = 0;
    }
    update(dt, game) {
      if (this.dead) return;
      const world = game.world, p = game.player;
      const d = this.def;
      const dToP = dist(p.x, p.y, this.x, this.y);

      // detection: closer aggro in dark, larger if player sprinting/shooting recently
      let aggro = d.aggro;
      const lit = game.lightLevelAt(this.x, this.y);
      if (this.type === 'smiler') aggro = lit < 0.3 ? d.aggro + 3 : d.aggro - 2;
      if (game.noiseTimer > 0) aggro += 3;
      const canSee = dToP < aggro && game.hasLOS(this.x, this.y, p.x, p.y);

      if (canSee) { this.state = 'chase'; this.alertT = 2.5; }
      else if (this.alertT > 0) { this.alertT -= dt; }
      else if (dToP > aggro + 4) { this.state = 'wander'; }

      this.growlT -= dt;
      if (this.growlT <= 0) { this.growlT = 4 + Math.random() * 6; if (dToP < 12) game.audio.growl(d.growl + (Math.random() * 20 - 10)); }

      let moving = 0;
      if (this.state === 'chase' || this.alertT > 0) {
        if (d.ranged) {
          // keep preferred distance, shoot when LOS
          if (dToP > d.prefRange + 0.5) {
            const [nx, ny] = game.navDir(this.x, this.y);
            moveEntity(this, nx * d.chase * dt, ny * d.chase * dt, world); this.faceFromVel(nx, ny); moving = 1;
          } else if (dToP < d.prefRange - 1.5) {
            const [dx, dy] = norm(this.x - p.x, this.y - p.y);
            moveEntity(this, dx * d.chase * dt, dy * d.chase * dt, world); this.faceFromVel(dx, dy); moving = 1;
          }
          this.atkT -= dt;
          if (this.atkT <= 0 && dToP < d.aggro && game.hasLOS(this.x, this.y, p.x, p.y)) {
            this.atkT = d.atkCd + 0.5;
            const a = angleTo(this.x, this.y, p.x, p.y);
            game.spits.push(new Spit(this.x, this.y, Math.cos(a) * 9, Math.sin(a) * 9, d.spitDmg));
            game.audio.screech();
          }
        } else {
          // melee chaser
          const [nx, ny] = game.navDir(this.x, this.y);
          let mx = nx, my = ny;
          if (!mx && !my) { const [dx, dy] = norm(p.x - this.x, p.y - this.y); mx = dx; my = dy; }
          const spd = d.chase * (this.type === 'smiler' && dToP < 4 ? 1.15 : 1);
          moveEntity(this, mx * spd * dt, my * spd * dt, world); this.faceFromVel(mx, my); moving = 1;
        }
      } else {
        // wander
        this.wanderT -= dt;
        if (this.wanderT <= 0) { this.wanderT = 1 + Math.random() * 2; this.wanderDir += (Math.random() - 0.5) * 2; }
        const wx = Math.cos(this.wanderDir), wy = Math.sin(this.wanderDir);
        const before = { x: this.x, y: this.y };
        moveEntity(this, wx * d.wander * dt, wy * d.wander * dt, world);
        if (before.x === this.x && before.y === this.y) this.wanderDir += 1.6; // bounced off wall
        this.faceFromVel(wx, wy); moving = 1;
      }

      this.applyKnockback(dt, world);

      // contact attack / aura
      this.atkT2 = (this.atkT2 || 0) - dt;
      if (d.aura) {
        if (dToP < d.aura) { /* sanity drain handled in player update */ }
      } else if (!d.ranged || dToP < 1.0) {
        if (dToP < this.r + p.r + 0.35 && this.atkT2 <= 0) {
          this.atkT2 = d.atkCd;
          const [kx, ky] = norm(p.x - this.x, p.y - this.y);
          p.hurt(d.contact, game, kx, ky);
          if (d.sanity) p.sanity = clamp(p.sanity - d.sanity, 0, p.maxSanity);
        }
        // also attack teammates/survivors in contact
        for (const t of game.teammates) if (!t.dead && dist(t.x, t.y, this.x, this.y) < this.r + t.r + 0.3 && this.atkT2 <= 0) { this.atkT2 = d.atkCd; t.damage(d.contact, game); }
        for (const s of game.survivors) if (s.rescued && !s.dead && !s.saved && dist(s.x, s.y, this.x, this.y) < this.r + s.r + 0.3 && this.atkT2 <= 0) { this.atkT2 = d.atkCd; s.damage(d.contact, game); }
      }

      this.animate(dt, moving, 1);
    }
    damage(amount, game, kx, ky, kscale) {
      if (this.dead) return;
      this.hp -= amount; this.hitFlash = 0.18;
      this.alertT = 3; this.state = 'chase';
      game.spawnBlood(this.x, this.y, kx || 0, ky || 0);
      if (kx || ky) { const k = (kscale || 1) * 6; this.kb.x = kx * k; this.kb.y = ky * k; }
      if (this.hp <= 0) { this.dead = true; game.onEnemyKilled(this); }
    }
    sprite(game) { return game.assets.entities[this.type][this.frame]; }
  }

  // ---- Projectiles ------------------------------------------------------------
  class Bullet {
    constructor(x, y, vx, vy, dmg, fromPlayer, knock) {
      this.x = x; this.y = y; this.vx = vx; this.vy = vy; this.dmg = dmg;
      this.fromPlayer = fromPlayer; this.knock = knock || 0.15; this.life = 1.2; this.dead = false;
      this.px = x; this.py = y;
    }
    update(dt, game) {
      this.px = this.x; this.py = this.y;
      this.x += this.vx * dt; this.y += this.vy * dt;
      this.life -= dt;
      if (this.life <= 0) { this.dead = true; return; }
      if (game.world.isWall(Math.round(this.x), Math.round(this.y))) {
        this.dead = true; game.spawnSpark(this.x, this.y); return;
      }
      if (this.fromPlayer) {
        for (const e of game.enemies) {
          if (e.dead) continue;
          if (dist(e.x, e.y, this.x, this.y) < e.r + 0.15) {
            const [kx, ky] = norm(this.vx, this.vy);
            e.damage(this.dmg, game, kx, ky, this.knock * 3);
            this.dead = true; return;
          }
        }
      }
    }
    depth() { return this.x + this.y; }
  }

  class Spit {
    constructor(x, y, vx, vy, dmg) { this.x = x; this.y = y; this.vx = vx; this.vy = vy; this.dmg = dmg; this.life = 2; this.dead = false; }
    update(dt, game) {
      this.x += this.vx * dt; this.y += this.vy * dt; this.life -= dt;
      if (this.life <= 0) { this.dead = true; return; }
      if (game.world.isWall(Math.round(this.x), Math.round(this.y))) { this.dead = true; game.spawnSpark(this.x, this.y, '#8ac06a'); return; }
      const p = game.player;
      if (dist(p.x, p.y, this.x, this.y) < p.r + 0.2) {
        const [kx, ky] = norm(this.vx, this.vy); p.hurt(this.dmg, game, kx, ky); this.dead = true;
      }
    }
    depth() { return this.x + this.y; }
  }

  // ---- Items ------------------------------------------------------------------
  class Item {
    constructor(x, y, kind) { this.x = x; this.y = y; this.kind = kind; this.dead = false; this.bob = Math.random() * 6; }
    update(dt, game) {
      this.bob += dt * 3;
      const p = game.player;
      if (dist(p.x, p.y, this.x, this.y) < p.r + 0.5) this.collect(game);
    }
    collect(game) {
      const p = game.player;
      switch (this.kind) {
        case 'medkit': p.hp = clamp(p.hp + 35, 0, p.maxHp); game.log('+35 HEALTH'); break;
        case 'battery': p.battery = clamp(p.battery + 45, 0, p.maxBattery); game.log('+45 BATTERY'); break;
        case 'ammo': p.ammo.light += 24; p.ammo.smg += 30; p.ammo.shells += 4; game.log('+AMMO'); break;
        case 'pistol': p.giveWeapon('pistol'); p.ammo.light += 24; game.log('PISTOL ACQUIRED'); break;
        case 'shotgun': p.giveWeapon('shotgun'); p.ammo.shells += 12; game.log('SHOTGUN ACQUIRED'); break;
        case 'smg': p.giveWeapon('smg'); p.ammo.smg += 60; game.log('SMG ACQUIRED'); break;
        case 'sanity': p.sanity = clamp(p.sanity + 30, 0, p.maxSanity); game.log('a moment of calm  (+30 SANITY)'); break;
      }
      game.audio.pickup();
      this.dead = true;
    }
    depth() { return this.x + this.y; }
  }

  L.WEAPONS = WEAPONS;
  L.Entity = Entity;
  L.Player = Player;
  L.Teammate = Teammate;
  L.Survivor = Survivor;
  L.Enemy = Enemy;
  L.Bullet = Bullet;
  L.Spit = Spit;
  L.Item = Item;
  L.ENEMY_DEFS = ENEMY_DEFS;
  L.moveEntity = moveEntity;
  L.dirFromAngle = dirFromAngle;

})(typeof window !== 'undefined' ? window : this);
