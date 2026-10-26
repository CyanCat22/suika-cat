#!/usr/bin/env node
/**
 * 合成大猫咪 · 本地静态服务器（可选）
 * 游戏本身是纯静态页面，双击 index.html 就能玩；想用 http:// 或手机同局域网访问时运行：
 *   node server.mjs            # http://127.0.0.1:5182
 *   node server.mjs --host 0.0.0.0   # 让同一 Wi-Fi 下的手机访问
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const port = Number(argOf('--port', process.env.PORT || 5182));
const host = argOf('--host', '127.0.0.1');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  let file = path.join(root, urlPath === '/' ? 'index.html' : urlPath);
  if (!file.startsWith(root)) { res.writeHead(403); res.end('forbidden'); return; }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); res.end('not found: ' + urlPath); return; }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(buf);
  });
});

server.listen(port, host, () => {
  console.log('合成大猫咪 · 已启动');
  console.log('  本机：http://127.0.0.1:' + port);
  if (host === '0.0.0.0') {
    const nets = os.networkInterfaces();
    for (const list of Object.values(nets)) {
      for (const n of list || []) {
        if (n.family === 'IPv4' && !n.internal) console.log('  手机（同一 Wi-Fi）：http://' + n.address + ':' + port);
      }
    }
  }
  console.log('  按 Ctrl+C 停止');
});
