// Stateless relay + static server (prod). Identical in spirit to the spike relay.
// Dev:  Vite serves the app on :5173, this serves only WS on :8080.
// Prod: `npm run build` then `npm run serve` — this serves ./dist AND WS on one port.

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

const PORT = process.env.PORT || 8080;
const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), 'dist');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    let path = decodeURIComponent(url.pathname);
    if (path === '/' || path === '') path = '/index.html';
    const safe = normalize(path).replace(/^(\.\.[/\\])+/, '');
    const file = join(ROOT, safe);
    if (!file.startsWith(ROOT)) return void res.writeHead(403).end('Forbidden');
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    // SPA fallback: unknown path -> index.html (only matters in prod)
    try {
      const body = await readFile(join(ROOT, 'index.html'));
      res.writeHead(200, { 'Content-Type': MIME['.html'] });
      res.end(body);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found (run `npm run build` first for prod serving)');
    }
  }
});

const wss = new WebSocketServer({ server, path: '/ws' });
const sessions = new Map(); // id -> Set<socket>

wss.on('connection', (socket, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const id = url.searchParams.get('session') || 'default';
  if (!sessions.has(id)) sessions.set(id, new Set());
  const peers = sessions.get(id);
  peers.add(socket);
  console.log(`[relay] + join ${id} (peers=${peers.size})`);

  socket.on('message', (data, isBinary) => {
    for (const peer of peers) {
      if (peer !== socket && peer.readyState === peer.OPEN) peer.send(data, { binary: isBinary });
    }
  });
  socket.on('close', () => {
    peers.delete(socket);
    if (peers.size === 0) sessions.delete(id);
    console.log(`[relay] - leave ${id} (peers=${peers.size})`);
  });
  socket.on('error', () => {});
});

server.listen(PORT, () => {
  console.log(`\n  bandAssemble relay on http://localhost:${PORT}  (WS at /ws)`);
  console.log(`  dev: run \`npm run dev\` too, then open`);
  console.log(`    http://localhost:5173/?role=master`);
  console.log(`    http://localhost:5173/?role=client\n`);
});
