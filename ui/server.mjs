// Local web UI for the Pi screen: a noVNC page, a websocket-to-TCP bridge to the
// tunnelled wayvnc, and the agent/human control state with handoff messages.
import { createServer } from 'node:http';
import { connect } from 'node:net';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { WebSocketServer } from 'ws';

const UI_PORT = Number(process.env.RPI_BROWSER_UI_PORT || 6080);
const VNC_PORT = Number(process.env.RPI_BROWSER_VNC_PORT || 5901);
const UI_DIR = new URL('.', import.meta.url).pathname;
const NOVNC_DIR = join(UI_DIR, 'vendor', 'novnc');

/** @typedef {'agent' | 'human'} Control  'agent' means the page is view-only. */
/** @typedef {{ id: string, message: string, createdAt: string, resolvedAt: string | null }} Handoff */
/** @typedef {{ control: Control, handoff: Handoff | null }} State */
/** @typedef {{ type: 'handoff', message: string } | { type: 'done' } | { type: 'take' } | { type: 'release' }} Event */

/** @param {Handoff | null} h @param {string} now */
const resolve = (h, now) => (h && !h.resolvedAt ? { ...h, resolvedAt: now } : h);

/** @param {State} state @param {Event} event @param {string} now @returns {State} */
function transition(state, event, now) {
  switch (event.type) {
    case 'handoff':
      return { control: 'human', handoff: { id: randomUUID(), message: event.message, createdAt: now, resolvedAt: null } };
    case 'done':
    case 'release':
      return { control: 'agent', handoff: resolve(state.handoff, now) };
    case 'take':
      return { ...state, control: 'human' };
  }
}

/** @type {State} */
let state = { control: 'agent', handoff: null };
const sseClients = new Set();
/** @type {Set<{ id: string, settle: (status: number, body: unknown) => void }>} */
const waiters = new Set();

/** @param {Event} event */
function apply(event) {
  state = transition(state, event, new Date().toISOString());
  const frame = `data: ${JSON.stringify(state)}\n\n`;
  for (const res of sseClients) res.write(frame);
  for (const w of waiters) settleWaiter(w);
  return state;
}

function settleWaiter(w) {
  const h = state.handoff;
  if (h?.id !== w.id) w.settle(409, { error: 'superseded by a newer handoff' });
  else if (h.resolvedAt) w.settle(200, h);
}

// Any web page in the user's browser can reach 127.0.0.1, and WebSockets skip CORS.
// Accept only requests addressed to this server and coming from its own page (or curl).
const LOCAL_HOSTS = new Set([`127.0.0.1:${UI_PORT}`, `localhost:${UI_PORT}`]);
function trusted(req) {
  const origin = req.headers.origin;
  return LOCAL_HOSTS.has(req.headers.host) && (origin === undefined || LOCAL_HOSTS.has(origin.replace(/^http:\/\//, '')));
}

const send = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
};

async function readJson(req) {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : {};
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.txt': 'text/plain; charset=utf-8' };
async function sendFile(res, path) {
  try {
    const body = await readFile(path);
    res.writeHead(200, { 'content-type': MIME[extname(path)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    send(res, 404, { error: 'not found' });
  }
}

async function route(req, res) {
  const { pathname } = new URL(req.url, 'http://localhost');
  const key = `${req.method} ${pathname}`;

  if (key === 'GET /') return sendFile(res, join(UI_DIR, 'index.html'));
  if (req.method === 'GET' && pathname.startsWith('/novnc/')) {
    const path = normalize(join(NOVNC_DIR, decodeURIComponent(pathname.slice('/novnc/'.length))));
    if (!path.startsWith(NOVNC_DIR + sep)) return send(res, 404, { error: 'not found' });
    return sendFile(res, path);
  }
  if (key === 'GET /state') return send(res, 200, state);
  if (key === 'GET /viewers') return send(res, 200, { count: sseClients.size });
  if (key === 'GET /events') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
    res.write(`data: ${JSON.stringify(state)}\n\n`);
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
    return;
  }
  if (key === 'POST /handoff') {
    const { message } = await readJson(req);
    if (typeof message !== 'string' || !message.trim()) return send(res, 400, { error: 'message must be a non-empty string' });
    return send(res, 200, apply({ type: 'handoff', message: message.trim() }).handoff);
  }
  if (key === 'POST /done' || key === 'POST /take' || key === 'POST /release') {
    return send(res, 200, apply({ type: pathname.slice(1) }));
  }
  const wait = req.method === 'GET' && pathname.match(/^\/handoff\/([^/]+)\/wait$/);
  if (wait) {
    if (state.handoff?.id !== wait[1]) return send(res, 404, { error: 'no such open handoff' });
    const w = {
      id: wait[1],
      settle: (status, body) => {
        waiters.delete(w);
        send(res, status, body);
      },
    };
    waiters.add(w);
    req.on('close', () => waiters.delete(w));
    return settleWaiter(w);
  }
  send(res, 404, { error: 'not found' });
}

const server = createServer((req, res) => {
  if (!trusted(req)) return send(res, 403, { error: 'forbidden' });
  route(req, res).catch((err) => send(res, 400, { error: String(err.message || err) }));
});

const wss = new WebSocketServer({ noServer: true });
server.on('upgrade', (req, socket, head) => {
  if (!trusted(req) || new URL(req.url, 'http://localhost').pathname !== '/vnc') return socket.destroy();
  wss.handleUpgrade(req, socket, head, (ws) => {
    const tcp = connect(VNC_PORT, '127.0.0.1');
    tcp.on('data', (data) => ws.send(data));
    tcp.on('close', () => ws.close());
    tcp.on('error', (err) => {
      console.error(`vnc: 127.0.0.1:${VNC_PORT}: ${err.message}`);
      ws.close(1011, 'vnc unreachable');
    });
    ws.on('message', (data) => tcp.write(data));
    ws.on('close', () => tcp.destroy());
  });
});

server.listen(UI_PORT, '127.0.0.1', () => console.log(`ui: http://127.0.0.1:${UI_PORT}, vnc bridge to 127.0.0.1:${VNC_PORT}`));
