import { api, type AIModel, type ApiClient, type ParameterValue, type Task, type TaskResult, type TaskStatus, type UploadResult } from './api';

export interface TaskPresentation { label: string; detail: string; terminal: boolean; succeeded: boolean; failed: boolean }

export function describeTask(task: Pick<Task, 'status' | 'progress'>): TaskPresentation {
  const fixed: Partial<Record<TaskStatus, TaskPresentation>> = {
    PENDING: { label: '正在提交任务', detail: '正在准备照片和创作参数', terminal: false, succeeded: false, failed: false },
    QUEUED: { label: '正在排队', detail: '轮到你后会自动开始生成', terminal: false, succeeded: false, failed: false },
    RETRYING: { label: '正在重新尝试', detail: '网络有些波动，正在继续完成作品', terminal: false, succeeded: false, failed: false },
    SUCCEEDED: { label: '作品已完成', detail: '正在打开结果', terminal: true, succeeded: true, failed: false },
    FAILED: { label: '生成失败', detail: '这次没有完成，可以重新生成', terminal: true, succeeded: false, failed: true },
    CANCELLED: { label: '任务已取消', detail: '可以返回后重新开始', terminal: true, succeeded: false, failed: true },
  };
  if (task.status !== 'PROCESSING') return fixed[task.status] ?? fixed.PENDING!;
  if (task.progress < 34) return { label: '正在分析你的照片', detail: '识别主体、构图与光线', terminal: false, succeeded: false, failed: false };
  if (task.progress < 74) return { label: '正在生成视觉效果', detail: '按照玩法风格创作画面', terminal: false, succeeded: false, failed: false };
  return { label: '正在完成细节', detail: '调整质感并完成最终作品', terminal: false, succeeded: false, failed: false };
}

export function createTaskService(client: ApiClient) {
  return {
    models: async (): Promise<{ items: AIModel[]; default?: AIModel }> => client.models(),
    create(input: { skillId: string; providerId: string; modelId: string; uploads: UploadResult[]; parameters: Record<string, ParameterValue> }) {
      return client.createTask({
        skillId: input.skillId,
        providerId: input.providerId,
        modelId: input.modelId,
        images: input.uploads.map((upload) => ({ objectKey: upload.objectKey, mimeType: upload.mimeType })),
        parameters: input.parameters,
      });
    },
    get: (id: string): Promise<Task> => client.task(id),
    async result(id: string): Promise<TaskResult> {
      const result = await client.result(id);
      return { ...result, outputs: result.outputs.map((output) => ({ ...output, url: client.fileUrl(output.url ?? output.objectKey) })) };
    },
    sourceUrls(task: Task): string[] {
      return (task.input?.images ?? []).map((image) => client.fileUrl(image.objectKey));
    },
  };
}

export const taskService = createTaskService(api);
