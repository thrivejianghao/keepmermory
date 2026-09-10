import { describe, expect, it } from 'vitest';

import { AIProviderManager, GeminiProvider, MockProvider, OpenAIProvider, QwenProvider } from '../src/index.js';

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

describe('OpenAIProvider', () => {
  it('sends source images to the image edits endpoint', async () => {
    let requestUrl = '';
    let requestBody: BodyInit | null | undefined;
    const provider = new OpenAIProvider({
      apiKey: 'test-key',
      sourceReader: async () => Buffer.from('source-image'),
      fetcher: async (input, init) => {
        requestUrl = String(input);
        requestBody = init?.body;
        return new Response(JSON.stringify({ data: [{ b64_json: Buffer.from('result').toString('base64') }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      },
    });

    const result = await provider.edit({ prompt: 'postcard', images: [{ objectKey: 'uploads/photo.jpg', mimeType: 'image/jpeg' }], model: 'gpt-image-1' });

    expect(requestUrl).toBe('https://api.openai.com/v1/images/edits');
    expect(requestBody).toBeInstanceOf(FormData);
    expect((requestBody as FormData).get('model')).toBe('gpt-image-1');
    expect((requestBody as FormData).getAll('image[]')).toHaveLength(1);
    expect(result.data).toEqual(Buffer.from('result'));
  });
});

describe('GeminiProvider', () => {
  it('sends an image generation request with the selected model', async () => {
    let requestUrl = '';
    let requestBody = '';
    const provider = new GeminiProvider({
      apiKey: 'gemini-test-key',
      fetcher: async (input, init) => {
        requestUrl = String(input);
        requestBody = String(init?.body ?? '');
        return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: Buffer.from('gemini-result').toString('base64') } }] } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      },
    });

    const result = await provider.generate({ prompt: 'portrait', images: [], model: 'gemini-image-model' });

    expect(requestUrl).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-image-model:generateContent');
    expect(requestBody).toContain('portrait');
    expect(result.data).toEqual(Buffer.from('gemini-result'));
  });
});

describe('QwenProvider', () => {
  it('sends a DashScope image generation request with the selected model', async () => {
    let requestUrl = '';
    let requestBody = '';
    const provider = new QwenProvider({
      apiKey: 'qwen-test-key',
      fetcher: async (input, init) => {
        requestUrl = String(input);
        requestBody = String(init?.body ?? '');
        return new Response(JSON.stringify({ output: { results: [{ url: 'https://example.com/qwen-result.png' }] } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      },
    });

    const result = await provider.generate({ prompt: 'poster', images: [], model: 'qwen-image-plus' });

    expect(requestUrl).toBe('https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation');
    expect(requestBody).toContain('qwen-image-plus');
    expect(result.objectKey).toBe('https://example.com/qwen-result.png');
  });
});
