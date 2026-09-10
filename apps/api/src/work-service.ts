import type { Database } from '@ai-photo/database';

export class WorkService {
  public constructor(private readonly database: Database) {}

  public async list(userId: string, page: number, pageSize: number) {
    const tasks = (await this.database.listTasks(userId)).filter((task) => task.status === 'SUCCEEDED');
    const selected = tasks.slice((page - 1) * pageSize, page * pageSize);
    const items = await Promise.all(selected.map(async (task) => ({ task, outputs: await this.database.listTaskOutputs(task.id) })));
    return { items, page, pageSize, total: tasks.length };
  }

  public async remove(userId: string, taskId: string): Promise<{ id: string }> {
    const task = await this.database.getTask(taskId);
    if (!task || task.userId !== userId || task.status !== 'SUCCEEDED') throw new Error('WORK_NOT_FOUND');
    await this.database.deleteTask(task.id);
    return { id: task.id };
  }
}
