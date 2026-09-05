import { describe, expect, it } from 'vitest';

import { AIProviderManager, MockProvider } from '../src/index.js';

describe('MockProvider', () => {
  it('returns a generated image without an external API key', async () => {
    const provider = new MockProvider();
    const result = await provider.generate({ prompt: 'postcard', images: [], model: 'image-default' });
    expect(result.data).toEqual(Buffer.from('mock-image'));
    expect(result.metadata).toMatchObject({ provider: 'mock' });
  });

  it('exposes provider failures for task retry handling', async () => {
    const provider = new MockProvider({ failureMode: 'error' });
    await expect(provider.generate({ prompt: 'fail', images: [], model: 'image-default' })).rejects.toThrow('AI_PROVIDER_ERROR');
  });
});

describe('AIProviderManager', () => {
  it('resolves providers by manifest type', () => {
    const provider = new MockProvider();
    const manager = new AIProviderManager(new Map([['mock', provider]]));
    expect(manager.getProvider('mock')).toBe(provider);
    expect(() => manager.getProvider('missing')).toThrow('PROVIDER_NOT_FOUND:missing');
  });
});
