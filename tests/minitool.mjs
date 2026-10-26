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

async function newPage(withContainer, opts) {
  opts = opts || {};
  const version = opts.version || 9462004;
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('requestfailed', (r) => errors.push('requestfailed: ' + r.url()));
  if (withContainer) {
    await page.evaluateOnNewDocument((cfg) => {
      window.__XHS = [];
      const calls = window.__XHS;
      const seeded = { 'suika-cat-best': JSON.stringify(777), 'suika-cat-muted': JSON.stringify(true) };
      if (cfg.coll) seeded['suika-coll'] = JSON.stringify(cfg.coll);
      if (cfg.nick) seeded['suika-nick'] = JSON.stringify(cfg.nick);
      const launch = { miniToolEnv: { buildVersion: cfg.version, userDataPath: '/tmp/xhs' } };
      if (cfg.snapshot) launch.miniToolSnapshotInfo = cfg.snapshot;
      const miniTool = {
        getLaunchOptions: () => Promise.resolve(launch),
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
      if (cfg.interaction) {
        miniTool.interactionOpenApi = (o) => {
          calls.push({ api: 'interactionOpenApi', payload: o.payload });
          return Promise.resolve({ errMsg: 'interactionOpenApi:ok' });
        };
      }
      window.xhs = { launchOptions: launch, miniTool };
    }, { version, coll: opts.coll || null, nick: opts.nick || null, snapshot: opts.snapshot || null, interaction: !!opts.interaction });
  }
  await page.goto('file://' + entry, { waitUntil: 'load' });
  await page.waitForFunction('window.SUIKA_READY === true', { timeout: 15000 });
  return { page, errors };
}

/* ---------- 容器内路径 ---------- */
console.log('\n[1] 容器内（注入 window.xhs 假容器）');
{
  const { page, errors } = await newPage(true, {
    version: 9462004,
    coll: { '2': { n: 3, f: '2026-10-20' } },
    nick: '旧猫名',
  });
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

  const collRestore = await page.evaluate(() => ({
    unlocked: window.SUIKA.collection.unlockedCount(),
    count: window.SUIKA.collection.countOf(2),
    first: window.SUIKA.collection.get(2).f,
    menu: window.SUIKA.ui.collCount(),
    commentDisabled: window.SUIKA.ui.commentDisabled(),
  }));
  ok('容器内从平台 Storage 恢复图鉴（1/10，2 级已合 3 次）', collRestore.unlocked === 1 && collRestore.count === 3 && collRestore.first === '2026-10-20', JSON.stringify(collRestore));
  ok('图鉴计数回填到首页', collRestore.menu === '1', JSON.stringify(collRestore));
  ok('9.46 客户端禁用「贴到评论区」', collRestore.commentDisabled, JSON.stringify(collRestore));

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
  const collStore = storeCalls.filter((c) => c.key === 'suika-coll');
  ok('图鉴新解锁写回平台 Storage', collStore.length > 0 && /"4"/.test(collStore[collStore.length - 1].data), JSON.stringify(collStore.slice(-1)));
  const nickRead = await page.evaluate(() => ({
    got: window.__XHS.filter((c) => c.api === 'getStorage' && c.key === 'suika-nick').length,
    label: window.SUIKA.nick(),
    input: document.getElementById('nick').value,
  }));
  ok('猫名从平台 Storage 回填（输入框 + 状态）', nickRead.got > 0 && nickRead.label === '旧猫名' && nickRead.input === '旧猫名', JSON.stringify(nickRead));
  ok('容器内无 JS 报错 / 无资源 404', errors.length === 0, errors.join(' | '));
  await page.close();
}

/* ---------- 9.50 + interactionOpenApi：评论区挑战赛 ---------- */
console.log('\n[3] 9.50 容器：从评论回场 + 贴评论');
{
  const { page, errors } = await newPage(true, {
    version: 9500000,
    interaction: true,
    snapshot: { v: 1, g: 'suika', s: 1500, lv: 5, d: '2026-10-26', n: '布偶糖主人', k: 'abc123' },
  });
  await sleep(500);
  const rivalUi = await page.evaluate(() => ({
    shown: window.SUIKA.ui.rivalShown(),
    name: (document.getElementById('rival-name') || {}).textContent,
    score: (document.getElementById('rival-score') || {}).textContent,
    cat: (document.getElementById('rival-cat') || {}).textContent,
    commentDisabled: window.SUIKA.ui.commentDisabled(),
  }));
  ok('从评论回场：首页显示「被挑战」横幅', rivalUi.shown && rivalUi.name === '布偶糖主人' && rivalUi.score === '1500', JSON.stringify(rivalUi));
  ok('横幅显示挑战者合到的猫（布偶糖）', rivalUi.cat === '布偶糖', JSON.stringify(rivalUi));
  ok('9.50 客户端启用「贴到评论区」', rivalUi.commentDisabled === false, JSON.stringify(rivalUi));

  const flow = await page.evaluate(async () => {
    const g = window.SUIKA.game;
    window.SUIKA.start();
    g.score = 1200; g.maxLevel = 4; g.maxCombo = 3; g.totalMerges = 11;
    g.gameOver();
    for (let i = 0; i < 60; i++) g.update(1 / 60);
    await new Promise((r) => setTimeout(r, 200));
    const compare = window.SUIKA.ui.overCompare();
    document.getElementById('btn-share').click();
    await new Promise((r) => setTimeout(r, 250));
    document.getElementById('btn-comment').click();
    await new Promise((r) => setTimeout(r, 600));
    return {
      compare,
      calls: window.__XHS.map((c) => c.api),
      comment: window.__XHS.filter((c) => c.api === 'interactionOpenApi')[0],
      stored: window.__XHS.filter((c) => c.api === 'setStorage' && c.key === 'suika-challenge'),
      tip: document.getElementById('save-tip').textContent,
    };
  });
  ok('结算页显示与挑战者的分数差', /还差 300 分/.test(flow.compare), flow.compare);
  const payload = flow.comment && flow.comment.payload;
  ok('「贴到评论区」调用 interactionOpenApi(post_comment)', !!payload && payload.action === 'post_comment', JSON.stringify(payload && payload.action));
  ok('评论内容 ≤120 字且带分数', !!payload && payload.content.length <= 120 && payload.content.indexOf('1200') >= 0, payload && payload.content);
  const bean = payload && payload.media_bean && payload.media_bean[0];
  ok('评论带战绩卡图片（media_bean）', !!bean && bean.media_type === 'image' && /^(data:image\/png;base64,|xhs-temp:)/.test(bean.cover_image_url), JSON.stringify(bean && bean.media_type));
  const rawSnap = payload && payload.miniToolSnapshotInfo;
  let snapObj = null;
  try { snapObj = typeof rawSnap === 'string' ? JSON.parse(rawSnap) : rawSnap; } catch (e) {}
  ok('评论携带 snapshot（≤2KB，分数一致）', !!snapObj && JSON.stringify(snapObj).length <= 2048 && snapObj.s === 1200 && snapObj.g === 'suika', JSON.stringify(snapObj));
  ok('贴评论前先把 challenge 落盘', flow.stored.length > 0, JSON.stringify(flow.stored.length));
  ok('评论后给出可见反馈', /评论区|发送|失败/.test(flow.tip), flow.tip);
  ok('9.50 容器路径无 JS 报错', errors.length === 0, errors.join(' | '));
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
  ok('无容器路径无 JS 报错 / 无资源 404', errors.length === 0, errors.join(' | '));
  await page.close();
}

await browser.close();
fs.rmSync(tmpDir, { recursive: true, force: true });

console.log(`\n结果: ${pass} 通过, ${fails.length} 失败`);
if (fails.length) {
  for (const f of fails) console.log(' - ' + f);
  process.exit(1);
}
