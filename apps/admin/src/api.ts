const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://127.0.0.1:3000/api/v1';

interface ApiResponse<T> { code: number; message: string; data: T }

export interface SkillRow {
  id: string; name: string; description: string; category: string; status: string; currentVersion?: string; sort: number;
}

export interface TaskRow {
  id: string; taskNo: string; skillId: string; status: string; progress: number; retryCount: number; createdAt: string;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, { ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } });
  const body = await response.json() as ApiResponse<T>;
  if (!response.ok || body.code !== 0) throw new Error(body.message);
  return body.data;
}

export const adminApi = {
  skills: () => request<SkillRow[]>('/admin/skills'),
  tasks: () => request<TaskRow[]>('/admin/tasks'),
  setSkillStatus: (id: string, status: string) => request<SkillRow>(`/admin/skills/${id}/status`, { method: 'POST', body: JSON.stringify({ status }) }),
};
