/* 不同设备尺寸截图：手机 390×844 / 平板 820×1180 / 桌面 1440×900 */
import { puppeteer, CHROME, ROOT_DIR } from './_puppeteer.mjs';
import path from 'node:path';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sizes = [
  ['menu-phone-390', 390, 844, 3],
  ['menu-tablet-820', 820, 1180, 2],
  ['menu-desktop-1440', 1440, 900, 1],
];
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true,
  args: ['--no-sandbox', '--hide-scrollbars'], defaultViewport: { width: 390, height: 844 } });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
for (const [name, w, h, dsf] of sizes) {
  await page.setViewport({ width: w, height: h, deviceScaleFactor: dsf });
  await page.goto('file://' + path.join(ROOT_DIR, 'index.html'), { waitUntil: 'load' });
  await page.waitForFunction('window.SUIKA_READY === true');
  await sleep(600);
  const box = await page.evaluate(() => {
    const c = document.getElementById('game');
    const r = c.getBoundingClientRect();
    const menu = document.getElementById('menu').getBoundingClientRect();
    const btn = document.getElementById('btn-start').getBoundingClientRect();
    const chain = document.getElementById('menu-chain').getBoundingClientRect();
    return {
      canvas: [Math.round(r.width), Math.round(r.height)],
      ratio: +(r.width / r.height).toFixed(3),
      menu: [Math.round(menu.width), Math.round(menu.height)],
      btn: [Math.round(btn.left), Math.round(btn.top), Math.round(btn.right), Math.round(btn.bottom)],
      chain: [Math.round(chain.left), Math.round(chain.top), Math.round(chain.width), Math.round(chain.height)],
      vw: innerWidth, vh: innerHeight,
      overflowX: document.documentElement.scrollWidth > innerWidth,
      overflowY: document.documentElement.scrollHeight > innerHeight,
    };
  });
  console.log(name, JSON.stringify(box));
  await page.screenshot({ path: path.join(ROOT_DIR, 'shots', name + '.png') });
}
console.log(errors.length ? 'ERRORS: ' + errors.join(' | ') : 'no page errors');
await browser.close();
