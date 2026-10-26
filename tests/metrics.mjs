/* 体检数据：物理稳定性 / 帧率 / 合成延迟，用于 QA 报告
 * 用法: node tests/metrics.mjs
 */
import { puppeteer, CHROME, ROOT_DIR } from './_puppeteer.mjs';
import path from 'node:path';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true,
  args: ['--no-sandbox', '--hide-scrollbars', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 720, height: 1280, deviceScaleFactor: 1 } });
const page = await browser.newPage();
await page.goto('file://' + path.join(ROOT_DIR, 'index.html'), { waitUntil: 'load' });
await page.waitForFunction('window.SUIKA_READY === true');
await page.evaluate(() => window.SUIKA.start());
await sleep(300);

const m = await page.evaluate(async () => {
  const g = window.SUIKA.game, P = window.CatPhysics, cfg = window.CATCFG;
  const out = {};
  // 1) 堆叠稳定性
  g.bodies = [];
  for (let i = 0; i < 40; i++) {
    const b = P.makeBody((i * 3) % 6, 90 + ((i * 97) % 540), 300 + ((i * 61) % 700));
    b.born = 99; g.bodies.push(b);
  }
  const t0 = performance.now();
  for (let i = 0; i < 480; i++) g.update(1 / 60);   // 8 秒
  const t1 = performance.now();
  let maxOverlap = 0, maxSpeed = 0, outBound = 0;
  for (let i = 0; i < g.bodies.length; i++) {
    const a = g.bodies[i];
    maxSpeed = Math.max(maxSpeed, Math.hypot(a.vx, a.vy));
    if (a.x - a.r < cfg.WALL - 2 || a.x + a.r > cfg.W - cfg.WALL + 2) outBound++;
    for (let j = i + 1; j < g.bodies.length; j++) {
      const b = g.bodies[j];
      maxOverlap = Math.max(maxOverlap, a.r + b.r - Math.hypot(a.x - b.x, a.y - b.y));
    }
  }
  out.stack = {
    bodies: g.bodies.length, maxOverlap: +maxOverlap.toFixed(2), maxSpeed: +maxSpeed.toFixed(1),
    outBound, simMs: +((t1 - t0) / 480).toFixed(3),
  };
  // 2) 合成延迟：两只猫相向而行，看多少帧合上
  g.bodies = [];
  const a = P.makeBody(2, 300, 900); a.born = 99; a.vx = 120;
  const b = P.makeBody(2, 400, 900); b.born = 99; b.vx = -120;
  g.bodies.push(a, b);
  let frames = 0;
  while (frames < 120) { g.update(1 / 60); frames++; if (g.bodies.length === 1) break; }
  out.mergeLatencyFrames = frames;
  // 3) 单帧耗时（headless 下 rAF 会被节流，直接测 update+render 的 CPU 耗时）
  g.bodies = [];
  for (let i = 0; i < 40; i++) {
    const bb = P.makeBody(i % 7, 90 + ((i * 97) % 540), 400 + ((i * 61) % 700));
    bb.born = 99; g.bodies.push(bb);
  }
  for (let i = 0; i < 60; i++) g.update(1 / 60);
  const tf = performance.now();
  for (let i = 0; i < 120; i++) { g.update(1 / 60); g.render(); }
  out.frameMs = +((performance.now() - tf) / 120).toFixed(2);
  out.bodies = g.bodies.length;
  return out;
});
console.log(JSON.stringify(m, null, 2));
await browser.close();
