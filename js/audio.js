/* =============================================================================
   LIMINAL.CO — audio.js
   Fully synthesized audio (WebAudio). No external files.
   - Ambient bed: fluorescent hum + high whine + air rumble, with slow flicker.
   - SFX: gunshots, footsteps, pickups, damage, entity growls, heartbeat, UI.
   Everything is procedural so the build stays self-contained.
   ============================================================================= */
(function (global) {
  'use strict';
  const L = global.L || (global.L = {});
  const { clamp, lerp } = L;

  class AudioEngine {
    constructor() {
      this.ctx = null;
      this.enabled = true;
      this.started = false;
      this.master = null;
      this.ambientGain = null;
      this.sfxGain = null;
      this._noiseBuf = null;
      this._humNodes = [];
      this._dread = 0;     // 0..1 tension level (drives ambience)
      this._targetDread = 0;
    }

    // Must be called from a user gesture.
    start() {
      if (this.started) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
      const AC = global.AudioContext || global.webkitAudioContext;
      if (!AC) { this.enabled = false; return; }
      this.ctx = new AC();
      const ctx = this.ctx;

      this.master = ctx.createGain();
      this.master.gain.value = 0.9;
      this.master.connect(ctx.destination);

      this.ambientGain = ctx.createGain();
      this.ambientGain.gain.value = 0.0;
      this.ambientGain.connect(this.master);

      this.sfxGain = ctx.createGain();
      this.sfxGain.gain.value = 0.9;
      this.sfxGain.connect(this.master);

      this._noiseBuf = this._makeNoise(2.0);
      this._buildAmbient();
      // fade ambient in
      this.ambientGain.gain.linearRampToValueAtTime(0.5, ctx.currentTime + 3.0);
      this.started = true;
    }

    setMuted(m) {
      this.enabled = !m;
      if (this.master) this.master.gain.value = m ? 0 : 0.9;
    }

    _makeNoise(seconds) {
      const ctx = this.ctx;
      const len = Math.floor(ctx.sampleRate * seconds);
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      return buf;
    }

    _noiseSource(loop) {
      const src = this.ctx.createBufferSource();
      src.buffer = this._noiseBuf;
      src.loop = !!loop;
      return src;
    }

    _buildAmbient() {
      const ctx = this.ctx, out = this.ambientGain;

      // Deep air rumble
      const rumble = ctx.createOscillator();
      rumble.type = 'sine'; rumble.frequency.value = 42;
      const rg = ctx.createGain(); rg.gain.value = 0.12;
      rumble.connect(rg).connect(out); rumble.start();

      // Fluorescent 60Hz hum + harmonic
      const hum = ctx.createOscillator();
      hum.type = 'sawtooth'; hum.frequency.value = 60;
      const hlp = ctx.createBiquadFilter(); hlp.type = 'lowpass'; hlp.frequency.value = 320;
      const hg = ctx.createGain(); hg.gain.value = 0.05;
      hum.connect(hlp).connect(hg).connect(out); hum.start();

      const hum2 = ctx.createOscillator();
      hum2.type = 'sawtooth'; hum2.frequency.value = 120;
      const hg2 = ctx.createGain(); hg2.gain.value = 0.02;
      hum2.connect(hg2).connect(out); hum2.start();

      // High fluorescent whine (very quiet, flickers)
      const whine = ctx.createOscillator();
      whine.type = 'triangle'; whine.frequency.value = 8200;
      this._whineGain = ctx.createGain(); this._whineGain.gain.value = 0.006;
      whine.connect(this._whineGain).connect(out); whine.start();

      // Filtered noise "air"
      const air = this._noiseSource(true);
      const alp = ctx.createBiquadFilter(); alp.type = 'lowpass'; alp.frequency.value = 600;
      const ag = ctx.createGain(); ag.gain.value = 0.05;
      air.connect(alp).connect(ag).connect(out); air.start();

      // Dread drone (rises with tension) — detuned, dissonant
      this._dreadGain = ctx.createGain(); this._dreadGain.gain.value = 0.0;
      const d1 = ctx.createOscillator(); d1.type = 'sawtooth'; d1.frequency.value = 73;
      const d2 = ctx.createOscillator(); d2.type = 'sawtooth'; d2.frequency.value = 77.5; // beating
      const dlp = ctx.createBiquadFilter(); dlp.type = 'lowpass'; dlp.frequency.value = 400;
      d1.connect(dlp); d2.connect(dlp); dlp.connect(this._dreadGain).connect(out);
      d1.start(); d2.start();
      this._dreadFilter = dlp;

      this._humNodes = [rumble, hum, hum2, whine, air, d1, d2];
      this._whineFlickerT = 0;
    }

    // dread: 0..1 external tension level.
    setDread(v) { this._targetDread = clamp(v, 0, 1); }

    update(dt) {
      if (!this.started || !this.enabled) return;
      this._dread = lerp(this._dread, this._targetDread, clamp(dt * 0.8, 0, 1));
      if (this._dreadGain) {
        this._dreadGain.gain.value = this._dread * 0.14;
        this._dreadFilter.frequency.value = 260 + this._dread * 900;
      }
      // whine flicker
      this._whineFlickerT -= dt;
      if (this._whineFlickerT <= 0 && this._whineGain) {
        this._whineFlickerT = 0.05 + Math.random() * 0.3;
        const g = Math.random() < 0.2 ? 0.001 : 0.006;
        this._whineGain.gain.setTargetAtTime(g, this.ctx.currentTime, 0.05);
      }
    }

    _env(gain, when, a, d, peak, sus) {
      gain.gain.cancelScheduledValues(when);
      gain.gain.setValueAtTime(0.0001, when);
      gain.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), when + a);
      gain.gain.exponentialRampToValueAtTime(Math.max(sus || 0.0001, 0.0001), when + a + d);
    }

    // ---- SFX ------------------------------------------------------------------
    shoot(kind) {
      if (!this.started || !this.enabled) return;
      const ctx = this.ctx, t = ctx.currentTime;
      const g = ctx.createGain(); g.connect(this.sfxGain);
      const src = this._noiseSource(false);
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
      let peak = 0.5, dur = 0.12, cut = 1800;
      if (kind === 'shotgun') { peak = 0.7; dur = 0.22; cut = 1200; }
      else if (kind === 'smg') { peak = 0.32; dur = 0.07; cut = 2400; }
      else if (kind === 'melee') { peak = 0.4; dur = 0.14; cut = 900; }
      lp.frequency.setValueAtTime(cut, t);
      lp.frequency.exponentialRampToValueAtTime(200, t + dur);
      src.connect(lp).connect(g);
      this._env(g, t, 0.002, dur, peak, 0.0001);
      // low thump body
      const o = ctx.createOscillator(); o.type = 'square'; o.frequency.setValueAtTime(140, t);
      o.frequency.exponentialRampToValueAtTime(50, t + dur);
      const og = ctx.createGain(); this._env(og, t, 0.002, dur * 0.8, peak * 0.6, 0.0001);
      o.connect(og).connect(this.sfxGain);
      src.start(t); src.stop(t + dur + 0.02);
      o.start(t); o.stop(t + dur + 0.02);
    }

    click() {
      if (!this.started || !this.enabled) return;
      const ctx = this.ctx, t = ctx.currentTime;
      const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = 900;
      const g = ctx.createGain(); this._env(g, t, 0.001, 0.04, 0.12, 0.0001);
      o.connect(g).connect(this.sfxGain); o.start(t); o.stop(t + 0.06);
    }

    step() {
      if (!this.started || !this.enabled) return;
      const ctx = this.ctx, t = ctx.currentTime;
      const src = this._noiseSource(false);
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 500;
      const g = ctx.createGain(); this._env(g, t, 0.002, 0.09, 0.09, 0.0001);
      src.connect(lp).connect(g).connect(this.sfxGain);
      src.start(t); src.stop(t + 0.12);
    }

    pickup() {
      if (!this.started || !this.enabled) return;
      const ctx = this.ctx, t = ctx.currentTime;
      [660, 990].forEach((f, i) => {
        const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = f;
        const g = ctx.createGain(); this._env(g, t + i * 0.06, 0.002, 0.12, 0.15, 0.0001);
        o.connect(g).connect(this.sfxGain); o.start(t + i * 0.06); o.stop(t + i * 0.06 + 0.16);
      });
    }

    hurt() {
      if (!this.started || !this.enabled) return;
      const ctx = this.ctx, t = ctx.currentTime;
      const o = ctx.createOscillator(); o.type = 'sawtooth';
      o.frequency.setValueAtTime(220, t); o.frequency.exponentialRampToValueAtTime(70, t + 0.25);
      const g = ctx.createGain(); this._env(g, t, 0.002, 0.25, 0.3, 0.0001);
      const dist = ctx.createWaveShaper(); dist.curve = this._distCurve(20);
      o.connect(dist).connect(g).connect(this.sfxGain); o.start(t); o.stop(t + 0.3);
    }

    growl(pitch) {
      if (!this.started || !this.enabled) return;
      const ctx = this.ctx, t = ctx.currentTime;
      const o = ctx.createOscillator(); o.type = 'sawtooth';
      const base = pitch || 90;
      o.frequency.setValueAtTime(base, t);
      o.frequency.linearRampToValueAtTime(base * 0.6, t + 0.5);
      const lfo = ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 18;
      const lfg = ctx.createGain(); lfg.gain.value = 14;
      lfo.connect(lfg).connect(o.frequency);
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 500;
      const g = ctx.createGain(); this._env(g, t, 0.05, 0.55, 0.22, 0.0001);
      o.connect(lp).connect(g).connect(this.sfxGain);
      o.start(t); o.stop(t + 0.6); lfo.start(t); lfo.stop(t + 0.6);
    }

    screech() {
      if (!this.started || !this.enabled) return;
      const ctx = this.ctx, t = ctx.currentTime;
      const o = ctx.createOscillator(); o.type = 'sawtooth';
      o.frequency.setValueAtTime(1200, t); o.frequency.exponentialRampToValueAtTime(3200, t + 0.3);
      const g = ctx.createGain(); this._env(g, t, 0.01, 0.4, 0.18, 0.0001);
      const lp = ctx.createBiquadFilter(); lp.type = 'bandpass'; lp.frequency.value = 2200; lp.Q.value = 3;
      o.connect(lp).connect(g).connect(this.sfxGain); o.start(t); o.stop(t + 0.42);
    }

    heartbeat(intensity) {
      if (!this.started || !this.enabled) return;
      const ctx = this.ctx, t = ctx.currentTime;
      const beat = (dt) => {
        const o = ctx.createOscillator(); o.type = 'sine';
        o.frequency.setValueAtTime(70, t + dt); o.frequency.exponentialRampToValueAtTime(40, t + dt + 0.14);
        const g = ctx.createGain(); this._env(g, t + dt, 0.01, 0.16, 0.28 * (intensity || 1), 0.0001);
        o.connect(g).connect(this.sfxGain); o.start(t + dt); o.stop(t + dt + 0.2);
      };
      beat(0); beat(0.16);
    }

    rescue() {
      if (!this.started || !this.enabled) return;
      const ctx = this.ctx, t = ctx.currentTime;
      [523, 659, 784, 1046].forEach((f, i) => {
        const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = f;
        const g = ctx.createGain(); this._env(g, t + i * 0.08, 0.01, 0.3, 0.13, 0.0001);
        o.connect(g).connect(this.sfxGain); o.start(t + i * 0.08); o.stop(t + i * 0.08 + 0.34);
      });
    }

    portal() {
      if (!this.started || !this.enabled) return;
      const ctx = this.ctx, t = ctx.currentTime;
      const o = ctx.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(200, t); o.frequency.exponentialRampToValueAtTime(900, t + 0.8);
      const g = ctx.createGain(); this._env(g, t, 0.05, 0.9, 0.2, 0.0001);
      const dl = ctx.createDelay(); dl.delayTime.value = 0.18; const fb = ctx.createGain(); fb.gain.value = 0.4;
      o.connect(g).connect(this.sfxGain); g.connect(dl); dl.connect(fb); fb.connect(dl); dl.connect(this.sfxGain);
      o.start(t); o.stop(t + 0.95);
    }

    _distCurve(amount) {
      const n = 256, curve = new Float32Array(n), deg = Math.PI / 180;
      for (let i = 0; i < n; i++) { const x = (i * 2) / n - 1; curve[i] = ((3 + amount) * x * 20 * deg) / (Math.PI + amount * Math.abs(x)); }
      return curve;
    }
  }

  L.AudioEngine = AudioEngine;
})(typeof window !== 'undefined' ? window : this);
