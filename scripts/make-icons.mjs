#!/usr/bin/env node
/* 生成游戏图标（1024/512/192/180），用游戏自己的 CatArt 画，保证和游戏内形象一致。
 * 用法: node scripts/make-icons.mjs
 */
import { puppeteer, CHROME, ROOT_DIR } from '../tests/_puppeteer.mjs';
import fs from 'node:fs';
import path from 'node:path';

const OUT = path.join(ROOT_DIR, 'assets');
const SIZES = [['icon-1024.png', 1024], ['icon-512.png', 512], ['icon-192.png', 192], ['icon-180.png', 180]];

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true,
  args: ['--no-sandbox', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 800, height: 900, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
await page.goto('file://' + path.join(ROOT_DIR, 'index.html'), { waitUntil: 'load' });
await page.waitForFunction('window.SUIKA_READY === true');

const dataUrls = await page.evaluate((sizes) => {
  function drawIcon(size) {
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const ctx = c.getContext('2d');
    const k = size / 1024;

    // 背景：暖奶油渐变 + 顶部柔光
    const bg = ctx.createLinearGradient(0, 0, 0, size);
    bg.addColorStop(0, '#ffe9d4');
    bg.addColorStop(0.55, '#ffd9b6');
    bg.addColorStop(1, '#ffc79a');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, size, size);

    const glow = ctx.createRadialGradient(size * 0.5, size * 0.28, 0, size * 0.5, size * 0.3, size * 0.72);
    glow.addColorStop(0, 'rgba(255,255,255,0.85)');
    glow.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, size, size);

    // 底部投影盘
    ctx.save();
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = '#c9793f';
    ctx.beginPath();
    ctx.ellipse(size * 0.5, size * 0.845, size * 0.285, size * 0.052, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // 猫本体（等级 1 橘宝宝，识读性最好）
    window.CatArt.draw(ctx, {
      x: size * 0.5, y: size * 0.535, r: size * 0.345,
      level: 1, t: 0.6, angle: -0.05, blink: false,
    });
    return c.toDataURL('image/png');
  }
  const out = {};
  for (const [name, size] of sizes) out[name] = drawIcon(size);
  return out;
}, SIZES);

fs.mkdirSync(OUT, { recursive: true });
for (const [name] of SIZES) {
  const base64 = dataUrls[name].split(',')[1];
  const buf = Buffer.from(base64, 'base64');
  fs.writeFileSync(path.join(OUT, name), buf);
  console.log(name, (buf.length / 1024).toFixed(1) + ' KiB');
}
await browser.close();
