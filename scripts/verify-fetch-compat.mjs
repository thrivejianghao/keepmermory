import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { compatibleFetch } from '../packages/ai-provider/dist/index.js';

const receiver = createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ authorization: req.headers.authorization ?? null, apiKey: req.headers['x-goog-api-key'] ?? null }));
});
await new Promise((resolve) => receiver.listen(0, '127.0.0.1', resolve));
const server = createServer(async (req, res) => {
  if (req.url === '/cross-origin') { res.writeHead(302, { Location: `http://127.0.0.1:${receiver.address().port}/` }).end(); return; }
  if (req.url === '/bad-redirect') { res.writeHead(302, { Location: 'http://[' }).end(); return; }
  if (req.url === '/loop') { res.writeHead(302, { Location: '/loop' }).end(); return; }
  if (req.url === '/slow') return;
  if (req.url === '/empty') { res.writeHead(204).end(); return; }
  if (req.url === '/unauthorized') { res.writeHead(401).end('{}'); return; }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const input = new Request('http://localhost/', { method: 'POST', headers: req.headers, body: Buffer.concat(chunks) });
  const form = await input.formData();
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ prompt: form.get('prompt'), filename: form.get('image[]').name, data: await form.get('image[]').text() }));
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
try {
  const form = new FormData();
  form.set('prompt', 'photo test');
  form.append('image[]', new Blob(['image bytes'], { type: 'image/png' }), 'photo.png');
  assert.deepEqual(await (await compatibleFetch(base + '/', { method: 'POST', body: form })).json(), { prompt: 'photo test', filename: 'photo.png', data: 'image bytes' });
  assert.equal((await compatibleFetch(base + '/empty')).status, 204);
  assert.equal((await compatibleFetch(base + '/unauthorized')).status, 401);
  assert.deepEqual(await (await compatibleFetch(base + '/cross-origin', { headers: { Authorization: 'test-secret', 'x-goog-api-key': 'test-secret' } })).json(), { authorization: null, apiKey: null });
  await assert.rejects(compatibleFetch(base + '/loop'));
  await assert.rejects(compatibleFetch(base + '/slow', { signal: AbortSignal.timeout(40) }));
  await assert.rejects(compatibleFetch(base + '/bad-redirect'));
  console.log('HTTP compatibility passed: multipart, status handling, redirects, secret stripping, abort, and malformed redirect.');
} finally {
  for (const item of [server, receiver]) {
    item.closeAllConnections();
    await new Promise((resolve) => item.close(resolve));
  }
}
