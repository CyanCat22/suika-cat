/* 功能 / 物理 / 渲染 自动化验收
 * 用法: node tests/qa-func.mjs
 */
import { puppeteer, CHROME, ROOT_DIR } from './_puppeteer.mjs';
import path from 'node:path';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0;
const fails = [];
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fails.push(name + (extra ? '  → ' + extra : '')); console.log('  ✗', name, extra || ''); }
}

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true,
  args: ['--no-sandbox', '--hide-scrollbars', '--autoplay-policy=no-user-gesture-required'],
  defaultViewport: { width: 720, height: 1280, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
await page.goto('file://' + path.join(ROOT_DIR, 'index.html'), { waitUntil: 'load' });
await page.waitForFunction('window.SUIKA_READY === true');
await sleep(300);

console.log('\n[1] 启动与画布');
ok('SUIKA_READY', true);
const boot = await page.evaluate(() => {
  const c = document.getElementById('game');
  return {
    w: c.width, h: c.height,
    cssW: parseFloat(getComputedStyle(c).width),
    menuShown: document.getElementById('menu').classList.contains('show'),
    state: window.SUIKA.state,
    levels: window.CATCFG.LEVELS.length,
  };
});
ok('画布内部分辨率 = 720×1280', boot.w === 720 && boot.h === 1280, JSON.stringify([boot.w, boot.h]));
ok('首页显示', boot.menuShown && boot.state === 'menu');
ok('10 级猫咪图鉴', boot.levels === 10, String(boot.levels));

console.log('\n[2] 开始游戏与投放');
await page.evaluate(() => window.SUIKA.start());
await sleep(250);
const s1 = await page.evaluate(() => ({
  state: window.SUIKA.state,
  menuShown: document.getElementById('menu').classList.contains('show'),
}));
ok('进入 playing 且首页隐藏', s1.state === 'playing' && !s1.menuShown);

const dropRes = await page.evaluate(() => {
  const g = window.SUIKA.game;
  g.dropCd = 0;
  const before = g.bodies.length;
  const cur = g.curLevel;
  const okDrop = window.SUIKA.dropAt(200);
  return { okDrop, added: g.bodies.length - before, cur, next: g.nextLevel, cd: g.dropCd, bodies: g.bodies.length };
});
ok('投放成功、猫数 +1', dropRes.okDrop === true && dropRes.added === 1, JSON.stringify(dropRes));
ok('投放后进入冷却', dropRes.cd > 0.3);
const blocked = await page.evaluate(() => window.SUIKA.dropAt(300));
ok('冷却中不可再投', blocked === false);

console.log('\n[3] 合成与计分');
const mergeRes = await page.evaluate(() => {
  const g = window.SUIKA.game;
  const P = window.CatPhysics;
  g.bodies = [];
  g.score = 0; g.combo = 0; g.comboT = 0; g.totalMerges = 0; g.maxLevel = 0;
  g.state = 'playing';
  const a = P.makeBody(0, 300, 1000, {}); a.born = 99;
  const b = P.makeBody(0, 330, 1030, {}); b.born = 99;
  g.bodies.push(a, b);
  g.acc = 0;
  g.update(1 / 60);
  const merged = g.bodies.filter((x) => x.level === 1);
  return {
    bodies: g.bodies.length, score: g.score, total: g.totalMerges,
    mergedLevel: merged.length ? merged[0].level : null,
    maxLevel: g.maxLevel, combo: g.combo,
  };
});
ok('两只同款猫合成下一级', mergeRes.mergedLevel === 1 && mergeRes.bodies === 1, JSON.stringify(mergeRes));
ok('合成后加分', mergeRes.score > 0, 'score=' + mergeRes.score);
ok('记录合成次数与最高级', mergeRes.total === 1 && mergeRes.maxLevel === 1);

const maxRes = await page.evaluate(() => {
  const g = window.SUIKA.game;
  const P = window.CatPhysics;
  g.bodies = [];
  const a = P.makeBody(window.CATCFG.MAX_LEVEL, 300, 1000); a.born = 99;
  const b = P.makeBody(window.CATCFG.MAX_LEVEL, 330, 1030); b.born = 99;
  g.bodies.push(a, b);
  g.update(1 / 60);
  return { bodies: g.bodies.length, levels: g.bodies.map((x) => x.level) };
});
ok('满级猫不再合成', maxRes.bodies === 2, JSON.stringify(maxRes));

console.log('\n[4] 物理：堆叠稳定性');
const phys = await page.evaluate(() => {
  const g = window.SUIKA.game;
  const P = window.CatPhysics;
  const cfg = window.CATCFG;
  g.bodies = [];
  g.score = 0; g.comboT = 0;
  for (let i = 0; i < 34; i++) {
    const lv = (i * 3) % 5;
    const b = P.makeBody(lv, 90 + ((i * 97) % 540), 260 + ((i * 61) % 600));
    b.born = 99;
    g.bodies.push(b);
  }
  for (let i = 0; i < 400; i++) g.update(1 / 60);
  // 合并产生的“新猫”会短暂压住邻居，再给 90 帧完全落定
  for (let i = 0; i < 90; i++) g.update(1 / 60);
  // 检测重叠与出界
  let maxOverlap = 0;
  let outWall = 0;
  let belowFloor = 0;
  let moving = 0;
  for (let i = 0; i < g.bodies.length; i++) {
    const a = g.bodies[i];
    if (a.x - a.r < cfg.WALL - 1.5 || a.x + a.r > cfg.W - cfg.WALL + 1.5) outWall++;
    if (a.y + a.r > cfg.FLOOR + 1.5) belowFloor++;
    if (Math.abs(a.vx) + Math.abs(a.vy) > 120) moving++;
    for (let j = i + 1; j < g.bodies.length; j++) {
      const b = g.bodies[j];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      maxOverlap = Math.max(maxOverlap, a.r + b.r - d);
    }
  }
  return { n: g.bodies.length, maxOverlap, outWall, belowFloor, moving, state: g.state, score: g.score };
});
ok('落定后无明显穿插（<4px）', phys.maxOverlap < 4, 'maxOverlap=' + phys.maxOverlap.toFixed(2));
ok('没有猫穿墙 / 穿底', phys.outWall === 0 && phys.belowFloor === 0, JSON.stringify([phys.outWall, phys.belowFloor]));
ok('落定后基本静止', phys.moving === 0, 'moving=' + phys.moving);

console.log('\n[5] 危险线与结束');
const over = await page.evaluate(() => {
  const g = window.SUIKA.game;
  const cfg = window.CATCFG;
  const P = window.CatPhysics;
  g.state = 'playing';
  g.bodies = [];
  g.overWarn = 0;
  g.score = 500;
  delete g.hooks.onOver._done;
  const b = P.makeBody(1, 360, 190, {});
  b.born = 99; b.vy = 0; b.age = 1; b.overT = 0;
  g.bodies.push(b);
  let frames = 0;
  let warnSeen = 0;
  while (g.state === 'playing' && frames < 400) {
    g.update(1 / 60);
    warnSeen = Math.max(warnSeen, g.overWarn);
    b.x = 360; b.y = 190; b.vx = 0; b.vy = 0; b.age = 1;
    frames++;
  }
  return { state: g.state, frames, warn: +warnSeen.toFixed(2), score: g.score, best: g.best };
});
ok('超线停留判负', over.state === 'over', JSON.stringify(over));
ok('判负前有危险警告', over.warn > 0.2, 'warn=' + over.warn);
ok('判负节奏接近 1.7 秒', over.frames > 90 && over.frames < 220, 'frames=' + over.frames);

// headless 下 rAF 被节流，手动推进 60 帧（1 秒）触发结算界面
await page.evaluate(() => { const g = window.SUIKA.game; for (let i = 0; i < 60; i++) g.update(1 / 60); });
await sleep(200);
const overUI = await page.evaluate(() => ({
  shown: document.getElementById('over').classList.contains('show'),
  score: document.getElementById('over-score').textContent,
  best: document.getElementById('over-best').textContent,
  cat: document.getElementById('over-cat').textContent,
  bestLS: localStorage.getItem('suika-cat-best'),
}));
ok('结算页弹出且填入数据', overUI.shown && overUI.score === String(over.score) && Number(overUI.best) >= 500, JSON.stringify(overUI));
ok('最高分写入 localStorage', overUI.bestLS !== null && Number(overUI.bestLS) >= 500, String(overUI.bestLS));

console.log('\n[6] 暂停 / 静音 / 分享图');
const ui2 = await page.evaluate(() => {
  const g = window.SUIKA.game;
  g.state = 'playing';
  document.getElementById('btn-pause').click();
  const p1 = { state: g.state, shown: document.getElementById('pause').classList.contains('show') };
  document.getElementById('btn-resume').click();
  const p2 = { state: g.state, shown: document.getElementById('pause').classList.contains('show') };
  const m0 = window.CatAudio.muted;
  document.getElementById('btn-mute').click();
  const m1 = window.CatAudio.muted;
  document.getElementById('btn-mute').click();
  const m2 = window.CatAudio.muted;
  return { p1, p2, m0, m1, m2 };
});
ok('暂停 / 继续', ui2.p1.state === 'paused' && ui2.p1.shown && ui2.p2.state === 'playing' && !ui2.p2.shown, JSON.stringify(ui2));
ok('静音切换生效', ui2.m1 !== ui2.m0 && ui2.m2 === ui2.m0, JSON.stringify([ui2.m0, ui2.m1, ui2.m2]));

const share = await page.evaluate(() => {
  const card = window.CatShare.card({ score: 1286, best: 1286, isRecord: true, maxLevel: 7, totalMerges: 46, maxCombo: 6 });
  const cover = window.CatShare.cover();
  const ctx = card.getContext('2d');
  const d = ctx.getImageData(0, 0, card.width, card.height).data;
  let dark = 0;
  let colored = 0;
  for (let i = 0; i < d.length; i += 4 * 97) {
    const lum = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255;
    if (lum < 0.55) dark++;
    if (Math.abs(d[i] - d[i + 2]) > 45) colored++;
  }
  const samples = Math.floor(d.length / (4 * 97));
  return { w: card.width, h: card.height, cover: [cover.width, cover.height], dark, colored, samples };
});
ok('战绩卡 1080×1440', share.w === 1080 && share.h === 1440, JSON.stringify(share));
ok('封面图 1080×1440', share.cover[0] === 1080 && share.cover[1] === 1440);
ok('战绩卡有文字与彩色内容', share.dark > 20 && share.colored > 200, JSON.stringify(share));

console.log('\n[7] 画布像素检查（猫咪真的画出来了）');
// 重新载入页面，确保渲染状态干净（避免前面用例留下的状态影响像素采样）
await page.goto('file://' + path.join(ROOT_DIR, 'index.html'), { waitUntil: 'load' });
await page.waitForFunction('window.SUIKA_READY === true');
await page.evaluate(() => window.SUIKA.start());
await sleep(250);
const pix = await page.evaluate(async () => {
  const g = window.SUIKA.game;
  const cfg = window.CATCFG;
  const P = window.CatPhysics;
  g.state = 'paused';
  g.blinkEnabled = false;
  const c = document.getElementById('game');
  const ctx = c.getContext('2d');
  const sx = c.width / 720;
  const sy = c.height / 1280;
  const at = (x, y) => {
    const d = ctx.getImageData(Math.max(0, Math.round(x * sx)), Math.max(0, Math.round(y * sy)), 1, 1).data;
    return {
      lum: (0.299 * d[0] + 0.587 * d[1] + 0.114 * d[2]) / 255,
      rgb: [d[0], d[1], d[2]],
    };
  };
  // 眼睛这种小特征，取 3×3 最暗值，避免抗锯齿边缘影响
  const minAt = (x, y) => {
    let m = 1;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) m = Math.min(m, at(x + dx, y + dy).lum);
    return m;
  };
  const bg = at(660, 200);
  const out = [];
  for (let lv = 0; lv < cfg.LEVELS.length; lv++) {
    g.bodies = [];
    const x = 360;
    const y = 640;
    const b = P.makeBody(lv, x, y);
    b.born = 99; b.angle = 0; b.vx = 0; b.vy = 0; b.age = 1;
    g.bodies.push(b);
    g.render();  // 同步渲染一帧，避免 rAF 时序干扰像素采样
    const r = cfg.LEVELS[lv].r;
    const inside = [];
    for (let a = 0; a < 32; a++) {
      const ang = (a / 32) * Math.PI * 2;
      inside.push(at(x + Math.cos(ang) * r * 0.55, y + Math.sin(ang) * r * 0.55));
    }
    const meanLum = inside.reduce((s, v) => s + v.lum, 0) / inside.length;
    const meanRGB = [0, 1, 2].map((ch) => inside.reduce((s, v) => s + v.rgb[ch], 0) / inside.length);
    const ring = [];
    for (let a = 0; a < 24; a++) {
      const ang = (a / 24) * Math.PI * 2;
      ring.push(at(x + Math.cos(ang) * r, y + Math.sin(ang) * r).lum);
    }
    const meanRing = ring.reduce((s, v) => s + v, 0) / ring.length;
    const eyeL = minAt(x - 0.33 * r, y - 0.02 * r);
    const eyeR = minAt(x + 0.33 * r, y - 0.02 * r);
    const dist = Math.hypot(meanRGB[0] - bg.rgb[0], meanRGB[1] - bg.rgb[1], meanRGB[2] - bg.rgb[2]);
    out.push({
      lv, name: cfg.LEVELS[lv].name, r,
      contrast: +(meanLum - meanRing).toFixed(3),
      eyeL: +eyeL.toFixed(3), eyeR: +eyeR.toFixed(3),
      distBg: +dist.toFixed(1),
    });
  }
  // 罐壁：描边在 x = WALL-8 与 W-WALL+8
  const wallL = at(cfg.WALL - 8, 700);
  const wallR = at(cfg.W - cfg.WALL + 8, 700);
  // HUD 分数文字
  let hudDark = 0;
  for (let x = 40; x < 260; x += 3) for (let y = 60; y < 110; y += 3) if (at(x, y).lum < 0.62) hudDark++;
  // 警戒线
  const danger = [];
  for (let x = 80; x < 640; x += 20) danger.push(at(x, cfg.DANGER_Y).rgb);
  return { out, wallL: wallL.rgb, wallR: wallR.rgb, hudDark, danger };
});
const bad = pix.out.filter((p) => !(p.contrast > 0.05 && p.eyeL < 0.45 && p.eyeR < 0.45 && (p.lv === 0 || p.distBg > 10)));
for (const p of pix.out) {
  console.log('    ' + p.name.padEnd(4, ' ') + ' 描边对比=' + p.contrast + ' 眼=' + p.eyeL + '/' + p.eyeR + ' 与底色差=' + p.distBg);
}
ok('10 只猫都有描边 + 五官 + 填充色', bad.length === 0, bad.map((p) => p.name).join(','));
ok('HUD 分数文字可见', pix.hudDark > 8, 'darkPixels=' + pix.hudDark);
const warm = (rgb) => rgb[0] > 180 && rgb[0] - rgb[2] > 45;
ok('罐壁描边偏暖色', warm(pix.wallL) && warm(pix.wallR), JSON.stringify([pix.wallL, pix.wallR]));
const dashed = pix.danger.filter((c) => c[0] - c[2] > 18).length;
ok('警戒线虚线可见', dashed >= 2, dashed + '/' + pix.danger.length + ' 采样点偏暖');

console.log('\n[8] 渲染性能（headless 下 rAF 会被节流，改测单帧耗时）');
const perf = await page.evaluate(() => {
  const g = window.SUIKA.game;
  const P = window.CatPhysics;
  const cfg = window.CATCFG;
  g.state = 'playing';
  g.bodies = [];
  for (let i = 0; i < 40; i++) {
    const b = P.makeBody(i % 7, 90 + ((i * 97) % 540), 380 + ((i * 61) % (cfg.H - 500)));
    b.born = 99;
    g.bodies.push(b);
  }
  for (let i = 0; i < 60; i++) g.update(1 / 60);   // 先落定
  const t0 = performance.now();
  for (let i = 0; i < 60; i++) { g.update(1 / 60); g.render(); }
  const perFrame = (performance.now() - t0) / 60;
  // 物理单步耗时
  const t1 = performance.now();
  for (let i = 0; i < 240; i++) window.CatPhysics.step(g.bodies.slice(), 1 / 120);
  const perStep = (performance.now() - t1) / 240;
  return { perFrame: +perFrame.toFixed(2), perStep: +perStep.toFixed(3), n: g.bodies.length };
});
ok('40 只猫单帧 update+render < 12ms', perf.perFrame < 12, JSON.stringify(perf));
ok('物理单子步 < 1ms', perf.perStep < 1, JSON.stringify(perf));

console.log('\n[9] 响应式与错误');
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
await sleep(400);
const phone = await page.evaluate(() => {
  const c = document.getElementById('game');
  const r = c.getBoundingClientRect();
  return {
    w: Math.round(r.width), h: Math.round(r.height),
    vw: innerWidth, vh: innerHeight,
    worldH: window.CATCFG.H, floor: window.CATCFG.FLOOR,
    state: window.SUIKA.state,
  };
});
ok('手机竖屏铺满全屏（不留黑边）', phone.w === phone.vw && phone.h === phone.vh, JSON.stringify(phone));
ok('瘦长屏把世界纵向拉长', phone.worldH > 1280 && phone.floor === phone.worldH - 76, JSON.stringify([phone.worldH, phone.floor]));

await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
await sleep(400);
const desk = await page.evaluate(() => {
  const c = document.getElementById('game');
  const r = c.getBoundingClientRect();
  return {
    w: Math.round(r.width), h: Math.round(r.height),
    ratio: +(r.width / r.height).toFixed(3),
    vw: innerWidth, vh: innerHeight,
    worldH: window.CATCFG.H,
    overflowX: document.documentElement.scrollWidth > innerWidth,
    overflowY: document.documentElement.scrollHeight > innerHeight,
  };
});
ok('宽屏保持 9:16 居中', Math.abs(desk.ratio - 0.5625) < 0.01 && desk.worldH === 1280, JSON.stringify(desk));
ok('无横向 / 纵向滚动', !desk.overflowX && !desk.overflowY, JSON.stringify(desk));
ok('无 JS 报错', errors.length === 0, errors.join(' | '));


/* ================= 图鉴收集 / 评论区挑战（2026-10-26 追加） ================= */
console.log('\n[10] 图鉴收集');
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
await page.reload({ waitUntil: 'load' });
await page.waitForFunction('window.SUIKA_READY === true');
await sleep(300);

const coll0 = await page.evaluate(() => {
  SUIKA.renderGallery();
  return {
    unlocked: SUIKA.collection.unlockedCount(),
    total: SUIKA.collection.progress().total,
    title: SUIKA.collection.title(),
    menuCount: SUIKA.ui.collCount(),
    locked: SUIKA.lockedCount(),
    cells: SUIKA.galleryCount(),
    firstLockedName: (document.querySelector('.gal-cell.locked .gal-name') || {}).textContent,
  };
});
ok('初始 0/10，全锁，称号=猫咖实习生', coll0.unlocked === 0 && coll0.total === 10 && coll0.title === '猫咖实习生', JSON.stringify(coll0));
ok('图鉴面板 10 格、全部剪影、名字为 ？？？', coll0.cells === 10 && coll0.locked === 10 && coll0.firstLockedName === '？？？', JSON.stringify(coll0));
ok('首页计数与图鉴一致', coll0.menuCount === '0');

// 合成 L1→L2 解锁「狸花仔」
const m1 = await page.evaluate(async () => {
  SUIKA.start();
  const g = SUIKA.game, P = window.CatPhysics;
  const a = P.makeBody(1, 320, 900, {}), b = P.makeBody(1, 380, 900, {});
  g.bodies.push(a, b);
  g.doMerge(a, b);
  g.bodies.length = 0;   // 清场：避免物理继续把新猫连锁合成
  await new Promise((r) => setTimeout(r, 120));
  SUIKA.renderGallery();
  const cell = document.querySelectorAll('#gal-grid .gal-cell')[2];
  return {
    unlocked: SUIKA.collection.unlockedCount(),
    count: SUIKA.collection.countOf(2),
    name: cell.querySelector('.gal-name').textContent,
    locked: cell.classList.contains('locked'),
    menuCount: SUIKA.ui.collCount(),
    first: SUIKA.collection.get(2).f,
    toast: (document.getElementById('coll-toast') || {}).textContent || '',
  };
});
ok('合成出 2 级 → 图鉴 +1 且解锁「狸花仔」', m1.unlocked === 1 && m1.name === '狸花仔' && !m1.locked, JSON.stringify(m1));
ok('解锁有提示（新图鉴 toast / 计数同步）', m1.toast.indexOf('新图鉴') >= 0 && m1.menuCount === '1', m1.toast);
ok('首次解锁记录日期', /^\d{4}-\d{2}-\d{2}$/.test(m1.first || ''), m1.first);

const m2 = await page.evaluate(async () => {
  const g = SUIKA.game, P = window.CatPhysics;
  // 再次合成 1→2：次数 +1，不再重复解锁
  const a = P.makeBody(1, 300, 900, {}), b = P.makeBody(1, 360, 900, {});
  g.bodies.push(a, b);
  g.doMerge(a, b);
  g.bodies.length = 0;
  await new Promise((r) => setTimeout(r, 80));
  return { count: SUIKA.collection.countOf(2), unlocked: SUIKA.collection.unlockedCount() };
});
ok('重复合成只加次数、不重复解锁', m2.count >= 2 && m2.unlocked === 1, JSON.stringify(m2));

// 刷新后图鉴还在
await page.reload({ waitUntil: 'load' });
await page.waitForFunction('window.SUIKA_READY === true');
await sleep(250);
const persisted = await page.evaluate(() => ({
  unlocked: SUIKA.collection.unlockedCount(),
  count: SUIKA.collection.countOf(2),
  menuCount: SUIKA.ui.collCount(),
}));
ok('刷新页面后图鉴仍在（localStorage 持久化）', persisted.unlocked === 1 && persisted.count >= 2 && persisted.menuCount === '1', JSON.stringify(persisted));

// 集齐 → 称号升级
const allDone = await page.evaluate(async () => {
  for (let i = 0; i < window.CATCFG.TOTAL; i++) SUIKA.collection.record(i, '2026-10-26');
  SUIKA.renderGallery();
  return {
    unlocked: SUIKA.collection.unlockedCount(),
    title: SUIKA.collection.title(),
    remain: SUIKA.collection.remain(),
    menuTitle: SUIKA.ui.collTitle(),
    locked: SUIKA.lockedCount(),
    tip: document.getElementById('gal-tip').textContent,
  };
});
ok('集齐 10 只 → 猫咖店长，进度 10/10', allDone.unlocked === 10 && allDone.title === '猫咖店长' && allDone.remain === 0, JSON.stringify(allDone));
ok('集齐后图鉴无剪影、首页称号同步', allDone.locked === 0 && allDone.menuTitle === '猫咖店长' && allDone.tip.indexOf('猫咖店长') >= 0, JSON.stringify(allDone));

console.log('\n[11] 评论区挑战赛');
const snapInfo = await page.evaluate(() => {
  SUIKA.setNick('橘座大王');
  const info = { score: 1286, maxLevel: 6, maxCombo: 5, merges: 21, date: '2026-10-26', code: window.CATCFG.dayCode('2026-10-26'), nick: '橘座大王', collection: 10 };
  const enc = SUIKA.challenge.encodeSnapshot(info);
  const dec = SUIKA.challenge.decodeSnapshot(enc.data);
  return {
    json: enc.json, bytes: enc.json.length, data: enc.data,
    dec, comment: SUIKA.challenge.commentText(info),
    title: SUIKA.challenge.noteTitle(info), content: SUIKA.challenge.noteContent(info),
    badG: SUIKA.challenge.decodeSnapshot({ v: 1, g: 'whack', s: 100, lv: 1 }),
    badS: SUIKA.challenge.decodeSnapshot({ v: 1, g: 'suika', s: -5, lv: 1 }),
    nick: SUIKA.nick(),
  };
});
ok('snapshot 字段齐全且 ≤2KB', snapInfo.data.g === 'suika' && snapInfo.data.s === 1286 && snapInfo.data.lv === 6 && snapInfo.bytes <= 2048, JSON.stringify(snapInfo.data) + ' ' + snapInfo.bytes + 'B');
ok('snapshot 能正确解码回分数/等级/猫名', snapInfo.dec && snapInfo.dec.score === 1286 && snapInfo.dec.label === '缅因塔' && snapInfo.dec.nick === '橘座大王', JSON.stringify(snapInfo.dec));
ok('拒绝别的游戏的 snapshot', snapInfo.badG === null);
ok('拒绝负数分数', snapInfo.badS === null);
ok('评论文案 ≤120 且带分数', snapInfo.comment.length <= 120 && snapInfo.comment.indexOf('1286') >= 0, snapInfo.comment);
ok('笔记标题 ≤20 / 正文 ≤1000', snapInfo.title.length <= 20 && snapInfo.content.length <= 1000, snapInfo.title.length + '/' + snapInfo.content.length);
ok('猫名生效', snapInfo.nick === '橘座大王');

// 被挑战：写 rival → 刷新 → 首页横幅
await page.evaluate(() => {
  localStorage.setItem('suika-rival', JSON.stringify({ v: 1, g: 'suika', s: 1500, lv: 5, d: '2026-10-26', n: '布偶糖主人', k: 'abc123' }));
});
await page.reload({ waitUntil: 'load' });
await page.waitForFunction('window.SUIKA_READY === true');
await sleep(300);
const rivalUi = await page.evaluate(() => ({
  shown: SUIKA.ui.rivalShown(),
  name: (document.getElementById('rival-name') || {}).textContent,
  score: (document.getElementById('rival-score') || {}).textContent,
  cat: (document.getElementById('rival-cat') || {}).textContent,
  level: SUIKA.rival() && SUIKA.rival().maxLevel,
}));
ok('从评论回场显示「被挑战」横幅', rivalUi.shown === true && rivalUi.name === '布偶糖主人' && rivalUi.score === '1500', JSON.stringify(rivalUi));
ok('横幅带挑战者的猫（布偶糖）', rivalUi.cat === '布偶糖' && rivalUi.level === 5, JSON.stringify(rivalUi));

// 结算对比：低 / 高 / 平
const cmp = await page.evaluate(async () => {
  const g = SUIKA.game;
  function finish(score) {
    SUIKA.start();
    g.score = score; g.maxLevel = 3; g.totalMerges = 9; g.maxCombo = 2;
    g.gameOver();
    for (let i = 0; i < 20; i++) g.update(0.05);   // headless 下 rAF 慢，手动推进结算动画
    return { text: SUIKA.ui.overCompare(), score: SUIKA.ui.overScore() };
  }
  const low = finish(1200);
  const high = finish(1800);
  const tie = finish(1500);
  return { low, high, tie };
});
ok('结算对比：低分 → 还差 300 分', cmp.low.text.indexOf('还差 300 分') >= 0, JSON.stringify(cmp.low));
ok('结算对比：高分 → 比挑战者高 300 分', cmp.high.text.indexOf('高 300 分') >= 0, JSON.stringify(cmp.high));
ok('结算对比：同分 → 平手', cmp.tie.text.indexOf('平手') >= 0, JSON.stringify(cmp.tie));

console.log('\n[12] 分享面板 / 文案');
const panel = await page.evaluate(() => {
  // 无容器环境：贴评论入口应禁用，但「查看文案」可用
  const btn = document.getElementById('btn-comment');
  SUIKA.setNick('橘座大王');
  return { disabled: !!(btn && btn.disabled), state: SUIKA.state };
});
ok('无容器环境禁用「贴到评论区」（不留死按钮）', panel.disabled, JSON.stringify(panel));

// 结算 → 生成战绩卡 → 查看文案
const cardInfo = await page.evaluate(async () => {
  const g = SUIKA.game;
  SUIKA.start();
  g.score = 888; g.maxLevel = 4; g.totalMerges = 12; g.maxCombo = 3;
  g.gameOver();
  for (let i = 0; i < 20; i++) g.update(0.05);
  document.getElementById('btn-share').click();
  await new Promise((r) => setTimeout(r, 150));
  document.getElementById('btn-copy').click();
  const cv = SUIKA.cardCanvas();
  return {
    card: [cv.width, cv.height],
    text: SUIKA.ui.shareText(),
    imgShown: !!(document.getElementById('share-img') || {}).src,
    cardSnap: SUIKA.challenge.encodeSnapshot(SUIKA.shareInfo()),
  };
});
ok('战绩卡 1080×1440 且预览可见', cardInfo.card[0] === 1080 && cardInfo.card[1] === 1440 && cardInfo.imgShown, JSON.stringify(cardInfo.card));
ok('「查看文案」展开可复制的正文', cardInfo.text.indexOf('888') >= 0 && cardInfo.text.indexOf('合成大猫咪') >= 0, cardInfo.text.slice(0, 60));
ok('分享用的 snapshot 也 ≤2KB', cardInfo.cardSnap.json.length <= 2048, String(cardInfo.cardSnap.json.length));

// 封面：只保留标题，删掉所有描述性文案（2026-10-27 按反馈调整）
const cover = await page.evaluate(() => {
  const proto = CanvasRenderingContext2D.prototype;
  const orig = proto.fillText;
  const texts = [];
  proto.fillText = function (t) { texts.push(String(t)); return orig.apply(this, arguments); };
  let cv;
  try { cv = window.CatShare.cover(); } finally { proto.fillText = orig; }
  const ctx = cv.getContext('2d');
  // 「一局 1 分钟」原来画在 y≈200 附近，这一横带应当干净
  const band = ctx.getImageData(0, 150, cv.width, 110).data;
  let ink = 0;
  for (let i = 0; i < band.length; i += 4) {
    if ((band[i] + band[i + 1] + band[i + 2]) / 3 < 200) ink++;
  }
  return { texts, ink, w: cv.width, h: cv.height };
});
ok('封面只保留标题文字（无描述 / 步骤说明）', cover.w === 1080 && cover.h === 1440 && cover.texts.join('') === '合成大猫咪', JSON.stringify(cover.texts));
ok('封面顶部原描述文字位置已清空', cover.ink < 50, String(cover.ink));

console.log('\n[13] 新界面布局（320 / 360 / 390）');
for (const vp of [{ w: 390, h: 844 }, { w: 375, h: 667 }, { w: 360, h: 640 }, { w: 320, h: 568 }, { w: 360, h: 520 }, { w: 320, h: 480 }]) {
  await page.setViewport({ width: vp.w, height: vp.h, deviceScaleFactor: 2 });
  await page.evaluate(() => { SUIKA.overlay('menu'); });
  await sleep(200);
  const lay = await page.evaluate(() => {
    const start = document.getElementById('btn-start').getBoundingClientRect();
    const gallery = document.getElementById('btn-gallery').getBoundingClientRect();
    const menu = document.getElementById('menu');
    const stats = document.querySelector('.menu-stats').getBoundingClientRect();
    const nick = document.querySelector('.nick-row').getBoundingClientRect();
    return {
      startBottom: Math.round(start.bottom),
      galleryBottom: Math.round(gallery.bottom),
      vh: innerHeight,
      overflowX: document.documentElement.scrollWidth > innerWidth + 1,
      menuOverflow: menu.scrollHeight > menu.clientHeight + 2,
      statsW: Math.round(stats.width),
      nickW: Math.round(nick.width),
    };
  });
  ok(vp.w + '×' + vp.h + ' 首页「开始」「图鉴」都在首屏、无溢出', lay.startBottom <= lay.vh && lay.galleryBottom <= lay.vh && !lay.overflowX && !lay.menuOverflow, JSON.stringify(lay));

  // 图鉴 2 列
  await page.evaluate(() => SUIKA.openGallery());
  await sleep(200);
  const gal = await page.evaluate(() => {
    const cells = [].slice.call(document.querySelectorAll('.gal-cell'));
    const rowTop = cells[0].getBoundingClientRect().top;
    const sameRow = cells.filter((c) => Math.abs(c.getBoundingClientRect().top - rowTop) < 2).length;
    const g = document.getElementById('gallery');
    return { sameRow, cellW: Math.round(cells[0].getBoundingClientRect().width), scrollable: g.scrollHeight > g.clientHeight, overflowX: document.documentElement.scrollWidth > innerWidth + 1 };
  });
  ok(vp.w + '×' + vp.h + ' 图鉴每行 2 列、可滚动、无横向溢出', gal.sameRow === 2 && !gal.overflowX && gal.cellW > 100, JSON.stringify(gal));
}

// 结算页在最小屏不溢出
await page.setViewport({ width: 320, height: 568, deviceScaleFactor: 2 });
await page.evaluate(async () => {
  const g = SUIKA.game;
  SUIKA.start();
  g.score = 666; g.maxLevel = 3; g.gameOver();
  for (let i = 0; i < 20; i++) g.update(0.05);
  await new Promise((r) => setTimeout(r, 120));
});
await sleep(200);
const overLay = await page.evaluate(() => {
  const over = document.getElementById('over');
  const again = document.getElementById('btn-again').getBoundingClientRect();
  const share = document.getElementById('btn-share').getBoundingClientRect();
  const home = document.getElementById('btn-home').getBoundingClientRect();
  return {
    overflow: over.scrollHeight > over.clientHeight + 2,
    againVisible: again.bottom <= innerHeight && again.top >= 0,
    rowVisible: Math.max(share.bottom, home.bottom) <= innerHeight,
    rowSameLine: Math.abs(share.top - home.top) < 2,
  };
});
ok('320×568 结算页不溢出、三按钮同排可见', !overLay.overflow && overLay.againVisible && overLay.rowVisible && overLay.rowSameLine, JSON.stringify(overLay));

console.log('\n结果: ' + pass + ' 通过, ' + fails.length + ' 失败');
if (fails.length) {
  console.log('失败项:');
  for (const f of fails) console.log(' - ' + f);
}
await browser.close();
process.exit(fails.length ? 1 : 0);
