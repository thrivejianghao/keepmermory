import { strict as assert } from 'node:assert';

const apiBase = process.env.API_BASE_URL ?? 'http://127.0.0.1:3000/api/v1';

async function request(path, init) {
  const response = await fetch(`${apiBase}${path}`, init);
  const body = await response.json();
  if (!response.ok || body.code !== 0) throw new Error(`${init?.method ?? 'GET'} ${path}: ${body.message ?? response.status}`);
  return body.data;
}

const skills = await request('/skills');
assert.ok(skills.length > 0, 'at least one published Skill is required');
const skill = await request(`/skills/${encodeURIComponent(skills[0].id)}`);

const form = new FormData();
form.append('file', new Blob([Uint8Array.from([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' }), 'miniapp-e2e.jpg');
const upload = await request('/uploads', { method: 'POST', body: form });
assert.match(upload.objectKey, /^uploads\//);

const parameters = Object.fromEntries(Object.entries(skill.parameters).map(([key, definition]) => [key, definition.default ?? definition.options?.[0]?.value ?? (definition.type === 'boolean' ? false : definition.type === 'number' ? 0 : '')]));
const created = await request('/tasks', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ skillId: skill.id, providerId: 'mock', modelId: 'image-default', images: [{ objectKey: upload.objectKey, mimeType: upload.mimeType }], parameters }),
});

let task;
for (let attempt = 0; attempt < 60; attempt += 1) {
  task = await request(`/tasks/${created.taskId}`);
  if (['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(task.status)) break;
  await new Promise((resolve) => setTimeout(resolve, 100));
}
assert.equal(task?.status, 'SUCCEEDED');

const result = await request(`/tasks/${created.taskId}/result`);
assert.equal(result.outputs.length, 1);
const worksBeforeDelete = await request('/works?page=1&pageSize=50');
assert.ok(worksBeforeDelete.items.some((item) => item.task.id === created.taskId));

await request(`/works/${created.taskId}`, { method: 'DELETE' });
const worksAfterDelete = await request('/works?page=1&pageSize=50');
assert.ok(!worksAfterDelete.items.some((item) => item.task.id === created.taskId));

console.log(`Mini Program integration passed: ${skill.id} -> ${created.taskId} -> deleted`);
