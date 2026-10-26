/* 小工具包验收：解压真实 zip → 在浏览器里跑，注入 window.xhs 假容器验证端能力调用
 * 用法: node tests/minitool.mjs
 */
import { puppeteer, CHROME, ROOT_DIR } from './_puppeteer.mjs';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ZIP = path.join(ROOT_DIR, 'suika-cat-minitool.zip');
let pass = 0;
const fails = [];
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fails.push(name + (extra ? '  → ' + extra : '')); console.log('  ✗ ' + name + (extra ? '  → ' + extra : '')); }
};

if (!fs.existsSync(ZIP)) {
  console.error('先运行 node scripts/build-minitool.mjs 生成 zip');
  process.exit(2);
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minitool-'));
execFileSync('unzip', ['-o', '-q', ZIP, '-d', tmpDir]);
const entry = path.join(tmpDir, 'index.html');
const files = fs.readdirSync(tmpDir);
function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}
const allFiles = walk(tmpDir).map((f) => path.relative(tmpDir, f).split(path.sep).join('/'));
console.log('[0] zip 结构');
ok('解压后根目录直接是 index.html（未多套一层）', fs.existsSync(entry) && files.includes('index.html'), files.join(','));
ok('zip 内只有允许的文件类型', !allFiles.some((f) => !/\.(html|css|js|png|jpe?g|gif|webp|svg|woff2?|json)$/i.test(f)), allFiles.join(','));
ok('zip 内无开发垃圾文件', !allFiles.some((f) => /node_modules|\.map$|\.DS_Store|vite\.config|webpack\.config/.test(f)), allFiles.join(','));
ok('index.html 在 zip 根目录（无多余层级）', allFiles.includes('index.html'), allFiles.slice(0, 4).join(','));

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true,
  args: ['--no-sandbox', '--hide-scrollbars', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 390, height: 844, deviceScaleFactor: 2 },
});

async function newPage(withContainer) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  if (withContainer) {
    await page.evaluateOnNewDocument(() => {
      window.__XHS = [];
      const calls = window.__XHS;
      const seeded = { 'suika-cat-best': JSON.stringify(777), 'suika-cat-muted': JSON.stringify(true) };
      const miniTool = {
        getLaunchOptions: () => Promise.resolve({ miniToolEnv: { buildVersion: 9462004, userDataPath: '/tmp/xhs' } }),
        setStorage: (o) => { calls.push({ api: 'setStorage', key: o.key, data: o.data }); return Promise.resolve({ errMsg: 'setStorage:ok' }); },
        getStorage: (o) => {
          calls.push({ api: 'getStorage', key: o.key });
          if (seeded[o.key] === undefined) return Promise.reject({ errMsg: 'getStorage:fail not found' });
          return Promise.resolve({ data: seeded[o.key], errMsg: 'getStorage:ok' });
        },
        writeTempFile: (o) => { calls.push({ api: 'writeTempFile', bytes: o.data.length }); return Promise.resolve({ filePath: 'xhs-temp://card.png' }); },
        saveImageToPhotosAlbum: (o) => { calls.push({ api: 'saveImageToPhotosAlbum', filePath: o.filePath }); return Promise.resolve({ errMsg: 'saveImageToPhotosAlbum:ok' }); },
        postNote: (o) => { calls.push({ api: 'postNote', title: o.title, content: o.content, media: o.mediaInfo }); return Promise.resolve({ errMsg: 'postNote:ok' }); },
        vibrateShort: () => Promise.resolve({ errMsg: 'vibrateShort:ok' }),
      };
      window.xhs = { launchOptions: { miniToolEnv: { buildVersion: 9462004, userDataPath: '/tmp/xhs' } }, miniTool };
    });
  }
  await page.goto('file://' + entry, { waitUntil: 'load' });
  await page.waitForFunction('window.SUIKA_READY === true', { timeout: 15000 });
  return { page, errors };
}

/* ---------- 容器内路径 ---------- */
console.log('\n[1] 容器内（注入 window.xhs 假容器）');
{
  const { page, errors } = await newPage(true);
  await sleep(400);
  const boot = await page.evaluate(() => ({
    platform: !!window.CatPlatform,
    inContainer: window.CatPlatform.inContainer(),
    canSave: window.CatPlatform.canSave(),
    canPost: window.CatPlatform.canPost(),
    best: window.SUIKA.game.best,
    muted: window.CatAudio.muted,
  }));
  ok('识别到容器并暴露端能力', boot.inContainer && boot.canSave && boot.canPost, JSON.stringify(boot));
  ok('启动时从平台缓存恢复最高分（777）', boot.best === 777, String(boot.best));
  ok('启动时从平台缓存恢复静音状态', boot.muted === true, String(boot.muted));

  await page.evaluate(() => window.SUIKA.start());
  await sleep(300);
  await page.evaluate(() => {
    const g = window.SUIKA.game;
    g.dropCd = 0; window.SUIKA.dropAt(160);
    g.dropCd = 0; window.SUIKA.forceDrop(3, 300);
    g.dropCd = 0; window.SUIKA.forceDrop(3, 330);
    for (let i = 0; i < 120; i++) g.update(1 / 60);
  });
  const play = await page.evaluate(() => ({ state: window.SUIKA.state, bodies: window.SUIKA.game.bodies.length, merges: window.SUIKA.game.totalMerges }));
  ok('容器内游戏可正常运行（投放 + 合成）', play.merges >= 1 && play.state === 'playing', JSON.stringify(play));

  await page.evaluate(() => {
    const g = window.SUIKA.game;
    g.score = 1286; g.maxLevel = 7; g.maxCombo = 4; g.totalMerges = 23;
    g.gameOver();
    for (let i = 0; i < 60; i++) g.update(1 / 60);
  });
  await sleep(200);
  const over = await page.evaluate(() => ({
    shown: document.getElementById('over').classList.contains('show'),
    score: document.getElementById('over-score').textContent,
  }));
  ok('结算页在容器内正常弹出', over.shown && over.score === '1286', JSON.stringify(over));

  await page.evaluate(() => document.getElementById('btn-share').click());
  await sleep(300);
  const share = await page.evaluate(() => ({
    shown: document.getElementById('share').classList.contains('show'),
    postHidden: document.getElementById('btn-post').hidden,
    imgLen: (document.getElementById('share-img').src || '').length,
  }));
  ok('生成战绩卡并在预览里显示', share.shown && share.imgLen > 10000, JSON.stringify(share));
  ok('容器内显示「发笔记」按钮', share.postHidden === false, JSON.stringify(share));

  await page.evaluate(() => document.getElementById('btn-save').click());
  await sleep(400);
  const saveCalls = await page.evaluate(() => window.__XHS.filter((c) => c.api === 'writeTempFile' || c.api === 'saveImageToPhotosAlbum'));
  const saveTip = await page.evaluate(() => document.getElementById('save-tip').textContent);
  ok('保存走 writeTempFile → saveImageToPhotosAlbum', saveCalls.length === 2 && saveCalls[1].filePath === 'xhs-temp://card.png', JSON.stringify(saveCalls));
  ok('保存后提示「已保存到相册」', /相册/.test(saveTip), saveTip);

  await page.evaluate(() => document.getElementById('btn-post').click());
  await sleep(400);
  const note = await page.evaluate(() => window.__XHS.filter((c) => c.api === 'postNote')[0]);
  ok('点击「发笔记」调用 postNote 并带图片', !!note && note.media && note.media.image_resources[0].url === 'xhs-temp://card.png', JSON.stringify(note));
  ok('postNote 标题 ≤ 20 字', !!note && typeof note.title === 'string' && note.title.length <= 20, note && note.title);
  ok('postNote 正文 ≤ 1000 字', !!note && typeof note.content === 'string' && note.content.length <= 1000, note && String(note.content).length);

  const storeCalls = await page.evaluate(() => window.__XHS.filter((c) => c.api === 'setStorage'));
  ok('最高分写入平台 Storage', storeCalls.some((c) => c.key === 'suika-cat-best' && c.data === '1286'), JSON.stringify(storeCalls));
  ok('容器内无 JS 报错', errors.length === 0, errors.join(' | '));
  await page.close();
}

/* ---------- 普通浏览器路径 ---------- */
console.log('\n[2] 无容器（普通浏览器打开同一份包）');
{
  const { page, errors } = await newPage(false);
  await sleep(300);
  const browserState = await page.evaluate(() => ({
    inContainer: window.CatPlatform.inContainer(),
    canSave: window.CatPlatform.canSave(),
    postHidden: document.getElementById('btn-post').hidden,
  }));
  ok('检测不到容器，回退 Web 方案', browserState.inContainer === false && browserState.canSave === false, JSON.stringify(browserState));
  ok('无容器时隐藏「发笔记」按钮', browserState.postHidden === true, JSON.stringify(browserState));

  await page.evaluate(() => {
    window.SUIKA.start();
    const g = window.SUIKA.game;
    g.score = 66; g.maxLevel = 2; g.gameOver();
    for (let i = 0; i < 60; i++) g.update(1 / 60);
  });
  await sleep(250);
  await page.evaluate(() => document.getElementById('btn-share').click());
  await sleep(250);
  await page.evaluate(() => document.getElementById('btn-save').click());
  await sleep(250);
  const tip = await page.evaluate(() => ({
    text: document.getElementById('save-tip').textContent,
    shown: document.getElementById('save-tip').classList.contains('show'),
  }));
  ok('无容器保存给出「长按 / 右键」提示', /长按|右键/.test(tip.text) && tip.shown, JSON.stringify(tip));
  ok('无容器路径无 JS 报错', errors.length === 0, errors.join(' | '));
  await page.close();
}

await browser.close();
fs.rmSync(tmpDir, { recursive: true, force: true });

console.log(`\n结果: ${pass} 通过, ${fails.length} 失败`);
if (fails.length) {
  for (const f of fails) console.log(' - ' + f);
  process.exit(1);
}
