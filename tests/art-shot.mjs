import { puppeteer, CHROME, ROOT_DIR } from './_puppeteer.mjs';
import path from 'node:path';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true,
  args: ['--no-sandbox', '--hide-scrollbars'], defaultViewport: { width: 900, height: 900, deviceScaleFactor: 1 } });
const page = await browser.newPage();
const errs = [];
page.on('pageerror', e => errs.push(e.message));
await page.goto('file://' + path.join(ROOT_DIR, 'tests/art-gallery.html'), { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__ART_READY === true');
await sleep(300);
await page.screenshot({ path: path.join(ROOT_DIR, 'shots/_art-gallery.png') });
console.log('errors:', errs.length ? errs : 'none');
await browser.close();
