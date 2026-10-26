/* 测试公共入口：定位 puppeteer-core 与 Chrome。
 * PUPPETEER_PATH 可指向 puppeteer-core 包目录；CHROME_PATH 可覆盖浏览器路径。
 */
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const candidates = [];
if (process.env.PUPPETEER_PATH) {
  candidates.push(process.env.PUPPETEER_PATH);
  candidates.push(path.join(process.env.PUPPETEER_PATH, 'lib/esm/puppeteer/puppeteer-core.js'));
}
candidates.push('puppeteer-core');
for (const rel of ['node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js',
                   '../plants-vs-zombies/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js']) {
  const p = path.join(ROOT, rel);
  if (existsSync(p)) candidates.push(p);
}

let mod = null;
let lastErr = null;
for (const spec of candidates) {
  try { mod = await import(spec); break; } catch (err) { lastErr = err; }
}
if (!mod) throw new Error('找不到 puppeteer-core：请 npm install 或设置 PUPPETEER_PATH。' + (lastErr && lastErr.message));

export const puppeteer = mod.default || mod;
export const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
export const ROOT_DIR = ROOT;
