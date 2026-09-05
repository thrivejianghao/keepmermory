import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { extname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { AIProviderManager, MockProvider, OpenAIProvider } from '@ai-photo/ai-provider';
import { InMemoryDatabase, type Database } from '@ai-photo/database';
import { SkillExecutor, SkillLoader, SkillRegistry, WorkflowExecutor } from '@ai-photo/skill-engine';
import { LocalStorageProvider } from '@ai-photo/storage';
import { InMemoryTaskQueue, TaskService, TaskWorker } from '@ai-photo/task';

export interface ApiServerOptions {
  skillsDir: string;
  storageDir: string;
  database?: Database;
  aiProvider?: 'mock' | 'openai';
  openAiApiKey?: string;
}

interface ApiRuntime {
  database: Database;
  registry: SkillRegistry;
  storage: LocalStorageProvider;
  tasks: TaskService;
}

export async function createApiServer(options: ApiServerOptions): Promise<Server> {
  const runtime = await createRuntime(options);
  return createServer((request, response) => {
    void route(runtime, request, response).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : 'INTERNAL_ERROR';
      const status = message.includes('NOT_FOUND') ? 404 : message.includes('INVALID') ? 400 : 500;
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
  const mock = new MockProvider({ sourceReader: (objectKey) => storage.read(objectKey) });
  const openai = new OpenAIProvider({ ...(options.openAiApiKey ? { apiKey: options.openAiApiKey } : {}) });
  const selected = options.aiProvider ?? 'mock';
  const providers = new AIProviderManager(new Map([['mock', mock], ['openai', selected === 'openai' ? openai : mock]]));
  const executor = new SkillExecutor(registry, new WorkflowExecutor(providers));
  const queue = new InMemoryTaskQueue();
  const tasks = new TaskService(database, queue, executor, storage);
  new TaskWorker(queue, tasks).start();
  return { database, registry, storage, tasks };
}

async function route(runtime: ApiRuntime, request: IncomingMessage, response: ServerResponse): Promise<void> {
  applyCors(response);
  if (request.method === 'OPTIONS') {
    response.writeHead(204).end();
    return;
  }
  const url = new URL(request.url ?? '/', 'http://localhost');
  const path = url.pathname;

  if (request.method === 'GET' && path === '/api/v1/health') {
    sendSuccess(response, { status: 'ok', provider: process.env.AI_PROVIDER ?? 'mock' });
    return;
  }
  if (request.method === 'GET' && path === '/api/v1/skills') {
    sendSuccess(response, runtime.registry.list().map(({ manifest }) => manifest));
    return;
  }
  const skillMatch = path.match(/^\/api\/v1\/skills\/([^/]+)$/);
  if (request.method === 'GET' && skillMatch?.[1]) {
    sendSuccess(response, runtime.registry.get(decodeURIComponent(skillMatch[1])).manifest);
    return;
  }
  if (request.method === 'POST' && path === '/api/v1/uploads') {
    const upload = await parseUpload(request);
    const extension = extname(upload.filename).toLowerCase() || extensionFor(upload.mimeType);
    const objectKey = `uploads/${randomUUID()}${extension}`;
    await runtime.storage.save(upload.data, objectKey);
    sendSuccess(response, { objectKey, url: await runtime.storage.getUrl(objectKey) });
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
    const task = await runtime.tasks.createTask({
      userId: 'dev-user',
      skillId: requireString(body.skillId, 'skillId'),
      input: { images: requireImages(body.images) },
      parameters: asObject(body.parameters) ?? {},
    });
    sendSuccess(response, { taskId: task.id, taskNo: task.taskNo, status: task.status });
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
    const tasks = (await runtime.database.listTasks('dev-user')).filter((task) => task.status === 'SUCCEEDED');
    const selected = tasks.slice((page - 1) * pageSize, page * pageSize);
    const items = await Promise.all(selected.map(async (task) => ({ task, outputs: await runtime.database.listTaskOutputs(task.id) })));
    sendSuccess(response, { items, page, pageSize, total: tasks.length });
    return;
  }
  if (request.method === 'GET' && path === '/api/v1/admin/tasks') {
    sendSuccess(response, await runtime.database.listTasks());
    return;
  }
  if (request.method === 'GET' && path === '/api/v1/admin/skills') {
    sendSuccess(response, await runtime.database.listSkills());
    return;
  }
  const adminSkillMatch = path.match(/^\/api\/v1\/admin\/skills\/([^/]+)\/status$/);
  if (request.method === 'POST' && adminSkillMatch?.[1]) {
    const current = await runtime.database.getSkill(adminSkillMatch[1]);
    if (!current) throw new Error('SKILL_NOT_FOUND');
    const body = await readJson(request);
    const status = requireString(body.status, 'status');
    if (!['DRAFT', 'TESTING', 'PUBLISHED', 'OFFLINE', 'DEPRECATED'].includes(status)) throw new Error('INVALID_INPUT:status');
    sendSuccess(response, await runtime.database.createSkill({ ...current, status: status as typeof current.status }));
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

function applyCors(response: ServerResponse): void {
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  response.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
}

function sendSuccess(response: ServerResponse, data: unknown): void {
  sendJson(response, 200, { code: 0, message: 'success', data });
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  const data = Buffer.from(JSON.stringify(body));
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': data.byteLength });
  response.end(data);
}
