import './setup';
import { createApiClient, type ApiClient, type Skill, type Task } from '../services/api';
import { createSkillService } from '../services/skill-service';
import { createTaskService, describeTask } from '../services/task-service';
import { createUploadService } from '../services/upload-service';
import { createWorkService } from '../services/work-service';

type AsyncTest = () => void | Promise<void>;

const tests: Array<{ name: string; run: AsyncTest }> = [];
const test = (name: string, run: AsyncTest): void => { tests.push({ name, run }); };
const equal = (actual: unknown, expected: unknown, message = 'values differ'): void => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}\nexpected: ${JSON.stringify(expected)}\nactual: ${JSON.stringify(actual)}`);
  }
};
const rejects = async (operation: () => Promise<unknown>, message: string): Promise<void> => {
  try { await operation(); } catch (reason) {
    if (reason instanceof Error && reason.message === message) return;
    throw new Error(`expected rejection ${message}, received ${String(reason)}`);
  }
  throw new Error(`expected rejection ${message}`);
};

const skill: Skill = {
  id: 'portrait', name: 'Portrait', description: 'A portrait', category: 'people', version: '1.0.0',
  input: { images: { min: 1, max: 2 } },
  parameters: {
    style: { type: 'select', label: 'Style', default: 'film', options: [{ label: 'Film', value: 'film' }, { label: 'Clean', value: 'clean' }] },
    title: { type: 'string', label: 'Title', default: 'Hello' },
    strength: { type: 'number', label: 'Strength', default: 2 },
    keepFace: { type: 'boolean', label: 'Keep face', default: true },
  },
};

test('API client rejects HTTP and application errors instead of treating them as success', async () => {
  const runtime = {
    request(options: Record<string, unknown>) {
      (options.success as (value: unknown) => void)({ statusCode: 503, data: { code: 50001, message: 'SERVICE_DOWN', data: null } });
    },
    uploadFile() { throw new Error('unused'); },
  };
  const client = createApiClient(runtime, () => 'http://127.0.0.1:3000/api/v1');
  await rejects(() => client.skills(), 'SERVICE_DOWN');
});

test('API client rejects an unsuccessful upload response', async () => {
  const runtime = {
    request() { throw new Error('unused'); },
    uploadFile(options: Record<string, unknown>) {
      (options.success as (value: unknown) => void)({ statusCode: 413, data: JSON.stringify({ code: 40001, message: 'UPLOAD_TOO_LARGE', data: null }) });
    },
  };
  const client = createApiClient(runtime, () => 'http://127.0.0.1:3000/api/v1');
  await rejects(() => client.upload('large.jpg'), 'UPLOAD_TOO_LARGE');
});

test('Skill service converts every manifest parameter type without skill-specific branches', () => {
  const service = createSkillService({} as ApiClient);
  equal(service.parameterFields(skill), [
    { key: 'style', label: 'Style', type: 'select', value: 'film', options: [{ label: 'Film', value: 'film' }, { label: 'Clean', value: 'clean' }], optionIndex: 0 },
    { key: 'title', label: 'Title', type: 'string', value: 'Hello', options: [], optionIndex: 0 },
    { key: 'strength', label: 'Strength', type: 'number', value: 2, options: [], optionIndex: 0 },
    { key: 'keepFace', label: 'Keep face', type: 'boolean', value: true, options: [], optionIndex: 0 },
  ]);
});

test('Skill service rejects values that violate the manifest definition', () => {
  const service = createSkillService({} as ApiClient);
  let message = '';
  try { service.validateParameters(skill, { style: 'unknown', title: 'Hi', strength: 2, keepFace: true }); } catch (reason) { message = reason instanceof Error ? reason.message : ''; }
  equal(message, 'Style 参数无效');
});

test('Upload service compresses large images and uploads the compressed path', async () => {
  const uploaded: string[] = [];
  const client = { upload: async (path: string) => { uploaded.push(path); return { objectKey: 'uploads/photo.jpg', url: '/api/v1/files/uploads/photo.jpg', mimeType: 'image/jpeg' }; } } as ApiClient;
  const media = {
    chooseMedia() { throw new Error('unused'); },
    compressImage(options: Record<string, unknown>) { (options.success as (value: unknown) => void)({ tempFilePath: 'compressed.jpg' }); },
  };
  const service = createUploadService(client, media);
  const result = await service.prepareAndUpload([{ path: 'original.jpg', size: 2 * 1024 * 1024 }]);
  equal(uploaded, ['compressed.jpg']);
  equal(result[0]?.objectKey, 'uploads/photo.jpg');
});

test('Upload service reports a recoverable error when album permission is denied', async () => {
  const client = {} as ApiClient;
  const media = {
    chooseMedia() { throw new Error('unused'); },
    compressImage() { throw new Error('unused'); },
    downloadFile(options: Record<string, unknown>) { (options.success as (value: unknown) => void)({ statusCode: 200, tempFilePath: 'result.jpg' }); },
    saveImageToPhotosAlbum(options: Record<string, unknown>) { (options.fail as (value: unknown) => void)({ errMsg: 'saveImageToPhotosAlbum:fail auth deny' }); },
  };
  const service = createUploadService(client, media);
  await rejects(() => service.saveToAlbum('https://example.com/result.jpg'), 'PHOTO_ALBUM_PERMISSION_DENIED');
});

test('Upload service rejects images whose shortest edge is too small', async () => {
  const service = createUploadService({ upload: async () => { throw new Error('must not upload'); } } as unknown as ApiClient, {
    chooseMedia() { throw new Error('unused'); },
    compressImage() { throw new Error('unused'); },
  });
  await rejects(() => service.prepareAndUpload([{ path: 'tiny.jpg', size: 12000, width: 220, height: 800 }]), '图片尺寸过小，短边至少需要 256 像素');
});

test('Task status mapping covers retry, failure, cancellation, and completion', () => {
  const base = { id: '1', taskNo: 'TASK-1', skillId: 'portrait', progress: 50 };
  equal(describeTask({ ...base, status: 'RETRYING' }), { label: '正在重新尝试', detail: '网络有些波动，正在继续完成作品', terminal: false, succeeded: false, failed: false });
  equal(describeTask({ ...base, status: 'FAILED' }), { label: '生成失败', detail: '这次没有完成，可以重新生成', terminal: true, succeeded: false, failed: true });
  equal(describeTask({ ...base, status: 'CANCELLED' }), { label: '任务已取消', detail: '可以返回后重新开始', terminal: true, succeeded: false, failed: true });
  equal(describeTask({ ...base, status: 'SUCCEEDED' }), { label: '作品已完成', detail: '正在打开结果', terminal: true, succeeded: true, failed: false });
});

test('Task service sends the backend objectKey contract when creating a task', async () => {
  let payload: unknown;
  const client = { createTask: async (value: unknown) => { payload = value; return { taskId: '1', taskNo: 'TASK-1', status: 'PENDING', providerId: 'mock', modelId: 'image-default' }; } } as ApiClient;
  const service = createTaskService(client);
  await service.create({ skillId: 'portrait', providerId: 'mock', modelId: 'image-default', uploads: [{ objectKey: 'uploads/a.jpg', url: '/a', mimeType: 'image/jpeg' }], parameters: { style: 'film' } });
  equal(payload, { skillId: 'portrait', providerId: 'mock', modelId: 'image-default', images: [{ objectKey: 'uploads/a.jpg', mimeType: 'image/jpeg' }], parameters: { style: 'film' } });
});

test('Work service resolves result URLs and delegates deletion to the works endpoint', async () => {
  let deleted = '';
  const task: Task = { id: '8', taskNo: 'TASK-8', skillId: 'portrait', status: 'SUCCEEDED', progress: 100 };
  const client = {
    works: async () => ({ items: [{ task, outputs: [{ objectKey: 'outputs/a.jpg' }] }], page: 1, pageSize: 20, total: 1 }),
    fileUrl: (value: string) => `http://127.0.0.1:3000/api/v1/files/${value}`,
    deleteWork: async (id: string) => { deleted = id; },
  } as ApiClient;
  const service = createWorkService(client);
  const page = await service.list(1);
  equal(page.items[0]?.outputs[0]?.url, 'http://127.0.0.1:3000/api/v1/files/outputs/a.jpg');
  await service.remove('8');
  equal(deleted, '8');
});

async function main(): Promise<void> {
  for (const item of tests) {
    await item.run();
    console.log(`PASS ${item.name}`);
  }
  console.log(`Mini Program service tests passed (${tests.length})`);
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  throw error;
});
