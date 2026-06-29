/**
 * UnionCodePet daemon entry point.
 *
 * One process owns: the HTTP receive endpoint, the Codex poller, the session
 * state tracker, the sound engine, and the console panel. All event sources
 * converge on {@link ingest}, which normalizes → tracks state → plays sound →
 * refreshes the panel.
 *
 * Run: `npm run dev` (or `npm start` after build).
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { CONFIG } from './config.js';

// Force UTF-8 on stdout so Chinese text (summaries, panel) renders correctly in
// the Windows console instead of as GBK mojibake.
if (process.stdout.isTTY) {
  process.stdout.setDefaultEncoding('utf-8' as BufferEncoding);
}
import { SessionTracker } from './session-state.js';
import { SoundEngine } from './sound-engine.js';
import { ConsolePanel } from './console-panel.js';
import { CodexPoller } from './codex-poller.js';
import { normalizeClaude, normalizeZcode, normalizeCodexNotify } from './normalizer.js';
import type { UnifiedEvent, CliSource } from './protocol.js';

const tracker = new SessionTracker();
const sound = new SoundEngine((m) => console.log(m));
const panel = new ConsolePanel();

const log = (m: string) => {
  const t = new Date().toISOString().slice(11, 23);
  console.log(`[${t}] ${m}`);
};

/**
 * The single funnel for every normalized event, regardless of source.
 * Order matters: track first (so panel sees fresh state), then rate-limit sound.
 */
function ingest(ev: UnifiedEvent): void {
  tracker.apply(ev);
  if (tracker.shouldSound(ev)) {
    if (sound.playFor(ev)) tracker.markSounded(ev);
  }
  panel.render(tracker.all());
  log(`▶ ${ev.source}/${ev.event} ${ev.summary ?? ''}`);
}

// ---------------------------------------------------------------------------
// HTTP receive endpoint (Claude hook, Zcode hook, Codex notify)
// ---------------------------------------------------------------------------

interface IncomingDispatch {
  /** Which CLI this came from. */
  source: CliSource;
  /** For Claude: the hook event name (Stop/Notification/PreToolUse...). */
  kind?: string;
  /** Raw hook/notify payload object, or a JSON string of it. */
  payload?: unknown;
  /** Optional explicit sessionId. */
  sessionId?: string;
}

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  // Health check — handy for confirming the daemon is up.
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, sessions: tracker.all().length }));
    return;
  }

  if (req.method === 'POST' && (req.url === '/event' || req.url === '/')) {
    let body = '';
    for await (const chunk of req) body += chunk;
    let msg: IncomingDispatch;
    try {
      msg = JSON.parse(body);
    } catch {
      res.writeHead(400);
      res.end('bad json');
      return;
    }

    const ev = toUnifiedEvent(msg);
    if (ev) ingest(ev);

    res.writeHead(ev ? 200 : 202);
    res.end(ev ? 'ok' : 'ignored');
    return;
  }

  res.writeHead(404);
  res.end('not found');
});

/** Turn an incoming dispatch into a normalized UnifiedEvent (or null). */
function toUnifiedEvent(msg: IncomingDispatch): UnifiedEvent | null {
  const ts = Date.now();
  const sessionId = msg.sessionId ?? 'unknown';
  // payload may arrive as a JSON string (powershell ConvertTo-Json of an object)
  // or as an already-parsed object.
  const payload = parsePayload(msg.payload);

  switch (msg.source) {
    case 'claude':
      return normalizeClaude(msg.kind ?? '', payload, sessionId, ts);
    case 'zcode':
      return normalizeZcode(payload, sessionId, ts);
    case 'codex':
      return normalizeCodexNotify(payload, sessionId, ts);
    default:
      return null;
  }
}

function parsePayload(p: unknown): Record<string, unknown> | null {
  if (p == null) return null;
  if (typeof p === 'string') {
    try {
      return JSON.parse(p);
    } catch {
      return null;
    }
  }
  return p as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
// Start everything inside the listen callback so we only spin up poller/panel
// once the port is actually bound. This avoids the confusing case where the
// poller starts, then listen fails (EADDRINUSE) and the whole process crashes.

const poller = new CodexPoller(ingest, log);

server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error('');
    console.error(`[FATAL] 端口 ${CONFIG.port} 已被占用。`);
    console.error('        多半是另一个 UnionCodePet 守护进程已经在跑。');
    console.error('        解决方法：');
    console.error(`          1) 找到占用进程:  Get-NetTCPConnection -LocalPort ${CONFIG.port} -State Listen`);
    console.error('          2) 结束它:        Stop-Process -Id <PID> -Force');
    console.error('          3) 再重新运行 npm run dev');
    process.exit(1);
  }
  console.error('[FATAL] server error:', err.message);
  process.exit(1);
});

server.listen(CONFIG.port, CONFIG.host, () => {
  log(`UnionCodePet daemon listening on http://${CONFIG.host}:${CONFIG.port}`);
  log(`  POST /event   { source, kind?, payload?, sessionId? }`);
  log(`  GET  /health`);

  // Start the console panel refresh loop.
  panel.start(tracker, 1000);

  // Start the Codex session poller (Windows: hooks disabled, this is the channel).
  poller.start();

  // Gentle GC so dead sessions don't pile up forever.
  setInterval(() => tracker.gc(30 * 60 * 1000), 60 * 1000).unref();
});

// Clean shutdown.
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    log('shutting down…');
    poller.stop();
    panel.stop();
    server.close(() => process.exit(0));
  });
}
