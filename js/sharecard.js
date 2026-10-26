/* 合成大猫咪 · 小红书分享图（3:4，1080×1440）
 * 1) 战绩卡：结束后一键生成，直接发小红书
 * 2) 封面图：发笔记的首图
 */
(function () {
  const CFG = window.CATCFG;
  const Art = window.CatArt;
  const TAU = Math.PI * 2;
  const FONT = '"PingFang SC","Hiragino Sans GB","Microsoft YaHei",system-ui,sans-serif';
  const W = 1080, H = 1440;

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function backdrop(ctx) {
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, '#fff8ef');
    grad.addColorStop(0.55, '#ffeedb');
    grad.addColorStop(1, '#ffddc0');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    const blobs = [
      [-80, 260, 420, 'rgba(255,186,146,0.30)'],
      [W + 60, 760, 460, 'rgba(150,214,190,0.26)'],
      [180, H - 40, 420, 'rgba(255,168,190,0.26)'],
      [W - 60, H - 320, 300, 'rgba(255,206,140,0.24)'],
    ];
    for (const [x, y, r, col] of blobs) {
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, TAU);
      ctx.fill();
    }
    // 点阵
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    for (let i = 0; i < 60; i++) {
      const x = ((i * 197.3) % W);
      const y = ((i * 263.7) % H);
      ctx.beginPath();
      ctx.arc(x, y, 2.5, 0, TAU);
      ctx.fill();
    }
    // 内框
    ctx.save();
    roundRect(ctx, 40, 40, W - 80, H - 80, 56);
    ctx.fillStyle = 'rgba(255,255,255,0.42)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.restore();
  }

  function bigText(ctx, text, x, y, size, color, opts) {
    opts = opts || {};
    ctx.save();
    ctx.font = '900 ' + size + 'px ' + FONT;
    ctx.textAlign = opts.align || 'center';
    ctx.textBaseline = 'alphabetic';
    if (opts.stroke) {
      ctx.lineWidth = opts.strokeWidth || size * 0.14;
      ctx.lineJoin = 'round';
      ctx.strokeStyle = opts.stroke;
      ctx.strokeText(text, x, y);
    }
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
    ctx.restore();
  }

  function smallText(ctx, text, x, y, size, color, weight, align) {
    ctx.save();
    ctx.font = (weight || 600) + ' ' + size + 'px ' + FONT;
    ctx.textAlign = align || 'center';
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
    ctx.restore();
  }

  function today() {
    const d = new Date();
    const p = (n) => (n < 10 ? '0' + n : '' + n);
    return d.getFullYear() + '.' + p(d.getMonth() + 1) + '.' + p(d.getDate());
  }

  function drawCard(data) {
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const ctx = c.getContext('2d');
    backdrop(ctx);

    // 顶部标题
    smallText(ctx, 'SYNTHETIC CATS', W / 2, 138, 26, 'rgba(176,120,92,0.75)', 700);
    bigText(ctx, '合成大猫咪', W / 2, 226, 84, '#5b3b2e', { stroke: 'rgba(255,255,255,0.95)', strokeWidth: 10 });

    // 分数区
    const score = data.score || 0;
    const isRecord = !!data.isRecord;
    if (isRecord) {
      ctx.save();
      ctx.translate(W / 2 + 300, 262);
      ctx.rotate(0.16);
      roundRect(ctx, -78, -34, 156, 68, 34);
      ctx.fillStyle = '#ff5f8f';
      ctx.fill();
      ctx.restore();
      smallText(ctx, '新纪录', W / 2 + 300, 274, 30, '#fff', 900);
    }

    smallText(ctx, '我的最高分', W / 2, 330, 34, 'rgba(150,96,70,0.8)', 600);
    // 分数 + 「分」整体居中，按实际字宽排，避免压字
    ctx.save();
    ctx.font = '900 240px ' + FONT;
    const numW = ctx.measureText(String(score)).width;
    ctx.font = '900 62px ' + FONT;
    const unitW = ctx.measureText('分').width;
    const gapW = 18;
    const totalW = numW + gapW + unitW;
    const left = (W - totalW) / 2;
    ctx.restore();
    bigText(ctx, String(score), left, 560, 240, '#f4661e', { stroke: '#fff', strokeWidth: 26, align: 'left' });
    ctx.save();
    ctx.font = '900 62px ' + FONT;
    ctx.textAlign = 'left';
    ctx.fillStyle = '#f4661e';
    ctx.fillText('分', left + numW + gapW, 560);
    ctx.restore();

    // 数据条
    const stats = [
      ['进化到', CFG.catOf(data.maxLevel || 0).name],
      ['合成次数', String(data.totalMerges || 0)],
      ['最高连击', 'x' + (data.maxCombo || 0)],
    ];
    const barW = 254, gap = 26, startX = (W - barW * 3 - gap * 2) / 2;
    stats.forEach(([k, v], i) => {
      const x = startX + i * (barW + gap);
      ctx.save();
      roundRect(ctx, x, 600, barW, 132, 32);
      ctx.fillStyle = 'rgba(255,255,255,0.78)';
      ctx.fill();
      ctx.restore();
      smallText(ctx, k, x + barW / 2, 646, 26, 'rgba(150,96,70,0.78)', 600);
      smallText(ctx, v, x + barW / 2, 702, 46, '#5b3b2e', 900);
    });

    // 图鉴
    smallText(ctx, '猫咪图鉴', W / 2, 812, 32, 'rgba(150,96,70,0.85)', 700);
    const n = CFG.LEVELS.length;
    const cols = 5;
    const cellW = 168;
    const gridX = (W - cellW * cols) / 2;
    for (let i = 0; i < n; i++) {
      const row = Math.floor(i / cols);
      const col = i % cols;
      const x = gridX + col * cellW + cellW / 2;
      const y = 900 + row * 172;
      const reached = i <= (data.maxLevel || 0);
      Art.draw(ctx, {
        x: x, y: y, r: 56, level: i, t: 0,
        alpha: reached ? 1 : 0.16, blink: false,
      });
      smallText(ctx, CFG.LEVELS[i].name, x, y + 100, 24, reached ? '#7a5747' : 'rgba(122,87,71,0.35)', 700);
    }

    // 底部
    ctx.save();
    roundRect(ctx, 120, 1246, W - 240, 96, 48);
    ctx.fillStyle = 'rgba(91,59,46,0.9)';
    ctx.fill();
    ctx.restore();
    smallText(ctx, '你能合成「猫神」吗？', W / 2, 1306, 40, '#fff5e8', 800);

    smallText(ctx, '一局只要 1 分钟 · 点开就能玩 · ' + (data.date || today()), W / 2, 1376, 24, 'rgba(140,96,74,0.85)', 600);
    return c;
  }

  function drawCover() {
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const ctx = c.getContext('2d');
    backdrop(ctx);

    smallText(ctx, '一局 1 分钟的猫咪小游戏', W / 2, 200, 34, 'rgba(176,120,92,0.9)', 700);

    bigText(ctx, '合成', W / 2, 430, 150, '#f4661e', { stroke: '#fffaf2', strokeWidth: 20 });
    bigText(ctx, '大猫咪', W / 2, 600, 150, '#f4661e', { stroke: '#fffaf2', strokeWidth: 20 });

    // 三只大小猫
    Art.draw(ctx, { x: 300, y: 810, r: 86, level: 5, t: 0, angle: -0.12, blink: false });
    Art.draw(ctx, { x: 540, y: 800, r: 104, level: 7, t: 0, angle: 0.08, blink: false });
    Art.draw(ctx, { x: 750, y: 850, r: 120, level: 9, t: 0, angle: 0.14, blink: false });

    // 图鉴小串
    for (let i = 0; i < 6; i++) {
      Art.draw(ctx, { x: 190 + i * 140, y: 1050, r: 32, level: i + 1, t: 0, blink: false });
    }

    ctx.save();
    roundRect(ctx, 250, 1150, W - 500, 104, 52);
    ctx.fillStyle = '#5b3b2e';
    ctx.fill();
    ctx.restore();
    smallText(ctx, '两只一样的猫 → 变下一级', W / 2, 1216, 36, '#fff5e8', 800);

    smallText(ctx, '10 级进化 · 你能养出猫神吗', W / 2, 1320, 32, 'rgba(140,96,74,0.9)', 700);
    return c;
  }

  /* 保存：小工具容器里用 saveImageToPhotosAlbum（容器禁用 a[download] 与 blob 下载）。
   * 普通浏览器没有相册能力，返回 data URL 由界面提示「长按 / 右键保存」。 */
  function save(canvas, filename) {
    const platform = window.CatPlatform;
    if (platform && platform.canSave()) return platform.saveImage(canvas);
    const dataUrl = canvas.toDataURL('image/png');
    return Promise.resolve(dataUrl);
  }

  window.CatShare = {
    W: W,
    H: H,
    card: drawCard,
    cover: drawCover,
    save: save,
  };
})();
