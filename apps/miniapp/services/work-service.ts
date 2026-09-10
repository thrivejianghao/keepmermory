import { api, type ApiClient, type WorkPage } from './api';

export function createWorkService(client: ApiClient) {
  return {
    async list(page = 1, pageSize = 20): Promise<WorkPage> {
      const result = await client.works(page, pageSize);
      return {
        ...result,
        items: result.items.map((item) => ({
          ...item,
          outputs: item.outputs.map((output) => ({ ...output, url: client.fileUrl(output.url ?? output.objectKey) })),
        })),
      };
    },
    remove: (taskId: string): Promise<void> => client.deleteWork(taskId),
  };
}

export const workService = createWorkService(api);
