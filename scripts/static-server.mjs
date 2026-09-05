import { createReadStream } from 'node:fs';
import { access, readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

export async function createStaticServer({ rootDir, htmlReplacements = {} }) {
  const root = resolve(rootDir instanceof URL ? fileURLToPath(rootDir) : rootDir);
  await access(join(root, 'index.html'));

  return createServer(async (request, response) => {
    const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
    const requested = resolve(join(root, pathname === '/' ? 'index.html' : pathname.slice(1)));
    const file = await findFile(root, requested);
    if (!file) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Not found');
      return;
    }
    if (extname(file).toLowerCase() === '.html' && Object.keys(htmlReplacements).length > 0) {
      let html = await readFile(file, 'utf8');
      for (const [needle, replacement] of Object.entries(htmlReplacements)) html = html.replaceAll(needle, replacement);
      response.writeHead(200, {
        'Content-Length': Buffer.byteLength(html),
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache',
      });
      response.end(html);
      return;
    }
    const fileInfo = await stat(file);
    response.writeHead(200, {
      'Content-Length': fileInfo.size,
      'Content-Type': MIME_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
      'Cache-Control': extname(file) === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
    });
    createReadStream(file).pipe(response);
  });
}

async function findFile(root, requested) {
  const relativePath = relative(root, requested);
  if (!relativePath || relativePath.startsWith('..') || resolve(root, relativePath) !== requested) return null;
  try {
    const info = await stat(requested);
    return info.isFile() ? requested : null;
  } catch {
    const fallback = join(root, 'index.html');
    try {
      await access(fallback);
      return fallback;
    } catch {
      return null;
    }
  }
}
