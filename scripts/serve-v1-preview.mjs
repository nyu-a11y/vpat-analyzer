import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const DIRECTORY = resolve(ROOT, 'build/v1');
const host = process.env.VPAT_PREVIEW_HOST || '127.0.0.1';
const requestedPort = Number(process.env.VPAT_PREVIEW_PORT || process.argv[2] || 4175);
if (!Number.isInteger(requestedPort) || requestedPort < 0 || requestedPort > 65535) {
  throw new Error('Preview port must be an integer from 0 through 65535.');
}

const contentTypes = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
]);

const server = createServer((request, response) => {
  const pathname = new URL(request.url || '/', `http://${host}`).pathname;
  const name = pathname === '/' ? 'local.html' : pathname.slice(1);
  if (!/^[A-Za-z0-9._-]+$/u.test(name)) {
    response.writeHead(404).end('Not found');
    return;
  }
  const file = resolve(DIRECTORY, name);
  try {
    if (!statSync(file).isFile()) throw new Error('not a file');
  } catch {
    response.writeHead(404).end('Not found');
    return;
  }
  response.writeHead(200, {
    'Content-Type': contentTypes.get(extname(file)) || 'application/octet-stream',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  });
  createReadStream(file).pipe(response);
});

server.listen(requestedPort, host, () => {
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : requestedPort;
  console.log(`NYU VPAT Analyzer preview: http://${host}:${port}/local.html`);
});
