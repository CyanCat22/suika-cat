/* 生成交付截图（720×1280 竖屏）与小红书分享图（1080×1440）
 * 用法: node tests/shots.mjs
 */
import { puppeteer, CHROME, ROOT_DIR } from './_puppeteer.mjs';
import path from 'node:path';
import fs from 'node:fs';

const SHOTS = path.join(ROOT_DIR, 'shots');
if (!fs.existsSync(SHOTS)) fs.mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader', '--hide-scrollbars',
         '--autoplay-policy=no-user-gesture-required', '--force-device-scale-factor=1'],
  defaultViewport: { width: 720, height: 1280, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
await page.goto('file://' + path.join(ROOT_DIR, 'index.html'), { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.SUIKA_READY === true');
await sleep(900);

const shot = async (name) => {
  const file = path.join(SHOTS, name + '.png');
  await page.screenshot({ path: file });
  console.log('  ·', name + '.png');
  return file;
};

// 1. 首页
await shot('menu');

// 2. 开局 + 飞猫
await page.evaluate(() => window.SUIKA.start());
await sleep(700);
await shot('play-start');

// 3. 中局：塞满一批猫，等待落定与合成
await page.evaluate(() => {
  const g = window.SUIKA.game;
  const levels = [0, 1, 2, 3, 4, 5, 6];
  for (let i = 0; i < 24; i++) {
    const b = window.CatPhysics.makeBody(levels[i % levels.length], 120 + ((i * 73) % 480), 380 + ((i * 47) % 700));
    b.born = 99;
    g.bodies.push(b);
  }
});
await sleep(2600);
await page.evaluate(() => { window.SUIKA.game.dropCd = 0; window.SUIKA.dropAt(360); });
await sleep(900);
await shot('play-mid');

// 4. 合成瞬间（大猫 + 粒子）
await page.evaluate(() => {
  const g = window.SUIKA.game;
  const P = window.CatPhysics;
  g.bodies = [];
  const a = P.makeBody(6, 300, 900); a.born = 99;
  const b = P.makeBody(6, 300, 1050); b.born = 99;
  g.bodies.push(a, b);
  g.dropCd = 0;
});
await sleep(1400);
await shot('play-merge');

// 5. 危险线
await page.evaluate(() => {
  const g = window.SUIKA.game;
  const P = window.CatPhysics;
  g.bodies = [];
  const cfg = window.CATCFG;
  // 从底部堆一摞，最高一只压到警戒线附近
  let y = cfg.FLOOR - 60;
  for (let i = 0; i < 12; i++) {
    const lv = i % 4;
    const r = cfg.LEVELS[lv].r;
    const b = P.makeBody(lv, 250 + (i % 3) * 44, y - r);
    b.born = 99;
    g.bodies.push(b);
    y -= r * 2 + 4;
  }
  const top = P.makeBody(2, 300, cfg.DANGER_Y + 6);
  top.born = 99; top.vy = 0;
  g.bodies.push(top);
});
await sleep(1200);
await shot('play-danger');

// 6. 结算
await page.evaluate(() => {
  const g = window.SUIKA.game;
  g.score = 1286;
  g.maxLevel = 7;
  g.totalMerges = 46;
  g.maxCombo = 6;
  g.gameOver();
});
await page.evaluate(() => { const g = window.SUIKA.game; for (let i = 0; i < 60; i++) g.update(1 / 60); });
await sleep(500);
await shot('over');

// 7. 战绩卡
const cardDataUrl = await page.evaluate(() => window.CatShare.card({
  score: 1286, best: 1286, isRecord: true, maxLevel: 7, totalMerges: 46, maxCombo: 6,
}).toDataURL('image/png'));
fs.writeFileSync(path.join(SHOTS, 'xhs-card.png'), Buffer.from(cardDataUrl.split(',')[1], 'base64'));
console.log('  · xhs-card.png (1080×1440)');

// 8. 封面图
const coverDataUrl = await page.evaluate(() => window.CatShare.cover().toDataURL('image/png'));
fs.writeFileSync(path.join(SHOTS, 'xhs-cover.png'), Buffer.from(coverDataUrl.split(',')[1], 'base64'));
console.log('  · xhs-cover.png (1080×1440)');

// 9. 战绩卡弹层
await page.evaluate(() => { window.SUIKA.overlay('share'); });
await page.evaluate(() => {
  const img = document.getElementById('share-img');
  img.src = window.CatShare.card({ score: 1286, best: 1286, isRecord: true, maxLevel: 7, totalMerges: 46, maxCombo: 6 }).toDataURL('image/png');
});
await sleep(400);
await shot('share-overlay');

console.log(errors.length ? '页面错误:\n' + errors.join('\n') : '无页面错误');
await browser.close();
