/* 合成大猫咪 · 玩法核心
 * 状态机：menu -> playing -> over
 * 所有绘制都在这一个 720×1280 的逻辑坐标系里完成。
 */
(function () {
  const CFG = window.CATCFG;
  const P = window.CatPhysics;
  const Art = window.CatArt;
  const S = window.CatAudio;
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const FONT = '"PingFang SC","Hiragino Sans GB","Microsoft YaHei",system-ui,sans-serif';

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  const Game = {
    canvas: null,
    ctx: null,
    state: 'menu',
    bodies: [],
    particles: [],
    popups: [],
    score: 0,
    best: 0,
    combo: 0,
    comboT: 0,
    maxCombo: 0,
    totalMerges: 0,
    maxLevel: 0,
    curLevel: 0,
    nextLevel: 0,
    aimX: 360,
    dropCd: 0,
    time: 0,
    overWarn: 0,
    warnBeat: 0,
    shake: 0,
    flash: 0,
    acc: 0,
    dropId: 0,
    hooks: {},
    bg: null,
    blinkEnabled: true,

    init: function (canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      try {
        this.best = Number(localStorage.getItem('suika-cat-best')) || 0;
      } catch (e) { this.best = 0; }
      this.buildBackground();
      this.reset();
    },

    relayout: function () {
      this.buildBackground();
      // 世界变高后，把落在地面以下的猫重新压回地面
      for (const b of this.bodies) {
        if (b.y + b.r > CFG.FLOOR) { b.y = CFG.FLOOR - b.r; if (b.vy > 0) b.vy = 0; }
      }
    },

    buildBackground: function () {
      const W = CFG.W, H = CFG.H;
      const c = document.createElement('canvas');
      c.width = W;
      c.height = H;
      const g = c.getContext('2d');

      const grad = g.createLinearGradient(0, 0, 0, H);
      grad.addColorStop(0, '#fff8ee');
      grad.addColorStop(0.5, '#ffeeda');
      grad.addColorStop(1, '#ffdfc3');
      g.fillStyle = grad;
      g.fillRect(0, 0, W, H);

      // 大色块
      const blobs = [
        [-60, 240, 260, 'rgba(255,190,150,0.30)'],
        [W + 40, 620, 300, 'rgba(150,214,190,0.26)'],
        [120, H - 60, 280, 'rgba(255,175,195,0.26)'],
        [W - 80, H - 220, 220, 'rgba(255,206,140,0.24)'],
      ];
      for (const [x, y, r, col] of blobs) {
        g.fillStyle = col;
        g.beginPath();
        g.arc(x, y, r, 0, TAU);
        g.fill();
      }

      // 猫爪印
      const paw = (x, y, s, rot, alpha) => {
        g.save();
        g.translate(x, y);
        g.rotate(rot);
        g.fillStyle = 'rgba(214,142,110,' + alpha + ')';
        g.beginPath();
        g.ellipse(0, 0, s * 0.42, s * 0.36, 0, 0, TAU);
        g.fill();
        const toes = [[-0.36, -0.44, 0.15], [-0.12, -0.56, 0.14], [0.14, -0.55, 0.14], [0.37, -0.40, 0.13]];
        for (const [tx, ty, tr] of toes) {
          g.beginPath();
          g.arc(tx * s, ty * s, tr * s, 0, TAU);
          g.fill();
        }
        g.restore();
      };
      paw(110, 180, 64, -0.35, 0.10);
      paw(630, 400, 50, 0.5, 0.08);
      paw(80, 760, 44, 0.15, 0.07);
      paw(600, 980, 58, -0.2, 0.08);
      paw(300, H - 110, 40, 0.3, 0.06);

      // 小星星
      g.fillStyle = 'rgba(255,255,255,0.75)';
      for (let i = 0; i < 26; i++) {
        const x = (i * 137.5) % W;
        const y = (i * 211.7) % H;
        const r = 2 + ((i * 7) % 3);
        g.beginPath();
        g.arc(x, y, r, 0, TAU);
        g.fill();
      }
      this.bg = c;
    },

    reset: function () {
      this.bodies = [];
      this.particles = [];
      this.popups = [];
      this.score = 0;
      this.combo = 0;
      this.comboT = 0;
      this.maxCombo = 0;
      this.totalMerges = 0;
      this.maxLevel = 0;
      this.overWarn = 0;
      this.warnBeat = 0;
      this.shake = 0;
      this.flash = 0;
      this.acc = 0;
      this.time = 0;
      this.dropCd = 0;
      this.dropId = 0;
      this.overAnimT = 0;
      this.overAnimShown = false;
      this.curLevel = CFG.randomSpawnLevel();
      this.nextLevel = CFG.randomSpawnLevel();
      this.aimX = CFG.W / 2;
    },

    start: function () {
      this.reset();
      this.state = 'playing';
      S.init();
      S.click();
      this.hooks.onStart && this.hooks.onStart();
      return this;
    },

    /* ---------------- 输入接口 ---------------- */
    setAim: function (x) {
      this.aimX = clamp(x, 0, CFG.W);
    },

    aimRadius: function () {
      return CFG.catOf(this.curLevel).r;
    },

    drop: function () {
      if (this.state !== 'playing') return false;
      if (this.dropCd > 0) return false;
      const lv = this.curLevel;
      const r = CFG.catOf(lv).r;
      const x = clamp(this.aimX, CFG.WALL + r + 1, CFG.W - CFG.WALL - r - 1);
      const b = P.makeBody(lv, x, CFG.DROP_Y, { vy: 340, dropId: ++this.dropId });
      b.born = 99;
      this.bodies.push(b);
      this.dropCd = CFG.DROP_COOLDOWN;
      this.curLevel = this.nextLevel;
      this.nextLevel = CFG.randomSpawnLevel();
      this.aimX = x;
      S.drop();
      for (let i = 0; i < 4; i++) {
        this.particles.push({
          x: x + (Math.random() - 0.5) * r, y: CFG.DROP_Y,
          vx: (Math.random() - 0.5) * 120, vy: -40 - Math.random() * 60,
          life: 0.35, max: 0.35, r: 2 + Math.random() * 3,
          color: 'rgba(255,255,255,0.9)', kind: 'dot',
        });
      }
      return true;
    },

    /* ---------------- 更新 ---------------- */
    update: function (dt) {
      dt = Math.min(dt, 0.05);
      this.time += dt;
      this.dropCd = Math.max(0, this.dropCd - dt);
      this.shake *= Math.pow(0.001, dt);
      if (this.shake < 0.3) this.shake = 0;
      this.flash = Math.max(0, this.flash - dt * 3.2);

      if (this.comboT > 0) {
        this.comboT -= dt;
        if (this.comboT <= 0) this.combo = 0;
      }

      if (this.state === 'over' && !this.overAnimShown) {
        this.overAnimT = (this.overAnimT || 0) + dt;
        if (this.overAnimT >= 0.6) {
          this.overAnimShown = true;
          this.hooks.onOverUI && this.hooks.onOverUI(this.lastOverData);
        }
      }

      if (this.state === 'playing') {
        this.acc += dt;
        let steps = 0;
        while (this.acc >= CFG.SUBSTEP && steps < CFG.MAX_SUBSTEPS) {
          P.step(this.bodies, CFG.SUBSTEP);
          this.acc -= CFG.SUBSTEP;
          steps++;
        }
        if (steps >= CFG.MAX_SUBSTEPS) this.acc = 0;
        this.tryMerge();
        this.checkOverflow(dt);
      }

      // 粒子
      for (let i = this.particles.length - 1; i >= 0; i--) {
        const p = this.particles[i];
        p.life -= dt;
        if (p.life <= 0) { this.particles.splice(i, 1); continue; }
        p.vy += (p.kind === 'heart' ? -60 : 900) * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vx *= 0.99;
        if (p.kind === 'spark' || p.kind === 'heart') p.rot = (p.rot || 0) + dt * 3;
      }
      // 飘字
      for (let i = this.popups.length - 1; i >= 0; i--) {
        const p = this.popups[i];
        p.life -= dt;
        if (p.life <= 0) this.popups.splice(i, 1);
      }
    },

    tryMerge: function () {
      const bs = this.bodies;
      const used = {};
      const pairs = [];
      for (let i = 0; i < bs.length; i++) {
        const a = bs[i];
        if (used[a.id] || !a.alive) continue;
        for (let j = i + 1; j < bs.length; j++) {
          const b = bs[j];
          if (used[b.id] || !b.alive || b.level !== a.level) continue;
          if (a.level >= CFG.MAX_LEVEL) continue;
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const rr = a.r + b.r + CFG.MERGE_GAP;
          if (dx * dx + dy * dy <= rr * rr) {
            pairs.push([a, b]);
            used[a.id] = used[b.id] = true;
            break;
          }
        }
      }
      for (const [a, b] of pairs) this.doMerge(a, b);
    },

    doMerge: function (a, b) {
      a.alive = false;
      b.alive = false;
      this.bodies = this.bodies.filter((x) => x.alive);

      const level = a.level + 1;
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;

      this.combo = this.comboT > 0 ? this.combo + 1 : 1;
      this.comboT = CFG.COMBO_WINDOW;
      this.maxCombo = Math.max(this.maxCombo, this.combo);
      this.totalMerges++;

      const mult = 1 + 0.25 * (this.combo - 1);
      const gain = Math.round(CFG.SCORE[a.level] * mult);
      this.score += gain;

      const nb = P.makeBody(level, mx, my, {
        vy: -170 - level * 6,
        angle: (a.angle + b.angle) / 2,
        angVel: (Math.random() - 0.5) * 2.4,
      });
      nb.born = 0;
      this.bodies.push(nb);

      this.maxLevel = Math.max(this.maxLevel, level);
      const cat = CFG.catOf(level);
      this.burst(mx, my, level, cat);

      this.addPopup('+' + gain, mx, my - cat.r * 0.55, {
        size: 30 + Math.min(22, level * 2.4),
        color: '#ff6f3c',
        rise: 52,
        life: 0.85,
      });

      if (this.combo >= 2) {
        this.addPopup('连击 x' + this.combo, mx, my - cat.r * 0.55 - 44, {
          size: 30 + Math.min(18, this.combo * 4),
          color: level >= 5 ? '#ff3d7f' : '#ff8a3d',
          rise: 62, life: 1.0,
        });
        S.combo(this.combo);
      } else {
        S.merge(level, clamp((mx / CFG.W) * 2 - 1, -1, 1));
      }

      if (level >= 8) {
        this.shake = Math.max(this.shake, 6 + level);
        this.flash = Math.max(this.flash, 0.22);
      } else if (level >= 5) {
        this.shake = Math.max(this.shake, 3);
      }

      if (level === CFG.MAX_LEVEL) {
        this.addPopup('猫神降临！', CFG.W / 2, CFG.DANGER_Y + 160, {
          size: 62, color: '#ff3d7f', rise: 40, life: 2.4, big: true,
        });
        this.flash = 0.5;
      } else if (level === 8 || level === 9) {
        this.addPopup(cat.name + ' 进化成功', mx, my - cat.r - 18, {
          size: 30, color: '#b05cff', rise: 60, life: 1.3,
        });
      }
    },

    burst: function (x, y, level, cat) {
      const n = 10 + level * 3;
      for (let i = 0; i < n; i++) {
        const a = Math.random() * TAU;
        const sp = 100 + Math.random() * 260 + level * 14;
        const kind = Math.random() < 0.25 ? 'heart' : 'spark';
        this.particles.push({
          x: x, y: y,
          vx: Math.cos(a) * sp,
          vy: Math.sin(a) * sp - 120,
          life: 0.45 + Math.random() * 0.45,
          max: 0.9,
          r: 2.5 + Math.random() * (3 + level * 0.6),
          color: kind === 'heart' ? 'rgba(255,110,150,0.95)' : 'rgba(255,190,120,0.9)',
          kind: kind,
          rot: Math.random() * TAU,
        });
      }
      // 扩散光圈
      this.particles.push({
        x: x, y: y, vx: 0, vy: 0, life: 0.36, max: 0.36,
        r: cat.r * 0.8, color: 'rgba(255,255,255,0.85)', kind: 'ring',
      });
      // 星星
      for (let i = 0; i < 4 + level; i++) {
        const a = Math.random() * TAU;
        this.particles.push({
          x: x + Math.cos(a) * cat.r * 0.6,
          y: y + Math.sin(a) * cat.r * 0.6,
          vx: Math.cos(a) * 80, vy: -60 - Math.random() * 90,
          life: 0.6, max: 0.6, r: 3 + Math.random() * 4,
          color: 'rgba(255,255,255,0.95)', kind: 'star', rot: Math.random() * TAU,
        });
      }
    },

    addPopup: function (text, x, y, o) {
      o = o || {};
      this.popups.push({
        text: text, x: x, y: y,
        life: o.life || 0.9, max: o.life || 0.9,
        size: o.size || 28, color: o.color || '#ff6f3c',
        rise: o.rise || 46, big: !!o.big,
      });
    },

    checkOverflow: function (dt) {
      let worst = 0;
      for (let i = 0; i < this.bodies.length; i++) {
        const b = this.bodies[i];
        const above = b.y - b.r < CFG.DANGER_Y;
        const slow = Math.abs(b.vy) < 320 && b.age > 0.25;
        if (above && slow) {
          b.overT += dt;
        } else {
          b.overT = Math.max(0, b.overT - dt * CFG.OVER_DECAY);
        }
        if (b.overT > worst) worst = b.overT;
      }
      this.overWarn = worst;
      if (worst > 0.2) {
        this.warnBeat -= dt;
        if (this.warnBeat <= 0) {
          S.warn();
          this.warnBeat = 0.52;
        }
      } else {
        this.warnBeat = 0;
      }
      if (worst > CFG.OVER_GRACE) this.gameOver();
    },

    gameOver: function () {
      if (this.state === 'over') return;
      this.state = 'over';
      this.overAnimT = 0;
      this.overAnimShown = false;
      const isRecord = this.score > this.best;
      this.best = Math.max(this.best, this.score);
      try { localStorage.setItem('suika-cat-best', String(this.best)); } catch (e) {}
      this.shake = 14;
      this.flash = 0.4;
      S.over();
      if (isRecord) setTimeout(() => S.record(), 700);
      this.lastOverData = {
        score: this.score,
        best: this.best,
        isRecord: isRecord,
        maxLevel: this.maxLevel,
        maxCombo: this.maxCombo,
        totalMerges: this.totalMerges,
      };
      this.hooks.onOver && this.hooks.onOver(this.lastOverData);
    },

    /* ---------------- 绘制 ---------------- */
    render: function () {
      const ctx = this.ctx;
      const W = CFG.W, H = CFG.H;
      ctx.save();
      if (this.shake > 0.5) {
        ctx.translate((Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake);
      }
      ctx.drawImage(this.bg, 0, 0);
      this.drawContainer(ctx);
      this.drawDangerLine(ctx);

      const sorted = this.bodies.slice().sort((a, b) => a.y - b.y);
      for (const b of sorted) this.drawBody(ctx, b);

      this.drawAimCat(ctx);
      this.drawParticles(ctx);
      this.drawPopups(ctx);
      if (this.flash > 0) {
        ctx.fillStyle = 'rgba(255,240,220,' + (this.flash * 0.7) + ')';
        ctx.fillRect(-20, -20, W + 40, H + 40);
      }
      ctx.restore();
      this.drawHUD(ctx);
    },

    drawContainer: function (ctx) {
      const L = CFG.WALL, R = CFG.W - CFG.WALL;
      const top = CFG.TOP, bottom = CFG.FLOOR;
      // 内胆
      ctx.save();
      roundRect(ctx, L - 8, top, R - L + 16, bottom - top + 18, 34);
      ctx.fillStyle = 'rgba(255,255,255,0.62)';
      ctx.fill();
      // 内胆顶部渐隐
      const fade = ctx.createLinearGradient(0, top, 0, top + 90);
      fade.addColorStop(0, 'rgba(255,241,226,0.92)');
      fade.addColorStop(1, 'rgba(255,241,226,0)');
      ctx.fillStyle = fade;
      ctx.fill();
      ctx.strokeStyle = 'rgba(240,164,120,0.85)';
      ctx.lineWidth = 10;
      ctx.stroke();
      // 罐底
      ctx.beginPath();
      roundRect(ctx, L - 16, bottom, R - L + 32, 16, 8);
      ctx.fillStyle = '#f5a97c';
      ctx.fill();
      ctx.restore();
    },

    drawDangerLine: function (ctx) {
      const y = CFG.DANGER_Y;
      const warm = clamp(this.overWarn / CFG.OVER_GRACE, 0, 1);
      const pulse = 0.5 + 0.5 * Math.sin(this.time * 6);
      const alpha = 0.30 + warm * 0.55 * pulse;
      ctx.save();
      ctx.setLineDash([16, 12]);
      ctx.lineDashOffset = -this.time * 30;
      ctx.strokeStyle = warm > 0.05
        ? 'rgba(255,80,80,' + alpha + ')'
        : 'rgba(240,150,120,0.45)';
      ctx.lineWidth = warm > 0.05 ? 5 : 3;
      ctx.beginPath();
      ctx.moveTo(CFG.WALL + 12, y);
      ctx.lineTo(CFG.W - CFG.WALL - 12, y);
      ctx.stroke();
      ctx.restore();

      if (warm > 0.05) {
        ctx.save();
        ctx.globalAlpha = warm * 0.9;
        ctx.fillStyle = '#e33';
        ctx.font = 'bold 22px ' + FONT;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'bottom';
        ctx.fillText('危险！' + (1 - warm).toFixed(1) + 's', CFG.W - CFG.WALL - 24, y - 10);
        ctx.restore();
      }
    },

    drawBody: function (ctx, b) {
      let scale = 1;
      if (b.born < 0.2) scale = 1 + 0.34 * (1 - b.born / 0.2);
      const blink = this.blinkEnabled && ((this.time * 0.85 + b.id * 1.73) % 4.6) < 0.11;
      const angle = clamp(b.angle, -0.42, 0.42);
      Art.draw(ctx, {
        x: b.x, y: b.y, r: b.r, level: b.level,
        t: this.time + b.id, angle: angle, scale: scale, blink: blink,
      });
    },

    drawAimCat: function (ctx) {
      if (this.state !== 'playing') return;
      const r = this.aimRadius();
      const x = clamp(this.aimX, CFG.WALL + r + 1, CFG.W - CFG.WALL - r - 1);
      const y = CFG.DROP_Y + Math.sin(this.time * 3.4) * 5;
      const ready = this.dropCd <= 0;

      ctx.save();
      // 落点指示
      ctx.globalAlpha = ready ? 0.22 : 0.08;
      ctx.strokeStyle = '#ff8a5c';
      ctx.lineWidth = 3;
      ctx.setLineDash([8, 10]);
      ctx.beginPath();
      ctx.moveTo(x, y + r + 8);
      ctx.lineTo(x, CFG.FLOOR - 4);
      ctx.stroke();
      ctx.beginPath();
      ctx.setLineDash([]);
      ctx.ellipse(x, CFG.FLOOR - 2, r * 0.95, r * 0.26, 0, 0, TAU);
      ctx.fillStyle = 'rgba(255,138,92,0.18)';
      ctx.fill();
      ctx.restore();

      Art.draw(ctx, {
        x: x, y: y, r: r, level: this.curLevel, t: this.time,
        alpha: ready ? 1 : 0.55, blink: false,
      });
    },

    drawParticles: function (ctx) {
      for (const p of this.particles) {
        const k = p.life / p.max;
        ctx.save();
        ctx.globalAlpha = Math.max(0, Math.min(1, k));
        if (p.kind === 'ring') {
          const t = 1 - k;
          ctx.strokeStyle = p.color;
          ctx.lineWidth = 5 * (1 - t) + 1;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.r + t * 90, 0, TAU);
          ctx.stroke();
        } else if (p.kind === 'heart') {
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot || 0);
          const s = p.r;
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.moveTo(0, s * 0.5);
          ctx.bezierCurveTo(-s, -s * 0.2, -s * 0.5, -s, 0, -s * 0.4);
          ctx.bezierCurveTo(s * 0.5, -s, s, -s * 0.2, 0, s * 0.5);
          ctx.fill();
        } else if (p.kind === 'star') {
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot || 0);
          ctx.fillStyle = p.color;
          ctx.beginPath();
          for (let i = 0; i < 5; i++) {
            const a = (i / 5) * TAU - Math.PI / 2;
            const a2 = a + TAU / 10;
            ctx.lineTo(Math.cos(a) * p.r, Math.sin(a) * p.r);
            ctx.lineTo(Math.cos(a2) * p.r * 0.45, Math.sin(a2) * p.r * 0.45);
          }
          ctx.closePath();
          ctx.fill();
        } else {
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.r, 0, TAU);
          ctx.fill();
        }
        ctx.restore();
      }
    },

    drawPopups: function (ctx) {
      for (const p of this.popups) {
        const k = 1 - p.life / p.max;
        const alpha = k < 0.75 ? 1 : 1 - (k - 0.75) / 0.25;
        ctx.save();
        ctx.globalAlpha = Math.max(0, alpha);
        ctx.font = '900 ' + p.size + 'px ' + FONT;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineWidth = p.size * 0.16;
        ctx.strokeStyle = 'rgba(255,255,255,0.92)';
        ctx.lineJoin = 'round';
        const y = p.y - k * p.rise;
        const s = p.big ? 1 + Math.sin(Math.min(1, k * 3) * Math.PI) * 0.12 : 1;
        ctx.save();
        ctx.translate(p.x, y);
        ctx.scale(s, s);
        ctx.strokeText(p.text, 0, 0);
        ctx.fillStyle = p.color;
        ctx.fillText(p.text, 0, 0);
        ctx.restore();
        ctx.restore();
      }
    },

    drawHUD: function (ctx) {
      const W = CFG.W;
      ctx.save();
      ctx.textBaseline = 'alphabetic';

      // 分数
      ctx.textAlign = 'left';
      ctx.fillStyle = 'rgba(150,96,70,0.75)';
      ctx.font = '600 22px ' + FONT;
      ctx.fillText('分数', 50, 44);
      ctx.fillStyle = '#5b3b2e';
      ctx.font = '900 62px ' + FONT;
      ctx.fillText(String(this.score), 48, 104);

      ctx.fillStyle = 'rgba(150,96,70,0.7)';
      ctx.font = '600 20px ' + FONT;
      ctx.fillText('最高 ' + this.best, 50, 136);

      // NEXT 卡片
      const cardW = 116, cardH = 104, cx = W - 50 - cardW, cy = 22;
      ctx.save();
      roundRect(ctx, cx, cy, cardW, cardH, 22);
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(240,164,120,0.6)';
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.fillStyle = 'rgba(150,96,70,0.8)';
      ctx.font = '600 18px ' + FONT;
      ctx.textAlign = 'center';
      ctx.fillText('下一个', cx + cardW / 2, cy + 24);
      ctx.restore();

      Art.draw(ctx, {
        x: cx + cardW / 2, y: cy + cardH / 2 + 8, r: 26,
        level: this.nextLevel, t: this.time, blink: false,
      });
      ctx.restore();
    },
  };

  window.CatGame = Game;
})();
