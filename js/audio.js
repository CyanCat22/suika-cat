/* 合成大猫咪 · WebAudio 实时合成音效（没有任何音频文件）
 * 首次触摸/点击后解锁；静音状态记忆在 localStorage。
 */
(function () {
  const A = (window.CatAudio = {
    ctx: null,
    master: null,
    muted: false,
    ready: false,

    init: function () {
      if (this.ready) {
        if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
        return;
      }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.5;
      this.master.connect(this.ctx.destination);
      this.ready = true;
      if (this.ctx.state === 'suspended') this.ctx.resume();
    },

    setMuted: function (v) {
      this.muted = !!v;
      try { localStorage.setItem('suika-cat-muted', this.muted ? '1' : '0'); } catch (e) {}
      if (this.master) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.5, this.ctx.currentTime, 0.02);
      return this.muted;
    },

    toggleMute: function () { return this.setMuted(!this.muted); },

    /* 单个音：频率、时长、波形、音量、滑音终点、左右声道 */
    tone: function (freq, dur, type, vol, slideTo, pan) {
      if (!this.ready || this.muted) return;
      const t = this.ctx.currentTime;
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = type || 'sine';
      o.frequency.setValueAtTime(freq, t);
      if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      let node = g;
      if (pan != null && this.ctx.createStereoPanner) {
        const p = this.ctx.createStereoPanner();
        p.pan.value = Math.max(-1, Math.min(1, pan));
        g.connect(p);
        node = p;
      }
      node.connect(this.master);
      o.connect(g);
      o.start(t);
      o.stop(t + dur + 0.02);
    },

    burst: function (dur, vol, freq, q) {
      if (!this.ready || this.muted) return;
      const t = this.ctx.currentTime;
      const len = Math.floor(this.ctx.sampleRate * dur);
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      const f = this.ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = freq || 900;
      f.Q.value = q || 1.2;
      const g = this.ctx.createGain();
      g.gain.value = vol;
      src.connect(f); f.connect(g); g.connect(this.master);
      src.start(t);
    },

    /* 音高随等级升高：合成越大的猫，声音越"叮" */
    merge: function (level, pan) {
      const base = 320 * Math.pow(1.16, level);
      this.tone(base, 0.20, 'triangle', 0.20, base * 1.02, pan);
      this.tone(base * 1.5, 0.16, 'sine', 0.12, base * 1.52, pan);
      this.tone(base * 2, 0.10, 'sine', 0.05, base * 2.04, pan);
      this.burst(0.05, 0.05, 2600, 0.8);
    },

    drop: function () {
      this.tone(180, 0.10, 'sine', 0.10, 90);
      this.burst(0.08, 0.06, 700, 1.4);
    },

    thud: function () {
      this.tone(110, 0.12, 'sine', 0.12, 60);
    },

    combo: function (n) {
      const f = 520 * Math.pow(1.09, Math.min(n, 8));
      this.tone(f, 0.12, 'square', 0.06, f * 1.2);
    },

    warn: function () {
      this.tone(150, 0.14, 'sine', 0.16, 96);
      this.tone(150, 0.14, 'sine', 0.10, 96);
    },

    over: function () {
      const seq = [[392, 0], [330, 0.14], [262, 0.28], [196, 0.44]];
      for (const [f, d] of seq) {
        setTimeout(() => this.tone(f, 0.34, 'triangle', 0.16, f * 0.99), d * 1000);
      }
      setTimeout(() => this.burst(0.3, 0.05, 400, 0.7), 500);
    },

    record: function () {
      const seq = [[523, 0], [659, 0.10], [784, 0.20], [1046, 0.32]];
      for (const [f, d] of seq) {
        setTimeout(() => this.tone(f, 0.30, 'triangle', 0.14, f), d * 1000);
      }
    },

    click: function () { this.tone(660, 0.06, 'square', 0.05, 880); },
  });

  try { A.muted = localStorage.getItem('suika-cat-muted') === '1'; } catch (e) {}
})();
