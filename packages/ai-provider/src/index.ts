import type { ImageInput } from '@ai-photo/shared';
import { compatibleFetch } from './fetch-compat.js';
export { compatibleFetch } from './fetch-compat.js';

export interface AIModelOption {
  providerId: string;
  modelId: string;
  name: string;
  description: string;
  requiresApiKey: boolean;
  available: boolean;
}

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

export interface SkillPlanInput {
  skillId: string;
  skillName: string;
  skillVersion: string;
  instructions: string;
  prompt: string;
  parameters: Record<string, unknown>;
}

export interface SkillPlanResult {
  prompt: string;
}

export interface SkillAgent {
  plan(input: SkillPlanInput): Promise<SkillPlanResult>;
}

export interface OpenAICompatibleSkillAgentOptions {
  apiKey?: string;
  endpoint?: string;
  model: string;
  fetcher?: typeof fetch;
}

export class OpenAICompatibleSkillAgent implements SkillAgent {
  private readonly endpoint: string;
  private readonly fetcher: typeof fetch;
  private readonly aliyunCompatibleEndpoint: boolean;

  public constructor(private readonly options: OpenAICompatibleSkillAgentOptions) {
    const base = new URL(options.endpoint ?? process.env.SKILL_AGENT_BASE_URL ?? 'https://api.openai.com/v1');
    if (!['https:', 'http:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) {
      throw new Error('INVALID_INPUT:SKILL_AGENT_BASE_URL');
    }
    if (!base.pathname || base.pathname === '/') base.pathname = '/v1';
    base.pathname = base.pathname.replace(/\/+$/, '');
    this.endpoint = base.toString().replace(/\/+$/, '');
    this.aliyunCompatibleEndpoint = base.hostname === 'aliyuncs.com' || base.hostname.endsWith('.aliyuncs.com');
    this.fetcher = options.fetcher ?? compatibleFetch;
  }

  public async plan(input: SkillPlanInput): Promise<SkillPlanResult> {
    if (!this.options.apiKey) throw new Error('SKILL_AGENT_API_KEY_MISSING');
    const response = await this.fetcher(`${this.endpoint}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.options.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.options.model,
        ...(this.aliyunCompatibleEndpoint ? { enable_thinking: false } : {}),
        messages: [
          { role: 'system', content: 'You plan execution for a selected AI photo Skill. Preserve the Skill intent and user parameters. Call execute_image_skill exactly once with the final image-model prompt.' },
          { role: 'user', content: JSON.stringify({
            skillId: input.skillId,
            skillName: input.skillName,
            skillVersion: input.skillVersion,
            skillInstructions: input.instructions,
            currentPrompt: input.prompt,
            parameters: input.parameters,
          }) },
        ],
        tools: [{
          type: 'function',
          function: {
            name: 'execute_image_skill',
            description: 'Execute the selected photo Skill with a complete prompt for the configured image model.',
            parameters: {
              type: 'object',
              properties: { prompt: { type: 'string', description: 'Complete image generation or editing prompt.' } },
              required: ['prompt'],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: 'function', function: { name: 'execute_image_skill' } },
      }),
    });
    if (!response.ok) throw new Error(`SKILL_AGENT_ERROR:${response.status}`);
    try {
      const body = (await response.json()) as OpenAICompatibleAgentResponse;
      const call = body.choices?.[0]?.message?.tool_calls?.find((item) => item.function?.name === 'execute_image_skill');
      const argumentsValue = call?.function?.arguments;
      const parsed = typeof argumentsValue === 'string' ? JSON.parse(argumentsValue) as { prompt?: unknown } : undefined;
      if (typeof parsed?.prompt !== 'string' || !parsed.prompt.trim()) throw new Error('invalid prompt');
      return { prompt: parsed.prompt.trim() };
    } catch {
      throw new Error('SKILL_AGENT_INVALID_RESPONSE');
    }
  }
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
  sourceReader?: (objectKey: string) => Promise<Buffer>;
}

export interface GeminiProviderOptions {
  apiKey?: string;
  endpoint?: string;
  fetcher?: typeof fetch;
  sourceReader?: (objectKey: string) => Promise<Buffer>;
}

export interface QwenProviderOptions {
  apiKey?: string;
  endpoint?: string;
  fetcher?: typeof fetch;
  sourceReader?: (objectKey: string) => Promise<Buffer>;
}

export class OpenAIProvider implements ImageProvider {
  private readonly fetcher: typeof fetch;
  private readonly endpoint: string;

  public constructor(private readonly options: OpenAIProviderOptions) {
    this.fetcher = options.fetcher ?? compatibleFetch;
    const base = new URL(options.endpoint ?? process.env.OPENAI_BASE_URL ?? process.env.OPENAI_API_BASE ?? 'https://api.openai.com/v1');
    if (!['https:', 'http:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) {
      throw new Error('INVALID_INPUT:OPENAI_BASE_URL');
    }
    base.pathname = base.pathname.replace(/\/+$/, '') || '/v1';
    this.endpoint = base.toString().replace(/\/+$/, '');
  }

  public async generate(input: GenerateInput): Promise<ImageResult> {
    if (!this.options.apiKey) throw new Error('OPENAI_API_KEY_MISSING');
    const response = await this.request(() => this.fetcher(
      `${this.endpoint}/images/generations`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.options.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: input.model, prompt: input.prompt, size: '1024x1024' }),
      },
    ));
    return this.readImage(response);
  }

  public async edit(input: EditInput): Promise<ImageResult> {
    if (!this.options.apiKey) throw new Error('OPENAI_API_KEY_MISSING');
    if (!input.images.length) throw new Error('INVALID_INPUT:images');
    const form = new FormData();
    form.set('model', input.model);
    form.set('prompt', input.prompt);
    form.set('size', '1024x1024');
    for (const [index, image] of input.images.entries()) {
      const data = await this.readSource(image);
      const mimeType = image.mimeType ?? 'image/jpeg';
      form.append('image[]', new Blob([new Uint8Array(data)], { type: mimeType }), `input-${index + 1}${extensionForMime(mimeType)}`);
    }
    const response = await this.request(() => this.fetcher(
      `${this.endpoint}/images/edits`,
      { method: 'POST', headers: { Authorization: `Bearer ${this.options.apiKey}` }, body: form },
    ));
    return this.readImage(response);
  }

  public async analyze(input: AnalyzeInput): Promise<AnalyzeResult> {
    if (!this.options.apiKey) throw new Error('OPENAI_API_KEY_MISSING');
    const response = await this.fetcher(`${this.endpoint}/responses`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.options.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-4.1-mini', input: input.prompt ?? 'Analyze this image.' }),
    });
    if (!response.ok) throw new Error('AI_PROVIDER_ERROR');
    return { text: JSON.stringify(await response.json()), metadata: { provider: 'openai' } };
  }

  private async readSource(image: ImageInput): Promise<Buffer> {
    if (this.options.sourceReader) return this.options.sourceReader(image.objectKey);
    const url = image.url ?? (image.objectKey.startsWith('http') ? image.objectKey : undefined);
    if (!url) throw new Error('AI_SOURCE_IMAGE_UNAVAILABLE');
    const response = await this.fetcher(url);
    if (!response.ok) throw new Error('AI_PROVIDER_ERROR');
    return Buffer.from(await response.arrayBuffer());
  }

  private async request(factory: () => Promise<Response>): Promise<Response> {
    try {
      return await factory();
    } catch (error) {
      const cause = error instanceof Error ? error.cause : undefined;
      const code = typeof cause === 'object' && cause && 'code' in cause ? String((cause as { code?: unknown }).code) : '';
      if (code === 'UND_ERR_CONNECT_TIMEOUT' || code === 'ETIMEDOUT' || code === 'ECONNRESET' || code === 'ENOTFOUND') {
        throw new Error('OPENAI_NETWORK_UNAVAILABLE');
      }
      throw new Error('OPENAI_REQUEST_FAILED');
    }
  }

  private async readImage(response: Response): Promise<ImageResult> {
    if (!response.ok) throw new Error(`AI_PROVIDER_ERROR:${response.status}`);
    const body = (await response.json()) as { data?: Array<{ url?: string; b64_json?: string }> };
    const image = body.data?.[0];
    if (!image) throw new Error('AI_PROVIDER_ERROR');
    if (image.b64_json) return { data: Buffer.from(image.b64_json, 'base64'), mimeType: 'image/png' };
    if (image.url) return { objectKey: image.url, mimeType: 'image/png' };
    throw new Error('AI_PROVIDER_ERROR');
  }
}

export class GeminiProvider implements ImageProvider {
  private readonly fetcher: typeof fetch;

  public constructor(private readonly options: GeminiProviderOptions) {
    this.fetcher = options.fetcher ?? compatibleFetch;
  }

  public async generate(input: GenerateInput): Promise<ImageResult> {
    return this.request(input, false);
  }

  public async edit(input: EditInput): Promise<ImageResult> {
    return this.request(input, true);
  }

  public async analyze(input: AnalyzeInput): Promise<AnalyzeResult> {
    if (!this.options.apiKey) throw new Error('GEMINI_API_KEY_MISSING');
    const parts: Array<Record<string, unknown>> = [];
    for (const image of input.images) {
      const data = await this.readSource(image);
      parts.push({ inlineData: { mimeType: image.mimeType ?? 'image/jpeg', data: data.toString('base64') } });
    }
    parts.push({ text: input.prompt ?? 'Analyze this image.' });
    const response = await this.fetcher(this.url('gemini-vision'), {
      method: 'POST',
      headers: { 'x-goog-api-key': this.options.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ role: 'user', parts }] }),
    });
    if (!response.ok) throw new Error(`AI_PROVIDER_ERROR:${response.status}`);
    const body = (await response.json()) as GeminiResponse;
    const text = body.candidates?.[0]?.content?.parts?.find((part) => typeof part.text === 'string')?.text;
    return { text: text ?? JSON.stringify(body), metadata: { provider: 'gemini' } };
  }

  private async request(input: GenerateInput, includeImages: boolean): Promise<ImageResult> {
    if (!this.options.apiKey) throw new Error('GEMINI_API_KEY_MISSING');
    const parts: Array<Record<string, unknown>> = [];
    if (includeImages) {
      for (const image of input.images) {
        const data = await this.readSource(image);
        parts.push({ inlineData: { mimeType: image.mimeType ?? 'image/jpeg', data: data.toString('base64') } });
      }
    }
    parts.push({ text: input.prompt });
    const response = await this.fetcher(this.url(input.model), {
      method: 'POST',
      headers: { 'x-goog-api-key': this.options.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: { responseModalities: ['IMAGE'] } }),
    });
    return this.readImage(response);
  }

  private url(model: string): string {
    const endpoint = this.options.endpoint ?? 'https://generativelanguage.googleapis.com/v1beta';
    return `${endpoint}/models/${model}:generateContent`;
  }

  private async readSource(image: ImageInput): Promise<Buffer> {
    if (this.options.sourceReader) return this.options.sourceReader(image.objectKey);
    const url = image.url ?? (image.objectKey.startsWith('http') ? image.objectKey : undefined);
    if (!url) throw new Error('AI_SOURCE_IMAGE_UNAVAILABLE');
    const response = await this.fetcher(url);
    if (!response.ok) throw new Error(`AI_PROVIDER_ERROR:${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  }

  private async readImage(response: Response): Promise<ImageResult> {
    if (!response.ok) throw new Error(`AI_PROVIDER_ERROR:${response.status}`);
    const body = (await response.json()) as GeminiResponse;
    const parts = body.candidates?.[0]?.content?.parts ?? [];
    const image = parts.find((part) => part.inlineData?.data);
    if (!image?.inlineData?.data) throw new Error('AI_PROVIDER_ERROR');
    return { data: Buffer.from(image.inlineData.data, 'base64'), mimeType: image.inlineData.mimeType ?? 'image/png' };
  }
}

export class QwenProvider implements ImageProvider {
  private readonly fetcher: typeof fetch;
  private readonly endpoint: string;
  private readonly compatibleMode: boolean;

  public constructor(private readonly options: QwenProviderOptions) {
    this.fetcher = options.fetcher ?? compatibleFetch;
    const endpoint = new URL(options.endpoint ?? 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation');
    const path = endpoint.pathname.replace(/\/+$/, '');
    this.compatibleMode = path.endsWith('/compatible-mode/v1') || path.endsWith('/chat/completions');
    endpoint.pathname = this.compatibleMode && !path.endsWith('/chat/completions') ? `${path}/chat/completions` : path;
    this.endpoint = endpoint.toString().replace(/\/+$/, '');
  }

  public async generate(input: GenerateInput): Promise<ImageResult> {
    return this.request(input, false);
  }

  public async edit(input: EditInput): Promise<ImageResult> {
    return this.request(input, true);
  }

  public async analyze(input: AnalyzeInput): Promise<AnalyzeResult> {
    if (!this.options.apiKey) throw new Error('QWEN_API_KEY_MISSING');
    void input;
    throw new Error('QWEN_ANALYZE_UNSUPPORTED');
  }

  private async request(input: GenerateInput, includeImages: boolean): Promise<ImageResult> {
    if (!this.options.apiKey) throw new Error('QWEN_API_KEY_MISSING');
    const imageInputs = includeImages ? await Promise.all(input.images.map(async (image) => {
      const data = await this.readSource(image);
      return `data:${image.mimeType ?? 'image/jpeg'};base64,${data.toString('base64')}`;
    })) : [];
    const content: Array<{ image?: string; text?: string }> = [
      ...imageInputs.map((image) => ({ image })),
      { text: input.prompt },
    ];
    const body = this.compatibleMode
      ? { model: input.model, messages: [{ role: 'user', content }] }
      : { model: input.model, input: { messages: [{ role: 'user', content }] }, parameters: { size: '1024*1024', result_format: 'message' } };
    const response = await this.fetcher(this.endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.options.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return this.readImage(response);
  }

  private async readSource(image: ImageInput): Promise<Buffer> {
    if (this.options.sourceReader) return this.options.sourceReader(image.objectKey);
    const url = image.url ?? (image.objectKey.startsWith('http') ? image.objectKey : undefined);
    if (!url) throw new Error('AI_SOURCE_IMAGE_UNAVAILABLE');
    const response = await this.fetcher(url);
    if (!response.ok) throw new Error(`AI_PROVIDER_ERROR:${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  }

  private async readImage(response: Response): Promise<ImageResult> {
    if (!response.ok) throw new Error(`AI_PROVIDER_ERROR:${response.status}`);
    const body = (await response.json()) as QwenResponse;
    const image = body.output?.results?.[0];
    const messageImage = body.output?.choices?.[0]?.message?.content?.find((item) => item.image)?.image;
    if (image?.b64_json) return { data: Buffer.from(image.b64_json, 'base64'), mimeType: image.mimeType ?? 'image/png' };
    if (image?.url) return { objectKey: image.url, mimeType: image.mimeType ?? 'image/png' };
    if (messageImage) return { objectKey: messageImage, mimeType: 'image/png' };
    if (body.output?.url) return { objectKey: body.output.url, mimeType: 'image/png' };
    throw new Error('AI_PROVIDER_ERROR');
  }
}

interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string; inlineData?: { mimeType?: string; data?: string } }> } }>;
}

interface QwenResponse {
  output?: {
    url?: string;
    results?: Array<{ url?: string; b64_json?: string; mimeType?: string }>;
    choices?: Array<{ message?: { content?: Array<{ image?: string; text?: string }> } }>;
  };
}

interface OpenAICompatibleAgentResponse {
  choices?: Array<{ message?: { tool_calls?: Array<{ type?: string; function?: { name?: string; arguments?: string } }> } }>;
}

const extensionForMime = (mimeType: string): string => mimeType === 'image/png' ? '.png' : mimeType === 'image/webp' ? '.webp' : '.jpg';

export class AIProviderManager {
  public constructor(private readonly providers: Map<string, ImageProvider>) {}

  public setProvider(type: string, provider: ImageProvider): void {
    this.providers.set(type, provider);
  }

  public getProvider(type: string): ImageProvider {
    const provider = this.providers.get(type);
    if (!provider) throw new Error(`PROVIDER_NOT_FOUND:${type}`);
    return provider;
  }
}
