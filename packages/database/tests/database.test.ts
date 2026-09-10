import { describe, expect, it } from 'vitest';

import { InMemoryDatabase } from '../src/in-memory-database.js';

describe('InMemoryDatabase', () => {
  it('creates the dev user and returns only published skills', async () => {
    const database = new InMemoryDatabase();

    const user = await database.ensureDevUser();
    await database.createSkill({
      id: 'travel-postcard',
      name: '旅行明信片',
      description: '把旅行照片变成明信片',
      category: 'travel',
      status: 'PUBLISHED',
      currentVersion: '1.0.0',
    });
    await database.createSkill({
      id: 'draft-skill',
      name: '草稿玩法',
      description: '尚未发布',
      category: 'other',
      status: 'DRAFT',
      currentVersion: '1.0.0',
    });

    const skills = await database.listSkills({ status: 'PUBLISHED' });

    expect(user.id).toBe('dev-user');
    expect(skills).toHaveLength(1);
    expect(skills[0]?.id).toBe('travel-postcard');
  });

  it('keeps the skill version used by a created task', async () => {
    const database = new InMemoryDatabase();
    await database.ensureDevUser();
    await database.createSkill({
      id: 'film-photo',
      name: '胶片照片',
      description: '90 年代胶片质感',
      category: 'photo',
      status: 'PUBLISHED',
      currentVersion: '1.0.0',
    });
    await database.createSkillVersion({
      skillId: 'film-photo',
      version: '1.0.0',
      status: 'PUBLISHED',
      manifest: { id: 'film-photo', version: '1.0.0' },
    });

    const task = await database.createTask({
      userId: 'dev-user',
      skillId: 'film-photo',
      skillVersion: '1.0.0',
      input: { images: [{ objectKey: 'uploads/example.jpg' }] },
      parameters: {},
    });

    expect(task.taskNo).toMatch(/^TASK-/);
    expect(task.skillVersion).toBe('1.0.0');
    expect(task.status).toBe('PENDING');
  });

  it('inherits the provider and model from the selected skill version', async () => {
    const database = new InMemoryDatabase();
    await database.ensureDevUser();
    await database.createSkill({
      id: 'qwen-skill',
      name: 'Qwen Skill',
      description: 'image edit',
      category: 'photo',
      status: 'PUBLISHED',
      currentVersion: '1.0.0',
    });
    await database.createSkillVersion({
      skillId: 'qwen-skill',
      version: '1.0.0',
      status: 'PUBLISHED',
      manifest: {},
      providerId: 'qwen',
      modelId: 'wan2.7-image',
    });

    const task = await database.createTask({
      userId: 'dev-user',
      skillId: 'qwen-skill',
      skillVersion: '1.0.0',
      input: { images: [{ objectKey: 'uploads/example.jpg' }] },
      parameters: {},
    });

    expect(task.providerId).toBe('qwen');
    expect(task.modelId).toBe('wan2.7-image');
  });
});
