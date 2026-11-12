// bandAssemble spike — stateless relay + static file server.
//
// Two jobs, one process (exactly as 02-architecture.md describes for prod):
//   1. Serve the web app (public/) over HTTP.
//   2. Relay WebSocket messages within a session — a DUMB broadcast forwarder.
//      It knows nothing about songs, playheads, or roles. All logic lives in the
//      web app; master vs client is decided client-side.
//
// Run:  npm start    (then open http://localhost:8080)

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

const PORT = process.env.PORT || 8080;
const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

// ---- HTTP: static file serving ----
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    let path = decodeURIComponent(url.pathname);
    if (path === '/' || path === '') path = '/index.html';
    // prevent path traversal
    const safe = normalize(path).replace(/^(\.\.[/\\])+/, '');
    const file = join(ROOT, safe);
    if (!file.startsWith(ROOT)) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch (err) {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
  }
});

// ---- WebSocket: dumb per-session broadcast ----
const wss = new WebSocketServer({ server, path: '/ws' });

// sessionId -> Set<socket>
const sessions = new Map();

wss.on('connection', (socket, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const sessionId = url.searchParams.get('session') || 'default';
  socket._sessionId = sessionId;

  if (!sessions.has(sessionId)) sessions.set(sessionId, new Set());
  const peers = sessions.get(sessionId);
  peers.add(socket);
  log(`+ join session=${sessionId} (peers=${peers.size})`);

  socket.on('message', (data, isBinary) => {
    // Pure forward to every OTHER socket in the same session.
    for (const peer of peers) {
      if (peer !== socket && peer.readyState === peer.OPEN) {
        peer.send(data, { binary: isBinary });
      }
    }
  });

  socket.on('close', () => {
    peers.delete(socket);
    log(`- leave session=${sessionId} (peers=${peers.size})`);
    if (peers.size === 0) sessions.delete(sessionId);
  });

  socket.on('error', () => { /* ignore; close will clean up */ });
});

function log(msg) {
  console.log(`[relay ${new Date().toISOString()}] ${msg}`);
}

server.listen(PORT, () => {
  console.log(`\n  bandAssemble spike relay`);
  console.log(`  HTTP + WS listening on http://localhost:${PORT}`);
  console.log(`  open two windows:`);
  console.log(`    master  ->  http://localhost:${PORT}/?role=master`);
  console.log(`    client  ->  http://localhost:${PORT}/?role=client\n`);
});
