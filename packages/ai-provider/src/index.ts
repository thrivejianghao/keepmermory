import type { ImageInput } from '@ai-photo/shared';

export interface GenerateInput {
  prompt: string;
  images: ImageInput[];
  model: string;
  metadata?: Record<string, unknown>;
}

export interface EditInput extends GenerateInput {}

export interface AnalyzeInput {
  images: ImageInput[];
  prompt?: string;
}

export interface ImageResult {
  objectKey?: string;
  data?: Buffer;
  mimeType: string;
  width?: number;
  height?: number;
  metadata?: Record<string, unknown>;
}

export interface AnalyzeResult {
  text: string;
  metadata?: Record<string, unknown>;
}

export interface ImageProvider {
  generate(input: GenerateInput): Promise<ImageResult>;
  edit(input: EditInput): Promise<ImageResult>;
  analyze(input: AnalyzeInput): Promise<AnalyzeResult>;
}

export interface MockProviderOptions {
  sourceReader?: (objectKey: string) => Promise<Buffer>;
  failureMode?: 'none' | 'error' | 'timeout';
  timeoutMs?: number;
}

export class MockProvider implements ImageProvider {
  public constructor(private readonly options: MockProviderOptions = {}) {}

  public async generate(input: GenerateInput): Promise<ImageResult> {
    await this.maybeFail();
    const first = input.images[0];
    const data = first && this.options.sourceReader ? await this.options.sourceReader(first.objectKey) : Buffer.from('mock-image');
    return { data, mimeType: first?.mimeType ?? 'image/jpeg', metadata: { provider: 'mock', prompt: input.prompt } };
  }

  public async edit(input: EditInput): Promise<ImageResult> {
    return this.generate(input);
  }

  public async analyze(input: AnalyzeInput): Promise<AnalyzeResult> {
    await this.maybeFail();
    return { text: `Mock analysis for ${input.images.length} image(s)`, metadata: { provider: 'mock' } };
  }

  private async maybeFail(): Promise<void> {
    if (this.options.failureMode === 'error') throw new Error('AI_PROVIDER_ERROR');
    if (this.options.failureMode === 'timeout') {
      await new Promise((resolve) => setTimeout(resolve, this.options.timeoutMs ?? 20));
      throw new Error('AI_TIMEOUT');
    }
  }
}

export interface OpenAIProviderOptions {
  apiKey?: string;
  endpoint?: string;
  fetcher?: typeof fetch;
}

export class OpenAIProvider implements ImageProvider {
  private readonly fetcher: typeof fetch;

  public constructor(private readonly options: OpenAIProviderOptions) {
    this.fetcher = options.fetcher ?? fetch;
  }

  public async generate(input: GenerateInput): Promise<ImageResult> {
    return this.request('generate', input);
  }

  public async edit(input: EditInput): Promise<ImageResult> {
    return this.request('edit', input);
  }

  public async analyze(input: AnalyzeInput): Promise<AnalyzeResult> {
    if (!this.options.apiKey) throw new Error('OPENAI_API_KEY_MISSING');
    const response = await this.fetcher(`${this.options.endpoint ?? 'https://api.openai.com/v1'}/responses`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.options.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-4.1-mini', input: input.prompt ?? 'Analyze this image.' }),
    });
    if (!response.ok) throw new Error('AI_PROVIDER_ERROR');
    return { text: JSON.stringify(await response.json()), metadata: { provider: 'openai' } };
  }

  private async request(operation: string, input: GenerateInput): Promise<ImageResult> {
    if (!this.options.apiKey) throw new Error('OPENAI_API_KEY_MISSING');
    const response = await this.fetcher(
      `${this.options.endpoint ?? 'https://api.openai.com/v1'}/images/generations`,
      {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.options.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: input.model, prompt: input.prompt, size: '1024x1024', operation }),
      },
    );
    if (!response.ok) throw new Error('AI_PROVIDER_ERROR');
    const body = (await response.json()) as { data?: Array<{ url?: string; b64_json?: string }> };
    const image = body.data?.[0];
    if (!image) throw new Error('AI_PROVIDER_ERROR');
    if (image.b64_json) return { data: Buffer.from(image.b64_json, 'base64'), mimeType: 'image/png' };
    if (image.url) return { objectKey: image.url, mimeType: 'image/png' };
    throw new Error('AI_PROVIDER_ERROR');
  }
}

export class AIProviderManager {
  public constructor(private readonly providers: Map<string, ImageProvider>) {}

  public getProvider(type: string): ImageProvider {
    const provider = this.providers.get(type);
    if (!provider) throw new Error(`PROVIDER_NOT_FOUND:${type}`);
    return provider;
  }
}
