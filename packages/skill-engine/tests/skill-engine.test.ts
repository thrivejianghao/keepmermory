import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { AIProviderManager, MockProvider, type ImageProvider } from '@ai-photo/ai-provider';
import { SkillLoader, SkillRegistry, SkillValidator, SkillExecutor, WorkflowExecutor } from '../src/index.js';

const manifest = {
  schemaVersion: '1.0', id: 'travel-postcard', name: '旅行明信片', version: '1.0.0', description: 'postcard', category: 'travel',
  input: { images: { min: 1, max: 1 } }, parameters: { style: { type: 'select', label: 'Style', options: [{ label: 'Film', value: 'film' }] } }, provider: { type: 'mock', model: 'image-default' }, workflow: { type: 'sequential', steps: [{ type: 'image_generate' }] },
} as const;

describe('SkillValidator', () => {
  it('rejects a manifest without a valid semver version', () => {
    const result = new SkillValidator().validate({ ...manifest, version: 'latest' });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('version must use semver');
  });
});

describe('SkillLoader and SkillExecutor', () => {
  it('discovers declarative skills and executes their workflow through a provider', async () => {
    const root = await mkdtemp(join('E:\\codex-temp', 'skills-'));
    const skillDir = join(root, 'travel-postcard');
    await mkdir(skillDir);
    await writeFile(join(skillDir, 'skill.json'), JSON.stringify(manifest));
    await writeFile(join(skillDir, 'SKILL.md'), 'Create a cinematic travel postcard.');
    const loader = new SkillLoader(root);
    const registry = new SkillRegistry(loader);
    await registry.reload();
    const executor = new SkillExecutor(registry, new WorkflowExecutor(new AIProviderManager(new Map([['mock', new MockProvider()]]))));

    const result = await executor.execute({ taskId: '1', userId: 'dev-user', skillId: 'travel-postcard', inputImages: [{ objectKey: 'uploads/a.jpg' }], parameters: { style: 'film' } });

    expect(result.provider).toBe('mock');
    expect(result.image.data).toEqual(Buffer.from('mock-image'));
    expect(registry.list()).toHaveLength(1);
  });

  it('passes the user-selected provider and model to the workflow provider', async () => {
    const root = await mkdtemp(join('E:\\codex-temp', 'skills-selected-model-'));
    const skillDir = join(root, 'travel-postcard');
    await mkdir(skillDir);
    await writeFile(join(skillDir, 'skill.json'), JSON.stringify(manifest));
    await writeFile(join(skillDir, 'SKILL.md'), 'Create a cinematic travel postcard.');
    const receivedModels: string[] = [];
    const provider: ImageProvider = {
      generate: async ({ model }) => { receivedModels.push(model); return { data: Buffer.from('selected-model-image'), mimeType: 'image/jpeg' }; },
      edit: async ({ model }) => { receivedModels.push(model); return { data: Buffer.from('selected-model-image'), mimeType: 'image/jpeg' }; },
      analyze: async () => ({ text: 'ok' }),
    };
    const registry = new SkillRegistry(new SkillLoader(root));
    await registry.reload();
    const executor = new SkillExecutor(registry, new WorkflowExecutor(new AIProviderManager(new Map([['mock', provider]]))));

    const result = await executor.execute({ taskId: '1', userId: 'dev-user', skillId: 'travel-postcard', inputImages: [{ objectKey: 'uploads/a.jpg' }], parameters: { style: 'film' }, providerId: 'mock', modelId: 'selected-model' });

    expect(receivedModels).toEqual(['selected-model']);
    expect(result.provider).toBe('mock');
    expect(result.model).toBe('selected-model');
  });
});
