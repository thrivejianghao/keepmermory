import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

import { createApiServer } from '../apps/api/dist/index.js';

test('runs upload to result over the HTTP API', async (context) => {
  const root = await mkdtemp(join('E:\\codex-temp', 'api-e2e-'));
  const skillDir = join(root, 'skills', 'travel-postcard');
  await mkdir(skillDir, { recursive: true });
  await writeFile(
    join(skillDir, 'skill.json'),
    JSON.stringify({
      schemaVersion: '1.0',
      id: 'travel-postcard',
      name: '旅行明信片',
      version: '1.0.0',
      description: '把普通旅行照片变成电影感旅行明信片',
      category: 'travel',
      input: { images: { min: 1, max: 1 } },
      parameters: {},
      provider: { type: 'mock', model: 'image-default' },
      workflow: { type: 'sequential', steps: [{ type: 'image_edit' }] },
    }),
  );
  await writeFile(join(skillDir, 'SKILL.md'), 'Create a travel postcard and preserve identity.');

  const server = await createApiServer({ skillsDir: join(root, 'skills'), storageDir: join(root, 'storage') });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  context.after(() => server.close());
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const baseUrl = `http://127.0.0.1:${address.port}/api/v1`;

  const skills = await fetch(`${baseUrl}/skills`).then((response) => response.json());
  assert.equal(skills.code, 0);
  assert.equal(skills.data.length, 1);

  const form = new FormData();
  form.append('file', new Blob([Buffer.from('photo')], { type: 'image/jpeg' }), 'photo.jpg');
  const upload = await fetch(`${baseUrl}/uploads`, { method: 'POST', body: form }).then((response) => response.json());
  assert.equal(upload.code, 0);

  const created = await fetch(`${baseUrl}/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ skillId: 'travel-postcard', images: [{ objectKey: upload.data.objectKey, mimeType: 'image/jpeg' }], parameters: {} }),
  }).then((response) => response.json());
  assert.equal(created.code, 0);

  let task;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    task = await fetch(`${baseUrl}/tasks/${created.data.taskId}`).then((response) => response.json());
    if (task.data.status === 'SUCCEEDED') break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(task.data.status, 'SUCCEEDED');

  const result = await fetch(`${baseUrl}/tasks/${created.data.taskId}/result`).then((response) => response.json());
  const works = await fetch(`${baseUrl}/works`).then((response) => response.json());
  assert.equal(result.data.outputs.length, 1);
  assert.equal(works.data.items.length, 1);
});
