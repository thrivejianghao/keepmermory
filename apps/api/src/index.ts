import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { extname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { AIProviderManager, compatibleFetch, GeminiProvider, MockProvider, OpenAICompatibleSkillAgent, OpenAIProvider, QwenProvider, type AIModelOption, type ImageProvider } from '@ai-photo/ai-provider';
import { InMemoryDatabase, type Database } from '@ai-photo/database';
import { SkillExecutor, SkillLoader, SkillRegistry, WorkflowExecutor } from '@ai-photo/skill-engine';
import { LocalStorageProvider } from '@ai-photo/storage';
import { InMemoryTaskQueue, TaskService, TaskWorker } from '@ai-photo/task';
import { loadModelConfig, providerConfig, providerKey, saveModelConfig, toPublicModelConfig, type ModelConfigInput, type RuntimeModelConfig } from './model-config.js';
import { SkillAdminService, type AdminSkillInput } from './skill-admin.js';
import { WorkService } from './work-service.js';

export interface ApiServerOptions {
  skillsDir: string;
  storageDir: string;
  database?: Database;
  aiProvider?: 'mock' | 'openai' | 'gemini' | 'qwen';
  openAiApiKey?: string;
  geminiApiKey?: string;
  qwenApiKey?: string;
  configFile?: string;
  skillCatalogFile?: string;
}

interface ApiRuntime {
  database: Database;
  registry: SkillRegistry;
  storage: LocalStorageProvider;
  tasks: TaskService;
  models: AIModelOption[];
  providerId: 'mock' | 'openai' | 'gemini' | 'qwen';
  modelConfig: RuntimeModelConfig;
  providers: AIProviderManager;
  workflow: WorkflowExecutor;
  configFile: string;
  configUpdate?: Promise<void>;
  skillAdmin: SkillAdminService;
  works: WorkService;
}

export async function createApiServer(options: ApiServerOptions): Promise<Server> {
  const runtime = await createRuntime(options);
  return createServer((request, response) => {
    void route(runtime, request, response).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : 'INTERNAL_ERROR';
      const status = message === 'ADMIN_CONFIG_FORBIDDEN' ? 403 : message === 'SKILL_ALREADY_EXISTS' || message === 'SKILL_IN_USE' ? 409 : message.includes('NOT_FOUND') ? 404 : message.includes('INVALID') || message.startsWith('MODEL_UNAVAILABLE') ? 400 : 500;
      sendJson(response, status, { code: status === 500 ? 50001 : 40001, message, data: null });
    });
  });
}

async function createRuntime(options: ApiServerOptions): Promise<ApiRuntime> {
  const database = options.database ?? new InMemoryDatabase();
  const storage = new LocalStorageProvider({ rootDir: options.storageDir });
  const registry = new SkillRegistry(new SkillLoader(options.skillsDir));
  await registry.reload();
  await database.ensureDevUser();
  for (const { manifest, content } of registry.list()) {
    await database.createSkill({
      id: manifest.id,
      name: manifest.name,
      description: manifest.description,
      category: manifest.category,
      status: 'PUBLISHED',
      currentVersion: manifest.version,
    });
    if (!(await database.getSkillVersion(manifest.id, manifest.version))) {
      await database.createSkillVersion({
        skillId: manifest.id,
        version: manifest.version,
        status: 'PUBLISHED',
        manifest: manifest as unknown as Record<string, unknown>,
        content,
        inputSchema: { images: manifest.input.images, parameters: manifest.parameters },
        workflowConfig: manifest.workflow as unknown as Record<string, unknown>,
        providerId: manifest.provider.type,
        modelId: manifest.provider.model,
      });
    }
  }
  const skillCatalogFile = options.skillCatalogFile ?? join(options.storageDir, '..', '.local', 'skill-catalog.json');
  const skillAdmin = new SkillAdminService(database, registry, skillCatalogFile);
  await skillAdmin.initialize();
  const configFile = options.configFile ?? process.env.MODEL_CONFIG_FILE ?? join(options.storageDir, '..', '.local', 'model-config.json');
  const modelConfig = await loadModelConfig(configFile, {
    ...process.env,
    ...(options.openAiApiKey !== undefined ? { OPENAI_API_KEY: options.openAiApiKey } : {}),
    ...(options.geminiApiKey !== undefined ? { GEMINI_API_KEY: options.geminiApiKey } : {}),
    ...(options.qwenApiKey !== undefined ? { DASHSCOPE_API_KEY: options.qwenApiKey } : {}),
    ...(options.aiProvider !== undefined ? { AI_PROVIDER: options.aiProvider } : {}),
  });
  const mock = new MockProvider({ sourceReader: (objectKey) => storage.read(objectKey) });
  const providers = new AIProviderManager(new Map<string, ImageProvider>([['mock', mock]]));
  configureProviders(providers, modelConfig, storage);
  const workflow = new WorkflowExecutor(providers);
  configureSkillAgent(workflow, modelConfig);
  const executor = new SkillExecutor(registry, workflow);
  const queue = new InMemoryTaskQueue();
  const tasks = new TaskService(database, queue, executor, storage, compatibleFetch);
  const works = new WorkService(database);
  new TaskWorker(queue, tasks).start();
  return { database, registry, storage, tasks, providerId: modelConfig.defaultProvider, models: modelOptions(modelConfig), modelConfig, providers, workflow, configFile, skillAdmin, works };
}

async function route(runtime: ApiRuntime, request: IncomingMessage, response: ServerResponse): Promise<void> {
  const configRoute = request.url?.split('?')[0] === '/api/v1/admin/model-config';
  const skillAdminRoute = request.url?.split('?')[0]?.startsWith('/api/v1/admin/skills') === true;
  if (configRoute || skillAdminRoute) {
    assertLocalAdminRequest(request);
    response.setHeader('Cache-Control', 'no-store');
    if (request.headers.origin) response.setHeader('Access-Control-Allow-Origin', request.headers.origin);
    response.setHeader('Vary', 'Origin');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type,X-Admin-Config');
    response.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  } else applyCors(response);
  if (request.method === 'OPTIONS') {
    response.writeHead(204).end();
    return;
  }
  const url = new URL(request.url ?? '/', 'http://localhost');
  const path = url.pathname;

  if (configRoute && request.method === 'GET') {
    sendSuccess(response, toPublicModelConfig(runtime.modelConfig));
    return;
  }
  if (configRoute && request.method === 'POST') {
    const body = await readJson(request);
    await updateModelConfig(runtime, body as unknown as ModelConfigInput);
    sendSuccess(response, toPublicModelConfig(runtime.modelConfig));
    return;
  }

  if (request.method === 'GET' && path === '/api/v1/health') {
    sendSuccess(response, { status: 'ok', provider: runtime.providerId, model: runtime.models.find((item) => item.providerId === runtime.providerId)?.modelId });
    return;
  }
  if (request.method === 'GET' && path === '/api/v1/skills') {
    sendSuccess(response, await listPublicSkills(runtime));
    return;
  }
  if (request.method === 'GET' && path === '/api/v1/models') {
    sendSuccess(response, { items: runtime.models, default: runtime.models.find((item) => item.available) ?? runtime.models[0] });
    return;
  }
  const skillMatch = path.match(/^\/api\/v1\/skills\/([^/]+)$/);
  if (request.method === 'GET' && skillMatch?.[1]) {
    sendSuccess(response, await getPublicSkill(runtime, decodeURIComponent(skillMatch[1])));
    return;
  }
  if (request.method === 'POST' && path === '/api/v1/uploads') {
    const upload = await parseUpload(request);
    const extension = extname(upload.filename).toLowerCase() || extensionFor(upload.mimeType);
    const objectKey = `uploads/${randomUUID()}${extension}`;
    await runtime.storage.save(upload.data, objectKey);
    sendSuccess(response, { objectKey, url: await runtime.storage.getUrl(objectKey), mimeType: upload.mimeType });
    return;
  }
  const fileMatch = path.match(/^\/api\/v1\/files\/(.+)$/);
  if (request.method === 'GET' && fileMatch?.[1]) {
    const objectKey = fileMatch[1].split('/').map(decodeURIComponent).join('/');
    const data = await runtime.storage.read(objectKey);
    response.writeHead(200, { 'Content-Type': mimeFor(objectKey), 'Content-Length': data.byteLength });
    response.end(data);
    return;
  }
  if (request.method === 'POST' && path === '/api/v1/tasks') {
    const body = await readJson(request);
    const skillId = requireString(body.skillId, 'skillId');
    const skill = await runtime.database.getSkill(skillId);
    if (!skill || skill.status !== 'PUBLISHED') throw new Error('SKILL_NOT_FOUND');
    const model = resolveModel(runtime.models, body.providerId, body.modelId);
    const task = await runtime.tasks.createTask({
      userId: 'dev-user',
      skillId,
      providerId: model.providerId,
      modelId: model.modelId,
      input: { images: requireImages(body.images) },
      parameters: asObject(body.parameters) ?? {},
    });
    sendSuccess(response, { taskId: task.id, taskNo: task.taskNo, status: task.status, providerId: task.providerId, modelId: task.modelId });
    return;
  }
  const taskMatch = path.match(/^\/api\/v1\/tasks\/([^/]+)$/);
  if (request.method === 'GET' && taskMatch?.[1]) {
    const task = await runtime.database.getTask(taskMatch[1]);
    if (!task) throw new Error('TASK_NOT_FOUND');
    sendSuccess(response, task);
    return;
  }
  const resultMatch = path.match(/^\/api\/v1\/tasks\/([^/]+)\/result$/);
  if (request.method === 'GET' && resultMatch?.[1]) {
    const task = await runtime.database.getTask(resultMatch[1]);
    if (!task) throw new Error('TASK_NOT_FOUND');
    const outputs = await runtime.database.listTaskOutputs(task.id);
    sendSuccess(response, {
      task,
      outputs: await Promise.all(outputs.map(async (output) => ({ ...output, url: await runtime.storage.getUrl(output.objectKey) }))),
    });
    return;
  }
  const cancelMatch = path.match(/^\/api\/v1\/tasks\/([^/]+)\/cancel$/);
  if (request.method === 'POST' && cancelMatch?.[1]) {
    sendSuccess(response, await runtime.tasks.cancelTask(cancelMatch[1]));
    return;
  }
  if (request.method === 'GET' && path === '/api/v1/works') {
    const page = Math.max(1, Number(url.searchParams.get('page') ?? '1'));
    const pageSize = Math.min(50, Math.max(1, Number(url.searchParams.get('pageSize') ?? '20')));
    sendSuccess(response, await runtime.works.list('dev-user', page, pageSize));
    return;
  }
  const workMatch = path.match(/^\/api\/v1\/works\/([^/]+)$/);
  if (request.method === 'DELETE' && workMatch?.[1]) {
    sendSuccess(response, await runtime.works.remove('dev-user', decodeURIComponent(workMatch[1])));
    return;
  }
  if (request.method === 'GET' && path === '/api/v1/admin/tasks') {
    sendSuccess(response, await runtime.database.listTasks());
    return;
  }
  if (request.method === 'GET' && path === '/api/v1/admin/skills') {
    sendSuccess(response, await runtime.skillAdmin.list());
    return;
  }
  if (request.method === 'POST' && path === '/api/v1/admin/skills') {
    sendSuccess(response, await runtime.skillAdmin.create(await readJson(request) as AdminSkillInput));
    return;
  }
  const adminSkillDetailMatch = path.match(/^\/api\/v1\/admin\/skills\/([^/]+)$/);
  if (request.method === 'GET' && adminSkillDetailMatch?.[1]) {
    sendSuccess(response, runtime.skillAdmin.get(decodeURIComponent(adminSkillDetailMatch[1])));
    return;
  }
  if (request.method === 'PUT' && adminSkillDetailMatch?.[1]) {
    sendSuccess(response, await runtime.skillAdmin.update(decodeURIComponent(adminSkillDetailMatch[1]), await readJson(request) as AdminSkillInput));
    return;
  }
  if (request.method === 'DELETE' && adminSkillDetailMatch?.[1]) {
    sendSuccess(response, await runtime.skillAdmin.delete(decodeURIComponent(adminSkillDetailMatch[1])));
    return;
  }
  const adminSkillMatch = path.match(/^\/api\/v1\/admin\/skills\/([^/]+)\/status$/);
  if (request.method === 'POST' && adminSkillMatch?.[1]) {
    const body = await readJson(request);
    sendSuccess(response, await runtime.skillAdmin.setStatus(decodeURIComponent(adminSkillMatch[1]), body.status));
    return;
  }
  sendJson(response, 404, { code: 40401, message: 'NOT_FOUND', data: null });
}

async function parseUpload(request: IncomingMessage): Promise<{ data: Buffer; filename: string; mimeType: string }> {
  const contentType = request.headers['content-type'] ?? '';
  const boundary = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/)?.slice(1).find(Boolean);
  if (!boundary) throw new Error('INVALID_INPUT:multipart boundary');
  const body = await readBody(request);
  const marker = Buffer.from(`--${boundary}`);
  let cursor = 0;
  while ((cursor = body.indexOf(marker, cursor)) !== -1) {
    const headerStart = cursor + marker.length + 2;
    const headerEnd = body.indexOf(Buffer.from('\r\n\r\n'), headerStart);
    if (headerEnd === -1) break;
    const headers = body.subarray(headerStart, headerEnd).toString('utf8');
    const filename = headers.match(/filename="([^"]+)"/)?.[1];
    if (filename) {
      const dataStart = headerEnd + 4;
      const dataEnd = body.indexOf(Buffer.from(`\r\n--${boundary}`), dataStart);
      if (dataEnd === -1) throw new Error('UPLOAD_ERROR');
      return { data: body.subarray(dataStart, dataEnd), filename, mimeType: headers.match(/Content-Type:\s*([^\r\n]+)/i)?.[1] ?? 'application/octet-stream' };
    }
    cursor = headerEnd + 4;
  }
  throw new Error('INVALID_INPUT:file is required');
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const text = (await readBody(request)).toString('utf8');
  try { return JSON.parse(text) as Record<string, unknown>; } catch { throw new Error('INVALID_INPUT:json'); }
}

async function readBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > 12 * 1024 * 1024) throw new Error('UPLOAD_ERROR:file too large');
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

const requireString = (value: unknown, name: string): string => {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`INVALID_INPUT:${name}`);
  return value;
};

const requireOptionalString = (value: unknown, name: string): string | undefined => {
  if (value === undefined || value === null || value === '') return undefined;
  return requireString(value, name);
};

const modelOptions = (config: RuntimeModelConfig): AIModelOption[] => {
  const mock: AIModelOption = { providerId: 'mock', modelId: 'image-default', name: 'Mock Image', description: '本地 Mock 模型，复制输入图片验证完整链路', requiresApiKey: false, available: true };
  const all: AIModelOption[] = toPublicModelConfig(config).providers.map((provider) => ({
    providerId: provider.providerId, modelId: provider.modelId, name: provider.name,
    description: provider.keyConfigured ? '已配置密钥，图像权限以服务商为准' : '需要在后台配置服务端密钥',
    requiresApiKey: true, available: provider.enabled && provider.keyConfigured,
  }));
  if (config.defaultProvider === 'mock') return [mock, ...all];
  return [...all.filter((item) => item.providerId === config.defaultProvider), mock, ...all.filter((item) => item.providerId !== config.defaultProvider)];
};

const resolveModel = (models: AIModelOption[], providerValue: unknown, modelValue: unknown): AIModelOption => {
  const providerId = requireOptionalString(providerValue, 'providerId');
  const modelId = requireOptionalString(modelValue, 'modelId');
  const selected = models.find((item) => (!providerId || item.providerId === providerId) && (!modelId || item.modelId === modelId));
  if (!selected) throw new Error('INVALID_INPUT:model');
  if (!selected.available) throw new Error(`MODEL_UNAVAILABLE:${selected.providerId}/${selected.modelId}`);
  return selected;
};

const asObject = (value: unknown): Record<string, unknown> | undefined => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

const requireImages = (value: unknown): Array<{ objectKey: string; mimeType?: string }> => {
  if (!Array.isArray(value)) throw new Error('INVALID_INPUT:images');
  return value.map((item) => {
    const object = asObject(item);
    const objectKey = requireString(object?.objectKey, 'images.objectKey');
    const mimeType = typeof object?.mimeType === 'string' ? object.mimeType : undefined;
    return { objectKey, ...(mimeType ? { mimeType } : {}) };
  });
};

const extensionFor = (mimeType: string): string => mimeType === 'image/png' ? '.png' : mimeType === 'image/webp' ? '.webp' : '.jpg';
const mimeFor = (objectKey: string): string => objectKey.endsWith('.png') ? 'image/png' : objectKey.endsWith('.webp') ? 'image/webp' : 'image/jpeg';

function configureProviders(manager: AIProviderManager, config: RuntimeModelConfig, storage: LocalStorageProvider): void {
  const sourceReader = (objectKey: string) => storage.read(objectKey);
  for (const id of ['openai', 'gemini', 'qwen'] as const) {
    const key = providerKey(config, id);
    const options = { endpoint: providerConfig(config, id).endpoint, ...(key ? { apiKey: key } : {}), sourceReader };
    manager.setProvider(id, id === 'openai' ? new OpenAIProvider(options) : id === 'gemini' ? new GeminiProvider(options) : new QwenProvider(options));
  }
}

function configureSkillAgent(workflow: WorkflowExecutor, config: RuntimeModelConfig): void {
  const agent = config.skillAgent;
  workflow.setSkillAgent(agent.enabled && agent.apiKey ? new OpenAICompatibleSkillAgent({
    endpoint: agent.endpoint,
    apiKey: agent.apiKey,
    model: agent.modelId,
  }) : undefined);
}

function updateModelConfig(runtime: ApiRuntime, input: ModelConfigInput): Promise<void> {
  // Serialize saves so a failed or overlapping write cannot activate an unsaved key.
  const update = (runtime.configUpdate ?? Promise.resolve()).then(async () => {
    const config = await saveModelConfig(runtime.configFile, runtime.modelConfig, input);
    configureProviders(runtime.providers, config, runtime.storage);
    configureSkillAgent(runtime.workflow, config);
    runtime.modelConfig = config;
    runtime.providerId = config.defaultProvider;
    runtime.models = modelOptions(config);
  });
  runtime.configUpdate = update.catch(() => {});
  return update;
}

function assertLocalAdminRequest(request: IncomingMessage): void {
  const remote = request.socket.remoteAddress;
  const localHosts = ['127.0.0.1', 'localhost', '[::1]'];
  let host: URL;
  try { host = new URL(`http://${request.headers.host}`); } catch { throw new Error('ADMIN_CONFIG_FORBIDDEN'); }
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote ?? '') || !localHosts.includes(host.hostname) || host.username || host.password) throw new Error('ADMIN_CONFIG_FORBIDDEN');
  if (request.headers.origin) {
    let origin: URL;
    try { origin = new URL(request.headers.origin); } catch { throw new Error('ADMIN_CONFIG_FORBIDDEN'); }
    if (!localHosts.includes(origin.hostname) || !['http:', 'https:'].includes(origin.protocol)) throw new Error('ADMIN_CONFIG_FORBIDDEN');
  }
  if (request.method !== 'OPTIONS' && request.headers['x-admin-config'] !== '1') throw new Error('ADMIN_CONFIG_FORBIDDEN');
  if (request.method === 'POST' && request.headers['content-type']?.split(';')[0] !== 'application/json') throw new Error('INVALID_INPUT:json');
}

function applyCors(response: ServerResponse): void {
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  response.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
}

async function listPublicSkills(runtime: ApiRuntime): Promise<Array<Record<string, unknown>>> {
  const records = await runtime.database.listSkills({ status: 'PUBLISHED' });
  const skills: Array<Record<string, unknown>> = [];
  for (const record of records) {
    try {
      const manifest = runtime.registry.get(record.id).manifest;
      skills.push({ ...manifest, name: record.name, description: record.description, category: record.category, ...(record.coverUrl ? { coverUrl: record.coverUrl } : {}) });
    } catch {
      // Published records without an executable manifest are not exposed to clients.
    }
  }
  return skills;
}

async function getPublicSkill(runtime: ApiRuntime, id: string): Promise<Record<string, unknown>> {
  const record = await runtime.database.getSkill(id);
  if (!record || record.status !== 'PUBLISHED') throw new Error('SKILL_NOT_FOUND');
  const manifest = runtime.registry.get(id).manifest;
  return { ...manifest, name: record.name, description: record.description, category: record.category, ...(record.coverUrl ? { coverUrl: record.coverUrl } : {}) };
}

function sendSuccess(response: ServerResponse, data: unknown): void {
  sendJson(response, 200, { code: 0, message: 'success', data });
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  const data = Buffer.from(JSON.stringify(body));
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': data.byteLength });
  response.end(data);
}
