#!/usr/bin/env node
/**
 * 打包「小红书小工具」zip：把游戏产物整理到 minitool/ 并做容器规范静态校验，最后压缩。
 * 用法: node scripts/build-minitool.mjs [--no-zip]
 * 产物: minitool/（目录） + suika-cat-minitool.zip（zip 根目录直接是 index.html）
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'minitool');
const ZIP = path.join(ROOT, 'suika-cat-minitool.zip');
const SKILL_AUDIT = path.resolve(ROOT, '../.skill/minitool-zip-builder/scripts/audit_artifact.mjs');

const ALLOWED_EXT = new Set(['.html', '.css', '.js', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.woff', '.woff2', '.json']);
const FILES = ['index.html', 'style.css', 'assets/icon-180.png', 'assets/icon-192.png', 'js/config.js', 'js/physics.js', 'js/art.js', 'js/audio.js', 'js/compat.js', 'js/xhs.js', 'js/game.js', 'js/sharecard.js', 'js/main.js'];

const problems = [];
const warns = [];
const fail = (msg) => problems.push(msg);

function copyFiles() {
  fs.rmSync(OUT, { recursive: true, force: true });
  for (const rel of FILES) {
    const src = path.join(ROOT, rel);
    if (!fs.existsSync(src)) { fail(`缺少源文件: ${rel}`); continue; }
    const dst = path.join(OUT, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
  }
}

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

function checkStructure() {
  if (!fs.existsSync(path.join(OUT, 'index.html'))) fail('zip 根目录缺少 index.html');
  for (const f of walk(OUT)) {
    const rel = path.relative(OUT, f).split(path.sep).join('/');
    const ext = path.extname(f).toLowerCase();
    if (!ALLOWED_EXT.has(ext)) fail(`不支持的文件类型: ${rel}`);
    if (/\.map$/.test(rel)) fail(`不应包含 source map: ${rel}`);
    if (/(^|\/)node_modules\//.test(rel) || rel.startsWith('.git/')) fail(`不应包含开发目录: ${rel}`);
    if (path.basename(rel) === '.DS_Store') fail(`不应包含 .DS_Store: ${rel}`);
  }
}

function checkHtml() {
  const html = fs.readFileSync(path.join(OUT, 'index.html'), 'utf8');
  if (!/^<!DOCTYPE html>/i.test(html.trim())) fail('index.html 缺少 <!DOCTYPE html>');
  if (!/lang="zh-CN"/.test(html)) fail('index.html 缺少 lang="zh-CN"');
  if (!/<meta charset="UTF-8">/i.test(html)) fail('index.html 缺少 charset=UTF-8');
  const vp = html.match(/<meta name="viewport" content="([^"]*)"/i);
  if (!vp) fail('index.html 缺少 viewport');
  else {
    for (const need of ['width=device-width', 'initial-scale=1.0', 'viewport-fit=cover']) {
      if (!vp[1].includes(need)) fail(`viewport 缺少 ${need}`);
    }
  }
  // 内联脚本：允许外链 <script src>，不允许脚本内容
  const scripts = html.match(/<script\b[^>]*>([\s\S]*?)<\/script>/gi) || [];
  for (const tag of scripts) {
    const inner = tag.replace(/<script\b[^>]*>/i, '').replace(/<\/script>/i, '').trim();
    if (inner) fail('存在内联 <script>，容器 CSP 会拦截');
    if (/type="module"/i.test(tag)) fail('存在 type="module" 脚本，容器只支持经典脚本');
  }
  if (/\son[a-z]+\s*=/i.test(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ''))) fail('存在行内事件处理器（onclick= 等）');
  if (/javascript:/i.test(html)) fail('存在 javascript: URI');
  if (/<base\b/i.test(html)) fail('存在 <base>，会破坏真机路径');
  if (/<iframe\b|<object\b|<embed\b/i.test(html)) fail('存在 iframe / object / embed');
  if (/http-equiv="Content-Security-Policy"/i.test(html)) fail('不应自建 CSP');
  // 外部资源：允许 data: 图片，禁止任何 http(s) 引用
  const refs = html.match(/(?:src|href)="([^"]+)"/gi) || [];
  for (const r of refs) {
    const url = r.replace(/^(?:src|href)="/i, '').replace(/"$/, '');
    if (/^https?:\/\//i.test(url)) fail(`引用了外部资源: ${url}`);
    if (/^\/\//.test(url)) fail(`使用了协议相对路径: ${url}`);
    if (url.startsWith('/')) fail(`使用了绝对路径: ${url}`);
    // 引用的包内资源必须真实存在（不含 data: 与锚点）
    if (!/^data:/i.test(url) && !url.startsWith('#')) {
      const target = path.join(OUT, url.replace(/^\.\//, ''));
      if (!fs.existsSync(target)) fail(`引用的资源不在包内: ${url}`);
    }
  }
}

function checkJs() {
  const banned = [
    [/\bfetch\s*\(/, 'fetch()'],
    [/XMLHttpRequest/, 'XMLHttpRequest'],
    [/new WebSocket|WebSocket\(/, 'WebSocket'],
    [/EventSource/, 'EventSource'],
    [/RTCPeerConnection/, 'RTCPeerConnection'],
    [/\bnew Worker\b|SharedWorker|serviceWorker/, 'Worker / ServiceWorker'],
    [/navigator\.geolocation/, 'navigator.geolocation'],
    [/navigator\.clipboard|execCommand\(['"]copy/, '剪贴板'],
    [/requestFullscreen/, 'requestFullscreen'],
    [/window\.open\s*\(/, 'window.open'],
    [/window\.prompt\s*\(/, 'window.prompt'],
    [/\beval\s*\(/, 'eval()'],
    [/new Function\s*\(/, 'new Function()'],
    [/WebAssembly/, 'WebAssembly'],
    [/\.download\s*=/, 'a[download] 下载'],
    [/navigator\.vibrate/, 'navigator.vibrate（应改用平台 vibrateShort）'],
    [/indexedDB/, 'IndexedDB'],
    [/caches\.(open|match)/, 'Cache API'],
  ];
  // ES2018+ 语法（Chrome 61 解析不了）
  const modern = [
    [/\?\.(?!\d)/, '可选链 ?.'],
    [/\?\?/, '空值合并 ??'],
    [/\|\|=|&&=|\?\?=/, '逻辑赋值'],
    [/Object\.fromEntries/, 'Object.fromEntries'],
    [/Object\.hasOwn/, 'Object.hasOwn'],
    [/replaceAll\(/, 'String.replaceAll'],
    [/\.at\(\s*-?\d+\s*\)/, 'Array.at'],
    [/\.flat(M|Map)?\s*\(/, 'Array.flat/flatMap'],
    [/structuredClone/, 'structuredClone'],
    [/globalThis/, 'globalThis'],
    [/allSettled/, 'Promise.allSettled'],
    [/catch\s*\{/, '可选 catch 绑定'],
    [/\bimport\s*\(|\bimport\s+[\w{*]|\bexport\s+(const|function|default|class|\{)/, 'ES Module 语法'],
    [/\bclass\s+\w+[^{]*\{[^}]*#\w/, 'class 私有字段'],
  ];
  for (const f of walk(OUT).filter((p) => p.endsWith('.js'))) {
    const rel = path.relative(OUT, f).split(path.sep).join('/');
    const src = fs.readFileSync(f, 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/[^\n]*/g, '$1');
    for (const [re, name] of banned) if (re.test(code)) fail(`${rel} 使用了禁用能力: ${name}`);
    for (const [re, name] of modern) if (re.test(code)) fail(`${rel} 使用了 Chrome 61 不支持的语法: ${name}`);
  }
}

function checkCss() {
  const css = fs.readFileSync(path.join(OUT, 'style.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  // @supports 块内的现代写法允许
  const blocks = [];
  const walkBlocks = (text, inSupports) => {
    let depth = 0, start = 0, header = '';
    for (let i = 0; i < text.length; i++) {
      if (text[i] === '{') {
        depth++;
        if (depth === 1) header = text.slice(start, i).trim();
      } else if (text[i] === '}') {
        depth--;
        if (depth === 0) {
          const body = text.slice(text.indexOf('{', start + header.length) + 1, i);
          const isSupports = /^@supports/.test(header);
          if (/^@media/.test(header) || isSupports) {
            // 媒体查询内部继续按规则拆
            walkBlocks(body, inSupports || isSupports);
          } else {
            blocks.push({ header, body, inSupports });
          }
          start = i + 1;
        }
      }
    }
  };
  walkBlocks(css, false);

  for (const blk of blocks) {
    const props = [];
    for (const line of blk.body.split(';')) {
      const m = line.match(/([a-z-]+)\s*:\s*([\s\S]+)/i);
      if (m) props.push([m[1].trim(), m[2].trim()]);
    }
    const seen = new Set();
    for (const [prop, value] of props) {
      const modern = /clamp\(|max\(|min\(/.test(value);
      if (modern && !seen.has(prop)) fail(`style.css [${blk.header}] ${prop}: ${value} 缺少旧值兜底（Chrome 61 会整条丢弃）`);
      seen.add(prop);
      if (/^inset$/.test(prop)) fail(`style.css [${blk.header}] 使用了 inset 简写`);
      if (/^aspect-ratio$/.test(prop)) fail(`style.css [${blk.header}] 使用了 aspect-ratio 且无回退`);
      if (/^(gap|row-gap|column-gap)$/.test(prop) && !/supports-flex-gap/.test(blk.header) && !blk.inSupports) {
        fail(`style.css [${blk.header}] Flex 间距依赖 ${prop}，Chrome 61 不支持`);
      }
      if (/backdrop-filter/.test(prop) && !blk.inSupports) fail(`style.css [${blk.header}] backdrop-filter 必须在 @supports 内`);
    }
  }
  // 安全区写法
  if (/env\(safe-area-inset/.test(css) && !/var\(--safe-area-inset-[a-z]+,\s*env\(/.test(css)) {
    fail('style.css 安全区未使用 var(--safe-area-inset-*, env(...)) 组合');
  }
}

function checkDataUri() {
  for (const f of walk(OUT)) {
    if (!/\.(html|css|js)$/.test(f)) continue;
    const src = fs.readFileSync(f, 'utf8');
    const matches = src.match(/data:[a-z/+.-]+;base64,[A-Za-z0-9+/=]+/gi) || [];
    for (const m of matches) {
      const bytes = Math.floor((m.length - m.indexOf('base64,') - 7) * 3 / 4);
      if (bytes > 100 * 1024) fail(`${path.relative(OUT, f)} 内联 base64 约 ${(bytes / 1024).toFixed(0)}KiB，应改为包内文件`);
    }
  }
}

function runAudit(target) {
  if (!fs.existsSync(SKILL_AUDIT)) {
    warns.push('未找到小工具官方审计脚本，已用内置校验替代');
    return;
  }
  try {
    const out = execFileSync(process.execPath, [SKILL_AUDIT, target], { encoding: 'utf8' });
    for (const line of out.trim().split('\n')) {
      if (line.startsWith('ERROR')) fail(`[audit] ${line}`);
      else if (line.startsWith('WARN')) warns.push(`[audit] ${line}`);
      else console.log('  ' + line);
    }
  } catch (err) {
    const out = (err.stdout || '') + (err.stderr || '');
    fail(`[audit] 审计失败: ${out.trim() || err.message}`);
  }
}

function makeZip() {
  fs.rmSync(ZIP, { force: true });
  execFileSync('zip', ['-X', '-r', '-q', ZIP, '.', '-x', '*.DS_Store'], { cwd: OUT });
}

copyFiles();
checkStructure();
checkHtml();
checkJs();
checkCss();
checkDataUri();
runAudit(OUT);

if (!process.argv.includes('--no-zip')) {
  makeZip();
  runAudit(ZIP);
}

const kb = (p) => (fs.statSync(p).size / 1024).toFixed(1) + ' KiB';
console.log('\n产物:');
console.log('  目录:', path.relative(ROOT, OUT) + '/');
for (const f of walk(OUT)) console.log('   ', path.relative(OUT, f), kb(f));
if (!process.argv.includes('--no-zip')) console.log('  zip :', path.relative(ROOT, ZIP), kb(ZIP));

if (warns.length) {
  console.log('\n提醒:');
  for (const w of warns) console.log('  - ' + w);
}
if (problems.length) {
  console.log(`\n✗ 校验失败：${problems.length} 个问题`);
  for (const p of problems) console.log('  - ' + p);
  process.exit(1);
}
console.log('\n✓ 校验通过：结构 / 入口 / 禁用能力 / Chrome 61 语法与 CSS / 包体');
