import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import { join } from 'node:path';

import { createApiServer } from '../apps/api/dist/index.js';
import { createStaticServer } from './static-server.mjs';

const root = await mkdtemp(join('E:\\codex-temp', 'verify-local-'));
const skillDir = join(root, 'skills', 'travel-postcard');
await mkdir(skillDir, { recursive: true });
await writeFile(join(skillDir, 'skill.json'), JSON.stringify({
  schemaVersion: '1.0', id: 'travel-postcard', name: '旅行明信片', version: '1.0.0',
  description: '本地验证技能', category: 'travel', input: { images: { min: 1, max: 1 } },
  parameters: {}, provider: { type: 'mock', model: 'image-default' },
  workflow: { type: 'sequential', steps: [{ type: 'image_edit' }] },
}));
await writeFile(join(skillDir, 'SKILL.md'), 'Create a travel postcard.');

const api = await createApiServer({ skillsDir: join(root, 'skills'), storageDir: join(root, 'storage') });
await listen(api, 0);
const apiAddress = api.address();
assert.ok(apiAddress && typeof apiAddress === 'object');
const apiBase = `http://127.0.0.1:${apiAddress.port}`;

const health = await jsonRequest(`${apiBase}/api/v1/health`);
assert.equal(health.status, 200);
assert.equal(health.body.data.provider, 'mock');
const skills = await jsonRequest(`${apiBase}/api/v1/skills`);
assert.equal(skills.body.data.length, 1);

const boundary = `----codex-${Date.now()}`;
const uploadBody = Buffer.concat([
  Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="photo.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`),
  Buffer.from('photo'),
  Buffer.from(`\r\n--${boundary}--\r\n`),
]);
const upload = await jsonRequest(`${apiBase}/api/v1/uploads`, {
  method: 'POST', body: uploadBody,
  headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
});
assert.equal(upload.body.code, 0);

const created = await jsonRequest(`${apiBase}/api/v1/tasks`, {
  method: 'POST', body: JSON.stringify({ skillId: 'travel-postcard', images: [{ objectKey: upload.body.data.objectKey, mimeType: 'image/jpeg' }], parameters: {} }),
  headers: { 'Content-Type': 'application/json' },
});
assert.equal(created.body.code, 0);
let result;
for (let attempt = 0; attempt < 20; attempt += 1) {
  result = await jsonRequest(`${apiBase}/api/v1/tasks/${created.body.data.taskId}/result`);
  if (result.body.data.task.status === 'SUCCEEDED') break;
  await new Promise((resolve) => setTimeout(resolve, 10));
}
assert.equal(result.body.data.task.status, 'SUCCEEDED');
assert.equal(result.body.data.outputs.length, 1);
api.close();

const admin = await createStaticServer({ rootDir: join(process.cwd(), 'apps/admin/static'), htmlReplacements: { '__API_PORT__': '3999' } });
await listen(admin, 0);
const adminAddress = admin.address();
assert.ok(adminAddress && typeof adminAddress === 'object');
const page = await jsonRequest(`http://127.0.0.1:${adminAddress.port}/dashboard`);
assert.equal(page.status, 200);
assert.match(page.text, /造像台/);
assert.match(page.text, /:3999\/api\/v1/);
admin.close();

const assetRoot = join(root, 'admin-assets');
await mkdir(join(assetRoot, 'assets'), { recursive: true });
await writeFile(join(assetRoot, 'index.html'), '<!doctype html><script src="/assets/app.js"></script>');
await writeFile(join(assetRoot, 'assets', 'app.js'), 'console.log("ok")');
const assetServer = await createStaticServer({ rootDir: assetRoot });
await listen(assetServer, 0);
const assetAddress = assetServer.address();
assert.ok(assetAddress && typeof assetAddress === 'object');
const asset = await jsonRequest(`http://127.0.0.1:${assetAddress.port}/assets/app.js`);
assert.equal(asset.status, 200);
assert.equal(asset.text, 'console.log("ok")');
assetServer.close();
console.log('Local verification passed: API mock flow and Admin SPA are reachable.');

function listen(server, port) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
}

function jsonRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const req = request(target, { method: options.method ?? 'GET', headers: options.headers }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        const buffer = Buffer.concat(chunks);
        const text = buffer.toString('utf8');
        let body = null;
        try { body = JSON.parse(text); } catch { /* static HTML */ }
        resolve({ status: response.statusCode ?? 0, body, text });
      });
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}
