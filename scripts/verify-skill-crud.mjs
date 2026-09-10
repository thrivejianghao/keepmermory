import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { createApiServer } from '../apps/api/dist/index.js';
import { compatibleFetch } from '../packages/ai-provider/dist/index.js';

const root = await mkdtemp(join(process.env.TEMP ?? 'E:/codex-temp', 'skill-crud-'));
const skillsDir = join(root, 'skills');
const storageDir = join(root, 'storage');
const builtInDir = join(skillsDir, 'built-in');
await mkdir(builtInDir, { recursive: true });
await writeFile(join(builtInDir, 'skill.json'), JSON.stringify({
  schemaVersion: '1.0', id: 'built-in', name: 'Built In', version: '1.0.0',
  description: 'A built-in test skill', category: 'test', input: { images: { min: 1, max: 1 } },
  parameters: {}, provider: { type: 'mock', model: 'image-default' },
  workflow: { type: 'sequential', steps: [{ type: 'image_edit' }] },
}));
await writeFile(join(builtInDir, 'SKILL.md'), 'Preserve the source image.');

let server;
let base;

async function start() {
  server = await createApiServer({ skillsDir, storageDir, aiProvider: 'mock' });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  base = `http://127.0.0.1:${address.port}/api/v1`;
}

async function stop() {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}

async function request(path, init = {}) {
  const response = await compatibleFetch(base + path, {
    ...init,
    headers: { 'Content-Type': 'application/json', 'X-Admin-Config': '1', ...init.headers },
  });
  return { status: response.status, body: await response.json() };
}

const draft = {
  id: 'admin-created',
  name: '后台创建 Skill',
  description: '从后台创建的图片处理 Skill',
  category: 'portrait',
  status: 'DRAFT',
  version: '1.0.0',
  sort: 12,
  coverUrl: 'https://example.com/cover.jpg',
  instructions: 'Preserve the source image and create a clean portrait.',
  imageMin: 1,
  imageMax: 1,
};

try {
  await start();

  const created = await request('/admin/skills', { method: 'POST', body: JSON.stringify(draft) });
  assert.equal(created.status, 200);
  assert.equal(created.body.data.id, 'admin-created');

  const detail = await request('/admin/skills/admin-created');
  assert.equal(detail.status, 200);
  assert.equal(detail.body.data.instructions, draft.instructions);
  assert.equal(detail.body.data.version, '1.0.0');

  const draftPublic = await request('/skills');
  assert.deepEqual(draftPublic.body.data.map((skill) => skill.id), ['built-in']);

  const invalid = await request('/admin/skills/admin-created', {
    method: 'PUT', body: JSON.stringify({ ...draft, version: 'not-semver' }),
  });
  assert.equal(invalid.status, 400);
  assert.equal((await request('/admin/skills/admin-created')).body.data.version, '1.0.0');

  const published = await request('/admin/skills/admin-created', {
    method: 'PUT', body: JSON.stringify({ ...draft, name: '已发布 Skill', status: 'PUBLISHED', version: '1.1.0' }),
  });
  assert.equal(published.status, 200);
  const publicSkills = await request('/skills');
  assert.deepEqual(publicSkills.body.data.map((skill) => skill.id), ['built-in', 'admin-created']);
  assert.equal(publicSkills.body.data[1].name, '已发布 Skill');
  assert.equal(publicSkills.body.data[1].coverUrl, draft.coverUrl);

  const form = new FormData();
  form.append('file', new Blob([Buffer.from('skill-crud-source')], { type: 'image/png' }), 'source.png');
  const uploadResponse = await compatibleFetch(base + '/uploads', { method: 'POST', body: form });
  const upload = await uploadResponse.json();
  const task = await request('/tasks', { method: 'POST', body: JSON.stringify({
    skillId: 'admin-created', providerId: 'mock', modelId: 'image-default',
    images: [{ objectKey: upload.data.objectKey, mimeType: 'image/png' }], parameters: {},
  }) });
  assert.equal(task.status, 200);
  let result;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    result = await request(`/tasks/${task.body.data.taskId}/result`);
    if (result.body.data.task.status === 'SUCCEEDED') break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.equal(result.body.data.task.status, 'SUCCEEDED');

  const inUse = await request('/admin/skills/admin-created', { method: 'DELETE' });
  assert.equal(inUse.status, 409);
  assert.equal(inUse.body.message, 'SKILL_IN_USE');

  const removed = await request('/admin/skills/built-in', { method: 'DELETE' });
  assert.equal(removed.status, 200);
  assert.equal((await request('/admin/skills')).body.data.some((skill) => skill.id === 'built-in'), false);
  assert.equal((await request('/skills')).body.data.some((skill) => skill.id === 'built-in'), false);

  await stop();
  await start();
  const afterRestart = await request('/admin/skills');
  assert.equal(afterRestart.body.data.some((skill) => skill.id === 'built-in'), false, 'Deleted disk skills must stay deleted');
  const persisted = await request('/admin/skills/admin-created');
  assert.equal(persisted.body.data.name, '已发布 Skill');
  assert.equal(persisted.body.data.version, '1.1.0');

  console.log('Skill CRUD verification passed: create, read, validate, publish, execute, protect, delete, and restart persistence.');
} finally {
  if (server?.listening) await stop();
}
