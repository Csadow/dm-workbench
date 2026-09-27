import { createAssistantHandler } from './local-assistant.mjs';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, extname } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const types = { '.json': 'application/json', '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
// Serve only application assets, never the repository, local data, or secrets.
export function createAppServer(options = {}) {
  const assistant = createAssistantHandler(options);
  return createServer(async (req, res) => {
    try {
      if (await assistant(req, res, new URL(req.url, 'http://localhost').pathname)) return;
      const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).replace(/^\//, '') || 'index.html';
      if (!['GET', 'HEAD'].includes(req.method) || path.includes('..') || !/^(index\.html|sw\.js|manifest\.webmanifest|app\/[a-z-]+\.(js|css)|assets\/[a-z0-9-]+\.(svg|png|json))$/.test(path)) {
        res.writeHead(404).end('Not found'); return;
      }
      const data = await readFile(resolve(root, path));
      res.writeHead(200, { 'Content-Type': `${types[extname(path)] || 'application/octet-stream'}; charset=utf-8`, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
      res.end(req.method === 'HEAD' ? undefined : data);
    } catch { res.writeHead(404).end('Not found'); }
  });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 4173);
  const host = process.env.HOST || '127.0.0.1';
  createAppServer().listen(port, host, () => console.log(`DM Workbench: http://${host}:${port}`));
}
