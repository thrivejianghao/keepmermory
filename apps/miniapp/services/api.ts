export type TaskStatus = 'PENDING' | 'QUEUED' | 'PROCESSING' | 'RETRYING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';
export type ParameterValue = string | number | boolean;

export interface SkillParameterDefinition {
  type: 'string' | 'number' | 'boolean' | 'select';
  label: string;
  default?: ParameterValue;
  options?: Array<{ label: string; value: string }>;
}

export interface Skill {
  id: string;
  name: string;
  description: string;
  category: string;
  version: string;
  status?: string;
  coverUrl?: string;
  input: { images: { min: number; max: number } };
  parameters: Record<string, SkillParameterDefinition>;
}

export interface Task {
  id: string;
  taskNo: string;
  skillId: string;
  status: TaskStatus;
  progress: number;
  input?: { images: Array<{ objectKey: string; mimeType?: string }> };
  parameters?: Record<string, unknown>;
  providerId?: string;
  modelId?: string;
  errorMessage?: string;
}

export interface AIModel {
  providerId: string;
  modelId: string;
  name: string;
  description: string;
  available: boolean;
}

export interface UploadResult { objectKey: string; url: string; mimeType: string }
export interface TaskOutput { objectKey: string; url?: string; mimeType?: string }
export interface TaskResult { task: Task; outputs: TaskOutput[] }
export interface WorkPage { items: Array<{ task: Task; outputs: TaskOutput[] }>; page: number; pageSize: number; total: number }

interface ApiResponse<T> { code: number; message: string; data: T }
interface RequestResult { data: unknown; statusCode: number }
interface UploadFileResult { data: string; statusCode: number }

export interface WxApiRuntime {
  request(options: Record<string, unknown>): void;
  uploadFile(options: Record<string, unknown>): void;
}

export interface ApiClient {
  skills(): Promise<Skill[]>;
  skill(id: string): Promise<Skill>;
  models(): Promise<{ items: AIModel[]; default?: AIModel }>;
  task(id: string): Promise<Task>;
  result(id: string): Promise<TaskResult>;
  works(page?: number, pageSize?: number): Promise<WorkPage>;
  createTask(data: { skillId: string; providerId: string; modelId: string; images: Array<{ objectKey: string; mimeType?: string }>; parameters: Record<string, unknown> }): Promise<{ taskId: string; taskNo: string; status: string; providerId: string; modelId: string }>;
  upload(filePath: string): Promise<UploadResult>;
  deleteWork(id: string): Promise<void>;
  fileUrl(pathOrUrl: string): string;
}

const parseBody = <T>(value: unknown): ApiResponse<T> => {
  if (!value || typeof value !== 'object') throw new Error('服务响应无效');
  const body = value as Partial<ApiResponse<T>>;
  if (typeof body.code !== 'number' || typeof body.message !== 'string') throw new Error('服务响应无效');
  return body as ApiResponse<T>;
};

const errorMessage = (reason: unknown, fallback: string): string => {
  if (reason && typeof reason === 'object' && 'errMsg' in reason && typeof reason.errMsg === 'string') {
    return reason.errMsg.includes('timeout') ? '请求超时，请检查网络后重试' : fallback;
  }
  return reason instanceof Error ? reason.message : fallback;
};

const asError = (reason: unknown, fallback: string): Error => reason instanceof Error ? reason : new Error(fallback);

export function createApiClient(runtime: WxApiRuntime, getBaseUrl: () => string): ApiClient {
  const request = <T>(path: string, method: 'GET' | 'POST' | 'DELETE' = 'GET', data?: unknown): Promise<T> => new Promise((resolve, reject) => {
    runtime.request({
      url: `${getBaseUrl()}${path}`,
      method,
      data,
      timeout: 15000,
      header: { 'Content-Type': 'application/json' },
      success: (result: RequestResult) => {
        try {
          const body = parseBody<T>(result.data);
          if (result.statusCode < 200 || result.statusCode >= 300 || body.code !== 0) throw new Error(body.message || `请求失败 (${result.statusCode})`);
          resolve(body.data);
        } catch (reason) { reject(asError(reason, '服务响应无效')); }
      },
      fail: (reason: unknown) => reject(new Error(errorMessage(reason, '网络连接失败，请稍后重试'))),
    });
  });

  const upload = (filePath: string): Promise<UploadResult> => new Promise((resolve, reject) => {
    runtime.uploadFile({
      url: `${getBaseUrl()}/uploads`,
      filePath,
      name: 'file',
      timeout: 30000,
      success: (result: UploadFileResult) => {
        try {
          const body = parseBody<UploadResult>(JSON.parse(result.data) as unknown);
          if (result.statusCode < 200 || result.statusCode >= 300 || body.code !== 0) throw new Error(body.message || `上传失败 (${result.statusCode})`);
          resolve(body.data);
        } catch (reason) { reject(reason instanceof SyntaxError ? new Error('上传响应无效') : asError(reason, '图片上传失败')); }
      },
      fail: (reason: unknown) => reject(new Error(errorMessage(reason, '图片上传失败，请稍后重试'))),
    });
  });

  const fileUrl = (pathOrUrl: string): string => {
    if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
    const base = getBaseUrl();
    if (pathOrUrl.startsWith('/')) {
      const origin = base.match(/^https?:\/\/[^/]+/i)?.[0] ?? '';
      return `${origin}${pathOrUrl}`;
    }
    return `${base}/files/${pathOrUrl.split('/').map(encodeURIComponent).join('/')}`;
  };

  return {
    skills: () => request<Skill[]>('/skills'),
    skill: (id) => request<Skill>(`/skills/${encodeURIComponent(id)}`),
    models: () => request<{ items: AIModel[]; default?: AIModel }>('/models'),
    task: (id) => request<Task>(`/tasks/${encodeURIComponent(id)}`),
    result: (id) => request<TaskResult>(`/tasks/${encodeURIComponent(id)}/result`),
    works: (page = 1, pageSize = 20) => request<WorkPage>(`/works?page=${page}&pageSize=${pageSize}`),
    createTask: (data) => request('/tasks', 'POST', data),
    upload,
    deleteWork: (id) => request<void>(`/works/${encodeURIComponent(id)}`, 'DELETE'),
    fileUrl,
  };
}

export const api = createApiClient(wx, () => getApp().globalData.apiBaseUrl);
