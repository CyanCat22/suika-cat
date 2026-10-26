/* 合成大猫咪 · 入口：缩放、输入、界面切换、分享图
 * 逻辑坐标固定 720×1280，画布按视口等比缩放（竖屏）。
 */
(function () {
  const CFG = window.CATCFG;
  const G = window.CatGame;
  const Sound = window.CatAudio;
  const Share = window.CatShare;
  const platform = window.CatPlatform || null;
  const Coll = window.Collection;
  const Challenge = window.Challenge;
  const $ = (id) => document.getElementById(id);

  const canvas = $('game');
  const uls = {
    menu: $('menu'), over: $('over'), pause: $('pause'), share: $('share'),
    gallery: $('gallery'), hint: $('hint'),
  };
  let paused = false;
  let dragging = false;
  let last = 0;
  let shareData = null;
  let cardCanvas = null;
  let hintTimer = 0;
  let nick = Challenge ? Challenge.readNick() : '路人猫';
  let rival = Challenge ? Challenge.readRival() : null;
  let unlockedToastT = 0;

  G.init(canvas);
  G.hooks.onOver = (data) => { shareData = data; refreshCollLabels(); };

  // 合成出新猫 → 记进图鉴；第一次见到时给一个游戏内提示（不打断节奏）
  G.hooks.onMerge = (level) => {
    if (!Coll) return;
    const rec = Coll.record(level, CFG.today());
    refreshCollLabels();
    if (rec.isNew) {
      const cat = CFG.catOf(level);
      clearTimeout(unlockedToastT);
      if (Sound && Sound.unlock) Sound.unlock();
      G.addPopup('图鉴 +1 · ' + cat.name, CFG.W / 2, CFG.DANGER_Y + 210, {
        size: 34, color: '#b05cff', rise: 54, life: 1.5,
      });
      const banner = $('coll-toast');
      if (banner) {
        banner.textContent = '新图鉴解锁：' + cat.name + '（' + rec.unlocked + '/' + rec.total + '）';
        banner.classList.add('show');
        unlockedToastT = setTimeout(() => banner.classList.remove('show'), 1800);
      }
    }
  };
  // 投出去的猫也算"见过"（0-4 级会随开局自然解锁）
  G.hooks.onSpawn = (level) => {
    if (!Coll) return;
    if (Coll.record(level, CFG.today()).isNew) refreshCollLabels();
  };
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
    syncShareData();
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
    refreshCollLabels();
    refreshCompare(data.score);
    refreshMenu();
  }

  /* 结束页：和挑战者的分数对比 */
  function refreshCompare(score) {
    const el = $('over-compare');
    if (!el) return;
    const text = rival ? Challenge.compareText(rival, score) : '';
    el.textContent = text;
    el.classList.toggle('hidden', !text);
  }

  /* 首页 / 结束页 / 图鉴的计数与称号 */
  function refreshCollLabels() {
    if (!Coll) return;
    const p = Coll.progress();
    const pct = Math.round((p.unlocked / p.total) * 100) + '%';
    if ($('coll-count')) $('coll-count').textContent = String(p.unlocked);
    if ($('res-coll-count')) $('res-coll-count').textContent = String(p.unlocked);
    if ($('gal-count')) $('gal-count').textContent = String(p.unlocked);
    if ($('res-coll-fill')) $('res-coll-fill').style.width = pct;
    const title = Coll.title();
    if ($('coll-title-text')) $('coll-title-text').textContent = title;
    if ($('res-coll-title')) $('res-coll-title').textContent = title;
    if ($('gal-title-text')) $('gal-title-text').textContent = title;
    if ($('gal-tip')) {
      $('gal-tip').textContent = Coll.remain() > 0
        ? '合出过的猫会亮起来 · 还差 ' + Coll.remain() + ' 只集齐'
        : '全部集齐！你已经是猫咖店长了';
    }
  }

  /* 首页：最高分 / 被挑战横幅 / 猫名 */
  function refreshMenu() {
    if ($('menu-best')) $('menu-best').textContent = String(G.best || 0);
    if ($('nick')) $('nick').value = nick === Challenge.DEFAULT_NICK ? '' : nick;
    const banner = $('rival-banner');
    if (!banner) return;
    if (rival) {
      banner.classList.remove('hidden');
      $('rival-name').textContent = rival.nick;
      $('rival-score').textContent = String(rival.score);
      $('rival-cat').textContent = rival.label;
    } else {
      banner.classList.add('hidden');
    }
  }

  function syncShareData() {
    if (!shareData) return;
    shareData.nick = nick;
    shareData.collCount = Coll ? Coll.unlockedCount() : 0;
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
    syncShareData();
    const data = Object.assign({}, shareData || {}, {
      date: CFG.today(),
      nick: nick,
      collCount: Coll ? Coll.unlockedCount() : 0,
    });
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
    syncShareData();
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
        const info = shareInfo();
        showTip('正在打开笔记…');
        platform.postNote(cardCanvas, {
          title: Challenge.noteTitle(info),
          content: Challenge.noteContent(info),
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

  /* ---------- 图鉴入口 ---------- */
  ['btn-gallery', 'btn-gallery2'].forEach((id) => {
    const b = $(id);
    if (b) b.addEventListener('click', openGallery);
  });
  if ($('btn-close-gallery')) {
    $('btn-close-gallery').addEventListener('click', () => {
      showOnly(G.state === 'over' ? 'over' : 'menu');
    });
  }
  if ($('btn-rival')) $('btn-rival').addEventListener('click', () => startGame());

  /* ---------- 猫名 ---------- */
  if ($('nick')) {
    $('nick').addEventListener('change', () => {
      nick = Challenge.writeNick($('nick').value);
      $('nick').value = nick === Challenge.DEFAULT_NICK ? '' : nick;
      if (platform) platform.save('suika-nick', nick);
      showTip('猫名已保存：' + nick);
    });
  }

  /* ---------- 分享面板：贴评论 / 查看文案 ---------- */
  function shareInfo() {
    const d = shareData || {};
    return {
      score: d.score || 0,
      maxLevel: d.maxLevel || 0,
      maxCombo: d.maxCombo || 0,
      merges: d.totalMerges || 0,
      date: CFG.today(),
      code: CFG.dayCode(),
      nick: nick,
      collection: Coll ? Coll.unlockedCount() : 0,
    };
  }

  function showShareText(text) {
    const box = $('share-text');
    if (!box) return;
    box.textContent = text;
    box.classList.remove('hidden');
  }

  if ($('btn-copy')) {
    $('btn-copy').addEventListener('click', () => {
      const info = shareInfo();
      showShareText(Challenge.noteContent(info));
      showTip('长按文案即可复制');
    });
  }

  if ($('btn-comment')) {
    $('btn-comment').addEventListener('click', () => {
      if (!cardCanvas) return;
      const info = shareInfo();
      const snap = Challenge.encodeSnapshot(info);
      // 容器会先关掉小工具再拉起评论区：调用前先落盘
      try { localStorage.setItem('suika-last', JSON.stringify({ score: info.score, lv: info.maxLevel, d: info.date })); } catch (err) {}
      if (platform) {
        platform.save('suika-last', { score: info.score, lv: info.maxLevel, d: info.date });
        platform.save(Challenge.SNAP_KEY, snap.data);
      }
      const content = Challenge.commentText(info);
      if (!platform || !platform.postComment) {
        showShareText(content + '\n\n' + Challenge.noteContent(info));
        showTip('当前环境不能发评论，已展开文案供长按复制');
        return;
      }
      showTip('正在拉起评论区…');
      platform.postComment(cardCanvas, { content: content, snapshot: snap.data }).then(
        () => showTip('评论区已拉起，发送后会带上战绩卡'),
        () => showTip('拉起失败，可改用「发笔记」或保存图片')
      );
    });
  }

  // 版本/能力不足时提前禁用评论入口，避免"点了没反应"
  if ($('btn-comment') && platform && !platform.canCommentSync()) {
    $('btn-comment').disabled = true;
    $('btn-comment').style.opacity = '0.45';
  }

  /* ---------- 图鉴面板 ---------- */
  function renderGallery() {
    const grid = $('gal-grid');
    if (!grid || !Coll) return;
    const all = Coll.all();
    grid.innerHTML = '';
    for (let i = 0; i < all.length; i++) {
      const it = all[i];
      const cell = document.createElement('div');
      cell.className = 'gal-cell' + (it.unlocked ? '' : ' locked');
      cell.setAttribute('data-level', String(i));
      const cv = document.createElement('canvas');
      cell.appendChild(cv);
      const name = document.createElement('div');
      name.className = 'gal-name';
      name.textContent = it.unlocked ? it.cat.name : '？？？';
      cell.appendChild(name);
      const meta = document.createElement('div');
      meta.className = 'gal-meta';
      meta.textContent = it.unlocked ? ('合出 ' + it.count + ' 次' + (it.first ? ' · ' + it.first.slice(5) : '')) : '还没合出来';
      cell.appendChild(meta);
      grid.appendChild(cell);
      drawGalleryCell(cv, i, it.unlocked);
    }
    refreshCollLabels();
  }

  function drawGalleryCell(cv, level, unlocked) {
    const css = cv.clientWidth || 64;
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    cv.width = Math.round(css * dpr);
    cv.height = Math.round(css * dpr);
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, css, css);
    const r = css * 0.36;
    if (!window.CatArt) return;
    ctx.save();
    window.CatArt.draw(ctx, { x: css / 2, y: css / 2, r: r, level: level, t: 0.4, blink: false });
    if (!unlocked) {
      // 未解锁：整只猫压成灰色剪影，再叠一个问号
      ctx.globalCompositeOperation = 'source-atop';
      ctx.fillStyle = 'rgba(120, 96, 82, 0.72)';
      ctx.fillRect(0, 0, css, css);
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = 'rgba(255, 250, 244, 0.92)';
      ctx.font = '900 ' + Math.round(css * 0.34) + 'px "PingFang SC", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('?', css / 2, css / 2 + css * 0.04);
    }
    ctx.restore();
  }

  function openGallery() {
    renderGallery();
    if (Sound && Sound.click) Sound.click();
    showOnly('gallery');
  }

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

  if (Coll) {
    Coll.init().then(() => {
      refreshCollLabels();
      refreshMenu();
    });
    Coll.onChange(() => refreshCollLabels());
  }
  refreshCollLabels();
  refreshMenu();
  if (platform && platform.load) {
    platform.load('suika-nick').then((n) => {
      if (!n) return;
      nick = Challenge.writeNick(n);
      refreshMenu();
    });
  }
  if (platform && platform.readSnapshot) {
    platform.readSnapshot().then((snapObj) => {
      const snap = Challenge.decodeSnapshot(snapObj);
      if (!snap) return;
      rival = snap;
      Challenge.writeRival(snap);
      refreshMenu();
      showTip('有人向你发起挑战：' + snap.nick + ' 打了 ' + snap.score + ' 分');
    });
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
    collection: Coll,
    challenge: Challenge,
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
    renderGallery: renderGallery,
    galleryCount: function () { return document.querySelectorAll('#gal-grid .gal-cell').length; },
    lockedCount: function () { return document.querySelectorAll('#gal-grid .gal-cell.locked').length; },
    refreshMenu: refreshMenu,
    nick: function () { return nick; },
    setNick: function (n) { nick = Challenge.writeNick(n); refreshMenu(); return nick; },
    rival: function () { return rival; },
    setRival: function (snap) { rival = snap; refreshMenu(); return rival; },
    shareInfo: shareInfo,
    openGallery: openGallery,
    ui: {
      best: function () { return $('menu-best') ? $('menu-best').textContent : ''; },
      collCount: function () { return $('coll-count') ? $('coll-count').textContent : ''; },
      collTitle: function () { return $('coll-title-text') ? $('coll-title-text').textContent : ''; },
      overScore: function () { return $('over-score').textContent; },
      overCat: function () { return $('over-cat').textContent; },
      overCompare: function () { const el = $('over-compare'); return el && !el.classList.contains('hidden') ? el.textContent : ''; },
      rivalShown: function () { const el = $('rival-banner'); return !!el && !el.classList.contains('hidden'); },
      rivalText: function () { return $('rival-line') ? '' : ($('rival-name') ? $('rival-name').textContent : ''); },
      shareText: function () { const el = $('share-text'); return el && !el.classList.contains('hidden') ? el.textContent : ''; },
      tip: function () { return $('save-tip') ? $('save-tip').textContent : ''; },
      commentDisabled: function () { return !!$('btn-comment') && $('btn-comment').disabled; },
    },
    get state() { return G.state; },
    get paused() { return paused; },
    set paused(v) { paused = !!v; },
  };
  window.SUIKA_READY = true;
})();
