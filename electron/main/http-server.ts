/**
 * HTTP receive endpoint — the entry point CLI hooks/notify POST into.
 *
 * Path/port are unchanged from the legacy daemon, so dispatcher.ps1 and the
 * install/*.md instructions keep working without modification.
 */
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { CONFIG } from '../../src/config.js';
import { createIngester, toUnifiedEvent, type Ingester } from './ingest.js';

/**
 * Start the HTTP server. Returns the ingester (for the poller + IPC).
 * `onSessionsChange` is forwarded to the ingester so the main process can push
 * session updates to the renderer.
 */
export function startHttpServer(onSessionsChange: () => void): {
  server: Server;
  ingester: Ingester;
} {
  const ingester = createIngester(onSessionsChange);

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, sessions: ingester.allSessions().length }));
      return;
    }

    if (req.method === 'POST' && (req.url === '/event' || req.url === '/')) {
      let body = '';
      for await (const chunk of req) body += chunk;
      let msg: { source: string; kind?: string; payload?: unknown; sessionId?: string };
      try {
        msg = JSON.parse(body);
      } catch {
        res.writeHead(400);
        res.end('bad json');
        return;
      }

      const ev = toUnifiedEvent(msg as Parameters<typeof toUnifiedEvent>[0]);
      if (ev) ingester.ingest(ev);

      res.writeHead(ev ? 200 : 202);
      res.end(ev ? 'ok' : 'ignored');
      return;
    }

    res.writeHead(404);
    res.end('not found');
  });

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error('');
      console.error(`[FATAL] 端口 ${CONFIG.port} 已被占用。`);
      console.error('        多半是另一个 UnionCodePet 守护进程在跑。');
      console.error(`          Get-NetTCPConnection -LocalPort ${CONFIG.port} -State Listen`);
      process.exit(1);
    }
    console.error('[FATAL] server error:', err.message);
    process.exit(1);
  });

  server.listen(CONFIG.port, CONFIG.host, () => {
    const t = new Date().toISOString().slice(11, 23);
    console.log(`[${t}] HTTP listening on http://${CONFIG.host}:${CONFIG.port}  (POST /event, GET /health)`);
  });

  return { server, ingester };
}
