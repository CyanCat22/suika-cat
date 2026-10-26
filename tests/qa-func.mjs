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

console.log('\n结果: ' + pass + ' 通过, ' + fails.length + ' 失败');
if (fails.length) {
  console.log('失败项:');
  for (const f of fails) console.log(' - ' + f);
}
await browser.close();
process.exit(fails.length ? 1 : 0);
