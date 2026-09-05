import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

import { AIProviderManager, MockProvider } from '../packages/ai-provider/dist/index.js';
import { InMemoryDatabase } from '../packages/database/dist/index.js';
import { SkillExecutor, SkillLoader, SkillRegistry, WorkflowExecutor } from '../packages/skill-engine/dist/index.js';
import { LocalStorageProvider } from '../packages/storage/dist/index.js';
import { InMemoryTaskQueue, TaskService, TaskWorker } from '../packages/task/dist/index.js';

test('processes a queued task into a persisted mock output', async () => {
  const root = await mkdtemp(join('E:\\codex-temp', 'task-flow-'));
  const skillDir = join(root, 'skills', 'travel-postcard');
  await mkdir(skillDir, { recursive: true });
  await writeFile(
    join(skillDir, 'skill.json'),
    JSON.stringify({
      schemaVersion: '1.0',
      id: 'travel-postcard',
      name: '旅行明信片',
      version: '1.0.0',
      description: 'postcard',
      category: 'travel',
      input: { images: { min: 1, max: 1 } },
      parameters: {},
      provider: { type: 'mock', model: 'image-default' },
      workflow: { type: 'sequential', steps: [{ type: 'image_edit' }] },
    }),
  );
  await writeFile(join(skillDir, 'SKILL.md'), 'Create a finished travel postcard.');

  const database = new InMemoryDatabase();
  await database.ensureDevUser();
  await database.createSkill({
    id: 'travel-postcard',
    name: '旅行明信片',
    description: 'postcard',
    category: 'travel',
    status: 'PUBLISHED',
    currentVersion: '1.0.0',
  });
  await database.createSkillVersion({
    skillId: 'travel-postcard',
    version: '1.0.0',
    status: 'PUBLISHED',
    manifest: {},
  });
  const storage = new LocalStorageProvider({ rootDir: join(root, 'storage') });
  await storage.save(Buffer.from('source-photo'), 'uploads/source.jpg');
  const provider = new MockProvider({ sourceReader: (key) => storage.read(key) });
  const registry = new SkillRegistry(new SkillLoader(join(root, 'skills')));
  await registry.reload();
  const executor = new SkillExecutor(
    registry,
    new WorkflowExecutor(new AIProviderManager(new Map([['mock', provider]]))),
  );
  const queue = new InMemoryTaskQueue();
  const service = new TaskService(database, queue, executor, storage);
  const worker = new TaskWorker(queue, service);
  worker.start();

  const created = await service.createTask({
    userId: 'dev-user',
    skillId: 'travel-postcard',
    input: { images: [{ objectKey: 'uploads/source.jpg', mimeType: 'image/jpeg' }] },
    parameters: {},
  });
  await worker.waitForIdle();

  const task = await database.getTask(created.id);
  const outputs = await database.listTaskOutputs(created.id);
  assert.equal(task?.status, 'SUCCEEDED');
  assert.equal(task?.progress, 100);
  assert.equal(outputs.length, 1);
  assert.deepEqual(await storage.read(outputs[0].objectKey), Buffer.from('source-photo'));
});
