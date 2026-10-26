/* 合成大猫咪 · 入口：缩放、输入、界面切换、分享图
 * 逻辑坐标固定 720×1280，画布按视口等比缩放（竖屏）。
 */
(function () {
  const CFG = window.CATCFG;
  const G = window.CatGame;
  const Sound = window.CatAudio;
  const Share = window.CatShare;
  const platform = window.CatPlatform || null;
  const $ = (id) => document.getElementById(id);

  const canvas = $('game');
  const uls = {
    menu: $('menu'), over: $('over'), pause: $('pause'), share: $('share'), hint: $('hint'),
  };
  let paused = false;
  let dragging = false;
  let last = 0;
  let shareData = null;
  let cardCanvas = null;
  let hintTimer = 0;

  G.init(canvas);
  G.hooks.onOver = (data) => { shareData = data; };
  G.hooks.onOverUI = onGameOver;
  G.hooks.onStart = onGameStart;

  /* ---------- 画布缩放 ---------- */
  function resize() {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    // 比 9:16 更瘦长的手机屏：按宽度铺满，把世界纵向拉长（罐子更高）
    const worldH = vh / vw > CFG.H_BASE / CFG.W ? Math.round((CFG.W * vh) / vw) : CFG.H_BASE;
    CFG.relayout(worldH);
    const k = Math.min(vw / CFG.W, vh / CFG.H);
    const cssW = Math.max(220, Math.round(CFG.W * k));
    const cssH = Math.max(390, Math.round(CFG.H * k));
    canvas.style.width = cssW + 'px';
    canvas.style.height = cssH + 'px';
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(canvas.width / CFG.W, 0, 0, canvas.height / CFG.H, 0, 0);
    const app = document.getElementById('app');
    if (app) app.classList.toggle('full', Math.abs(cssH - vh) < 2 && Math.abs(cssW - vw) < 2);
    G.relayout();
    drawMenuChain();
  }

  function toLogical(clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    return {
      x: ((clientX - r.left) / r.width) * CFG.W,
      y: ((clientY - r.top) / r.height) * CFG.H,
    };
  }

  /* ---------- 输入 ---------- */
  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    Sound.init();
    if (G.state !== 'playing' || paused) return;
    dragging = true;
    try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
    G.setAim(toLogical(e.clientX, e.clientY).x);
    hideHint();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    e.preventDefault();
    G.setAim(toLogical(e.clientX, e.clientY).x);
  });
  const endDrag = (e) => {
    if (!dragging) return;
    dragging = false;
    if (G.state === 'playing' && !paused) G.drop();
  };
  window.addEventListener('pointerup', endDrag);
  window.addEventListener('pointercancel', () => { dragging = false; });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') { G.setAim(G.aimX - 28); e.preventDefault(); }
    else if (e.key === 'ArrowRight') { G.setAim(G.aimX + 28); e.preventDefault(); }
    else if (e.code === 'Space' || e.key === 'ArrowDown') { Sound.init(); if (!paused) G.drop(); e.preventDefault(); }
    else if (e.key === 'p' || e.key === 'P' || e.key === 'Escape') { togglePause(); }
    else if (e.key === 'm' || e.key === 'M') { toggleMute(); }
  });

  /* ---------- 界面 ---------- */
  function show(el, on) { el.classList.toggle('show', !!on); }

  function showOnly(name) {
    for (const k of Object.keys(uls)) {
      if (k === 'hint') continue;
      show(uls[k], k === name);
    }
  }

  function onGameStart() {
    showOnly(null);
    paused = false;
    hintTimer = 4.2;
    show(uls.hint, true);
    syncPauseBtn();
    syncMuteBtn();
  }

  function hideHint() {
    if (uls.hint && uls.hint.classList.contains('show')) show(uls.hint, false);
  }

  function onGameOver(data) {
    if (!data) data = G.lastOverData || { score: 0, best: 0, maxLevel: 0, totalMerges: 0, maxCombo: 0 };
    shareData = data;
    $('over-score').textContent = String(data.score);
    $('over-best').textContent = String(data.best);
    $('over-cat').textContent = CFG.catOf(data.maxLevel).name;
    $('over-merge').textContent = String(data.totalMerges);
    $('over-combo').textContent = 'x' + data.maxCombo;
    $('over-record').classList.toggle('show', !!data.isRecord);
    showOnly('over');
    if (platform) platform.saveBest(data.best);
  }

  function startGame() {
    Sound.init();
    paused = false;
    G.start();
    showOnly(null);
  }

  function togglePause() {
    if (G.state === 'menu' || G.state === 'over') return;
    if (G.state === 'paused') {
      G.state = 'playing';
      paused = false;
      showOnly(null);
    } else {
      G.state = 'paused';
      paused = true;
      showOnly('pause');
    }
    syncPauseBtn();
  }

  function toggleMute() {
    Sound.init();
    Sound.toggleMute();
    syncMuteBtn();
    if (platform) platform.saveMuted(Sound.muted);
  }

  function syncMuteBtn() {
    const b = $('btn-mute');
    if (b) b.textContent = Sound.muted ? '🔇' : '🔊';
  }

  function syncPauseBtn() {
    const b = $('btn-pause');
    if (b) b.textContent = G.state === 'paused' ? '▶' : '❚❚';
  }

  $('btn-start').addEventListener('click', startGame);
  $('btn-again').addEventListener('click', startGame);
  $('btn-home').addEventListener('click', () => {
    G.reset();
    G.state = 'menu';
    showOnly('menu');
  });
  $('btn-pause').addEventListener('click', (e) => { e.stopPropagation(); togglePause(); });
  $('btn-mute').addEventListener('click', (e) => { e.stopPropagation(); toggleMute(); });
  $('btn-resume').addEventListener('click', togglePause);
  $('btn-restart').addEventListener('click', startGame);

  $('btn-share').addEventListener('click', () => {
    const data = Object.assign({}, shareData || {}, { date: '' });
    cardCanvas = Share.card(data);
    const img = $('share-img');
    img.src = cardCanvas.toDataURL('image/png');
    showOnly('share');
  });
  let tipTimer = 0;
  function showTip(text) {
    const tip = $('save-tip');
    if (!tip) return;
    if (text) tip.textContent = text;
    tip.classList.add('show');
    clearTimeout(tipTimer);
    tipTimer = setTimeout(() => tip.classList.remove('show'), 2600);
  }

  $('btn-save').addEventListener('click', () => {
    if (!cardCanvas) return;
    // 小工具容器禁用 a[download]，优先用平台「保存到相册」
    if (platform && platform.canSave()) {
      showTip('正在保存…');
      platform.saveImage(cardCanvas).then(
        () => showTip('已保存到相册'),
        () => showTip('保存失败，可截图保存')
      );
      return;
    }
    Share.save(cardCanvas, '合成大猫咪_' + ((shareData && shareData.score) || 0) + '分.png');
    showTip('已保存 · 长按图片可存相册');
  });

  // 容器支持 postNote 时，直接带着战绩卡打开笔记发布页
  if (platform && platform.canPost()) {
    const postBtn = $('btn-post');
    if (postBtn) {
      postBtn.hidden = false;
      postBtn.addEventListener('click', () => {
        if (!cardCanvas) return;
        const cat = CFG.catOf((shareData && shareData.maxLevel) || 0).name;
        const score = (shareData && shareData.score) || 0;
        showTip('正在打开笔记…');
        platform.postNote(cardCanvas, {
          title: '我合成了' + cat,
          content: '《合成大猫咪》打到 ' + score + ' 分，进化到「' + cat +
            '」。两只一样的猫碰一下就合成下一级，10 级能合出猫神，你能合到哪一只？',
        }).then(
          () => showTip('已打开发布页'),
          () => showTip('打开失败，可先保存图片')
        );
      });
    }
  }
  $('btn-close-share').addEventListener('click', () => {
    showOnly(G.state === 'over' ? 'over' : null);
  });

  /* ---------- 菜单里的猫咪进化链 ---------- */
  function drawMenuChain() {
    const el = $('menu-chain');
    if (!el || !window.CatArt) return;
    const cssW = el.clientWidth || 320;
    // 保持 canvas 固有比例 720:150，避免纵向被拉伸（Chrome 61 不用 aspect-ratio）
    const cssH = Math.max(56, Math.round((cssW * 150) / 720));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    el.width = Math.round(cssW * dpr);
    el.height = Math.round(cssH * dpr);
    const ctx = el.getContext('2d');
    ctx.setTransform((cssW * dpr) / 720, 0, 0, (cssH * dpr) / 150, 0, 0);
    ctx.clearRect(0, 0, 720, 150);
    for (let i = 0; i < CFG.LEVELS.length; i++) {
      const x = 40 + i * 72;
      window.CatArt.draw(ctx, { x: x, y: 54, r: 24, level: i, t: 0.4, blink: false });
      ctx.fillStyle = 'rgba(120,80,62,0.85)';
      ctx.font = '600 15px "PingFang SC",system-ui,sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(CFG.LEVELS[i].name, x, 126);
    }
  }

  /* ---------- 主循环 ---------- */
  function frame(ts) {
    const dt = last ? Math.min(0.05, (ts - last) / 1000) : 0.016;
    last = ts;
    if (!paused && G.state !== 'menu') G.update(dt);
    else G.update(0);
    G.render();
    if (hintTimer > 0) {
      hintTimer -= dt;
      if (hintTimer <= 0) hideHint();
    }
    requestAnimationFrame(frame);
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && G.state === 'playing') togglePause();
  });

  if (platform && platform.inContainer()) {
    const tip = $('save-tip');
    if (tip) tip.textContent = '已保存到相册';
  }
  if (platform) {
    platform.loadState().then((state) => {
      if (!state) return;
      if (state.best > G.best) {
        G.best = state.best;
        try { localStorage.setItem('suika-cat-best', String(G.best)); } catch (err) {}
        G.render();
      }
      if (typeof state.muted === 'boolean') {
        Sound.setMuted(state.muted);
        syncMuteBtn();
      }
    });
  }

  window.addEventListener('resize', resize);
  resize();
  syncMuteBtn();
  syncPauseBtn();
  showOnly('menu');
  requestAnimationFrame(frame);

  /* ---------- 测试 / 外部接口 ---------- */
  window.SUIKA = {
    game: G,
    cfg: CFG,
    start: startGame,
    dropAt: function (x) { G.setAim(x); return G.drop(); },
    forceDrop: function (level, x) {
      const b = window.CatPhysics.makeBody(level, x, CFG.DROP_Y, { vy: 340 });
      b.born = 99;
      G.bodies.push(b);
      return b;
    },
    overlay: function (name) { showOnly(name); },
    platform: platform,
    cardCanvas: function (data) { return Share.card(data || shareData || {}); },
    coverCanvas: function () { return Share.cover(); },
    get state() { return G.state; },
    get paused() { return paused; },
    set paused(v) { paused = !!v; },
  };
  window.SUIKA_READY = true;
})();
