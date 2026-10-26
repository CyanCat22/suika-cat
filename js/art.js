/* 合成大猫咪 · 纯代码矢量猫
 * 每一只猫都是圆身 + 耳朵 + 表情 + 花纹 + 装饰，没有任何图片资源。
 * draw(ctx, {x,y,r,level,t,angle,squashX,squashY,scale,alpha,blink,seed})
 */
(function () {
  const CFG = window.CATCFG;
  const TAU = Math.PI * 2;
  const gradCache = new WeakMap();

  function furGradient(ctx, L) {
    let m = gradCache.get(ctx);
    if (!m) { m = new Map(); gradCache.set(ctx, m); }
    let g = m.get(L.name);
    if (!g) {
      g = ctx.createRadialGradient(-L.r * 0.34, -L.r * 0.44, L.r * 0.12, 0, 0, L.r * 1.16);
      g.addColorStop(0, L.fur);
      g.addColorStop(0.62, L.fur);
      g.addColorStop(1, L.fur2);
      m.set(L.name, g);
    }
    return g;
  }

  function drawEars(ctx, r, L) {
    const lw = Math.max(2, r * 0.05);
    const outer = L.pattern === 'ragdoll' ? '#c6b3c4' : L.fur;
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(s * 0.80 * r, -0.50 * r);
      ctx.lineTo(s * 0.52 * r, -1.10 * r);
      ctx.lineTo(s * 0.10 * r, -0.84 * r);
      ctx.closePath();
      ctx.fillStyle = outer;
      ctx.fill();
      ctx.strokeStyle = L.line;
      ctx.lineWidth = lw;
      ctx.lineJoin = 'round';
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(s * 0.68 * r, -0.56 * r);
      ctx.lineTo(s * 0.50 * r, -0.94 * r);
      ctx.lineTo(s * 0.22 * r, -0.80 * r);
      ctx.closePath();
      ctx.fillStyle = L.pattern === 'ragdoll' ? '#c9a7b4' : L.ear;
      ctx.fill();
    }
  }

  function drawMane(ctx, r) {
    const n = 16;
    ctx.fillStyle = 'rgba(155,105,62,0.42)';
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      const ax = Math.cos(a) * r * 0.98;
      const ay = Math.sin(a) * r * 0.98;
      const bx = Math.cos(a + 0.16) * r * 1.20;
      const by = Math.sin(a + 0.16) * r * 1.20;
      const cx = Math.cos(a + 0.32) * r * 0.98;
      const cy = Math.sin(a + 0.32) * r * 0.98;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.lineTo(cx, cy);
      ctx.closePath();
      ctx.fill();
    }
  }

  function drawPattern(ctx, r, L, t) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ctx.clip();
    const kind = L.pattern;

    if (kind === 'tabby') {
      ctx.fillStyle = 'rgba(120,86,52,0.30)';
      for (let i = 0; i < 4; i++) {
        const y = -0.92 * r + i * 0.30 * r;
        ctx.beginPath();
        ctx.ellipse(0, y, r * 1.12, r * 0.055, 0, 0, TAU);
        ctx.fill();
      }
      // 额头三道小纹
      for (let i = -1; i <= 1; i++) {
        ctx.beginPath();
        ctx.ellipse(i * 0.20 * r, -0.58 * r, r * 0.035, r * 0.13, i * 0.12, 0, TAU);
        ctx.fill();
      }
    } else if (kind === 'cow') {
      ctx.fillStyle = 'rgba(86,76,72,0.88)';
      ctx.beginPath();
      ctx.ellipse(0.42 * r, -0.52 * r, 0.44 * r, 0.36 * r, 0.5, 0, TAU);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(-0.52 * r, 0.50 * r, 0.34 * r, 0.28 * r, -0.3, 0, TAU);
      ctx.fill();
    } else if (kind === 'calico') {
      ctx.fillStyle = 'rgba(255,150,74,0.62)';
      ctx.beginPath();
      ctx.ellipse(0.44 * r, -0.46 * r, 0.42 * r, 0.34 * r, 0.4, 0, TAU);
      ctx.fill();
      ctx.fillStyle = 'rgba(96,76,70,0.60)';
      ctx.beginPath();
      ctx.ellipse(-0.52 * r, -0.44 * r, 0.30 * r, 0.28 * r, -0.4, 0, TAU);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(0.10 * r, 0.72 * r, 0.30 * r, 0.20 * r, 0.1, 0, TAU);
      ctx.fill();
    } else if (kind === 'ragdoll') {
      ctx.fillStyle = 'rgba(150,128,152,0.50)';
      ctx.beginPath();
      ctx.ellipse(0, -0.52 * r, 0.98 * r, 0.44 * r, 0, 0, TAU);
      ctx.fill();
    } else if (kind === 'maine') {
      ctx.fillStyle = 'rgba(120,80,44,0.20)';
      ctx.beginPath();
      ctx.ellipse(0, 0.60 * r, 0.86 * r, 0.42 * r, 0, 0, TAU);
      ctx.fill();
    }

    // 底部一点点体积阴影，让球更立体
    const sh = ctx.createLinearGradient(0, r * 0.15, 0, r);
    sh.addColorStop(0, 'rgba(70,45,45,0)');
    sh.addColorStop(1, 'rgba(70,45,45,0.13)');
    ctx.fillStyle = sh;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ctx.fill();

    ctx.restore();
  }

  function drawFace(ctx, r, L, blink) {
    const lw = Math.max(2, r * 0.045);
    const eyeY = -0.02 * r;
    const eyeX = 0.33 * r;
    const eyeR = Math.max(2.5, r * 0.115);

    ctx.fillStyle = '#3b2c2e';
    if (blink) {
      ctx.strokeStyle = '#3b2c2e';
      ctx.lineWidth = lw;
      ctx.lineCap = 'round';
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(s * eyeX - eyeR * 0.8, eyeY);
        ctx.quadraticCurveTo(s * eyeX, eyeY + eyeR * 0.85, s * eyeX + eyeR * 0.8, eyeY);
        ctx.stroke();
      }
    } else {
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.ellipse(s * eyeX, eyeY, eyeR * 0.92, eyeR * 1.05, 0, 0, TAU);
        ctx.fill();
      }
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.arc(s * eyeX + eyeR * 0.30, eyeY - eyeR * 0.34, eyeR * 0.34, 0, TAU);
        ctx.fill();
      }
    }

    // 鼻子
    ctx.fillStyle = '#ef8f8f';
    ctx.beginPath();
    ctx.moveTo(-0.062 * r, 0.085 * r);
    ctx.lineTo(0.062 * r, 0.085 * r);
    ctx.lineTo(0, 0.155 * r);
    ctx.closePath();
    ctx.fill();

    // 嘴 ω
    ctx.strokeStyle = 'rgba(70,50,52,0.85)';
    ctx.lineWidth = Math.max(1.6, r * 0.035);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-0.11 * r, 0.185 * r);
    ctx.quadraticCurveTo(-0.055 * r, 0.255 * r, 0, 0.19 * r);
    ctx.quadraticCurveTo(0.055 * r, 0.255 * r, 0.11 * r, 0.185 * r);
    ctx.stroke();

    // 腮红
    ctx.fillStyle = 'rgba(255,140,140,0.42)';
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(s * 0.60 * r, 0.24 * r, 0.15 * r, 0.09 * r, s * 0.12, 0, TAU);
      ctx.fill();
    }

    // 胡须（大猫才有）
    if (r >= 58) {
      ctx.strokeStyle = 'rgba(90,70,66,0.55)';
      ctx.lineWidth = Math.max(1.2, r * 0.018);
      for (const s of [-1, 1]) {
        for (let i = 0; i < 2; i++) {
          ctx.beginPath();
          ctx.moveTo(s * 0.66 * r, 0.12 * r + i * 0.10 * r);
          ctx.quadraticCurveTo(s * 0.95 * r, 0.06 * r + i * 0.16 * r, s * 1.12 * r, 0.10 * r + i * 0.20 * r);
          ctx.stroke();
        }
      }
    }
  }

  function drawAccessory(ctx, r, L, t) {
    if (L.accessory === 'halo') {
      const y = -1.06 * r + Math.sin(t * 2) * r * 0.04;
      ctx.save();
      ctx.strokeStyle = 'rgba(255,222,132,0.95)';
      ctx.lineWidth = Math.max(2, r * 0.07);
      ctx.shadowColor = 'rgba(255,214,110,0.9)';
      ctx.shadowBlur = r * 0.35;
      ctx.beginPath();
      ctx.ellipse(0, y, r * 0.52, r * 0.16, 0, 0, TAU);
      ctx.stroke();
      ctx.restore();
    } else if (L.accessory === 'crown') {
      const y = -0.98 * r;
      const w = r * 0.62;
      ctx.save();
      ctx.fillStyle = '#ffd257';
      ctx.strokeStyle = '#a8792a';
      ctx.lineWidth = Math.max(1.6, r * 0.03);
      ctx.beginPath();
      ctx.moveTo(-w, y + r * 0.16);
      ctx.lineTo(-w, y - r * 0.06);
      ctx.lineTo(-w * 0.55, y + r * 0.04);
      ctx.lineTo(-w * 0.18, y - r * 0.20);
      ctx.lineTo(w * 0.18, y + r * 0.04);
      ctx.lineTo(w * 0.55, y - r * 0.20);
      ctx.lineTo(w, y + r * 0.04);
      ctx.lineTo(w, y + r * 0.20);
      ctx.lineTo(-w, y + r * 0.20);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#ff6f91';
      ctx.beginPath();
      ctx.arc(0, y + r * 0.10, r * 0.07, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
  }

  function draw(ctx, o) {
    const L = CFG.catOf(o.level);
    const r = o.r || L.r;
    const t = o.t || 0;
    ctx.save();
    if (o.alpha != null) ctx.globalAlpha = o.alpha;
    ctx.translate(o.x, o.y);
    if (o.angle) ctx.rotate(o.angle);
    const s = o.scale == null ? 1 : o.scale;
    const sx = (o.squashX == null ? 1 : o.squashX) * s;
    const sy = (o.squashY == null ? 1 : o.squashY) * s;
    if (sx !== 1 || sy !== 1) ctx.scale(sx, sy);

    if (L.pattern === 'maine') drawMane(ctx, r);
    drawEars(ctx, r, L);

    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ctx.fillStyle = furGradient(ctx, L);
    ctx.fill();

    drawPattern(ctx, r, L, t);

    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ctx.strokeStyle = L.line;
    ctx.globalAlpha *= 0.9;
    ctx.lineWidth = Math.max(2, r * 0.055);
    ctx.stroke();
    ctx.globalAlpha /= 0.9;

    drawFace(ctx, r, L, o.blink);
    drawAccessory(ctx, r, L, t);
    ctx.restore();
  }

  window.CatArt = { draw: draw, TAU: TAU };
})();
