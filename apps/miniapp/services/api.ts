export interface Skill { id: string; name: string; description: string; category: string; version: string; coverUrl?: string; input: { images: { min: number; max: number } }; parameters: Record<string, { type: string; label: string; default?: string; options?: Array<{ label: string; value: string }> }> }
export interface Task { id: string; taskNo: string; skillId: string; status: string; progress: number; errorMessage?: string }
interface ApiResponse<T> { code: number; message: string; data: T }
const baseUrl = (): string => getApp().globalData.apiBaseUrl;

function request<T>(path: string, method: 'GET' | 'POST' = 'GET', data?: unknown): Promise<T> {
  return new Promise((resolve, reject) => wx.request({ url: `${baseUrl()}${path}`, method, data, header: { 'Content-Type': 'application/json' }, success: (result: WechatMiniprogram.RequestSuccessCallbackResult) => { const body = result.data as ApiResponse<T>; if (result.statusCode >= 400 || body.code !== 0) reject(new Error(body.message)); else resolve(body.data); }, fail: reject }));
}

export const api = {
  skills: () => request<Skill[]>('/skills'),
  skill: (id: string) => request<Skill>(`/skills/${encodeURIComponent(id)}`),
  task: (id: string) => request<Task>(`/tasks/${id}`),
  result: (id: string) => request<{ task: Task; outputs: Array<{ objectKey: string; url: string }> }>(`/tasks/${id}/result`),
  works: (page = 1) => request<{ items: Array<{ task: Task; outputs: Array<{ objectKey: string }> }>; total: number }>(`/works?page=${page}`),
  createTask: (data: { skillId: string; images: Array<{ objectKey: string; mimeType?: string }>; parameters: Record<string, unknown> }) => request<{ taskId: string; taskNo: string; status: string }>('/tasks', 'POST', data),
  upload: (filePath: string): Promise<{ objectKey: string; url: string }> => new Promise((resolve, reject) => wx.uploadFile({ url: `${baseUrl()}/uploads`, filePath, name: 'file', success: (result: WechatMiniprogram.UploadFileSuccessCallbackResult) => { try { const body = JSON.parse(result.data) as ApiResponse<{ objectKey: string; url: string }>; if (body.code !== 0) reject(new Error(body.message)); else resolve(body.data); } catch { reject(new Error('上传响应无效')); } }, fail: reject })),
  fileUrl: (path: string) => `${baseUrl()}/files/${path}`,
};
