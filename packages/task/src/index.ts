import { extname } from 'node:path';
import type { CreateTaskInput, Database, TaskRecord } from '@ai-photo/database';
import type { SkillExecutor } from '@ai-photo/skill-engine';
import type { StorageProvider } from '@ai-photo/storage';

export const TASK_QUEUE_NAME = 'ai-image-generation';

export interface TaskQueue {
  add(taskId: string): Promise<void>;
  process(handler: (taskId: string) => Promise<void>): void;
  waitForIdle(): Promise<void>;
}

export class InMemoryTaskQueue implements TaskQueue {
  private handler?: (taskId: string) => Promise<void>;
  private readonly waiting: string[] = [];
  private readonly running = new Set<Promise<void>>();

  public async add(taskId: string): Promise<void> {
    this.waiting.push(taskId);
    this.drain();
  }

  public process(handler: (taskId: string) => Promise<void>): void {
    this.handler = handler;
    this.drain();
  }

  public async waitForIdle(): Promise<void> {
    while (this.waiting.length > 0 || this.running.size > 0) {
      await Promise.allSettled([...this.running]);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  private drain(): void {
    if (!this.handler) return;
    const taskId = this.waiting.shift();
    if (!taskId) return;
    const running = this.handler(taskId).finally(() => {
      this.running.delete(running);
      this.drain();
    });
    this.running.add(running);
  }
}

export interface BullQueueContract {
  add(name: string, data: { taskId: string }, options: Record<string, unknown>): Promise<unknown>;
}

export class BullMqTaskQueueProducer {
  public constructor(private readonly queue: BullQueueContract) {}

  public async add(taskId: string): Promise<void> {
    await this.queue.add(TASK_QUEUE_NAME, { taskId }, { attempts: 3, backoff: { type: 'exponential', delay: 1000 } });
  }
}

export class TaskService {
  public constructor(
    private readonly database: Database,
    private readonly queue: Pick<TaskQueue, 'add'>,
    private readonly executor: SkillExecutor,
    private readonly storage: StorageProvider,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  public async createTask(input: CreateTaskInput): Promise<TaskRecord> {
    const skill = await this.database.getSkill(input.skillId);
    if (!skill) throw new Error('SKILL_NOT_FOUND');
    if (skill.status !== 'PUBLISHED') throw new Error('SKILL_OFFLINE');
    const task = await this.database.createTask(input);
    const queued = await this.database.updateTask(task.id, { status: 'QUEUED', progress: 5 });
    await this.queue.add(task.id);
    return queued;
  }

  public async processTask(taskId: string): Promise<TaskRecord> {
    const task = await this.requireTask(taskId);
    if (task.status === 'CANCELLED') return task;
    await this.database.updateTask(task.id, { status: 'PROCESSING', progress: 20, startedAt: new Date() });
    const result = await this.executor.execute({
      taskId: task.id,
      userId: task.userId,
      skillId: task.skillId,
      version: task.skillVersion,
      inputImages: task.input.images,
      parameters: task.parameters,
      ...(task.providerId ? { providerId: task.providerId } : {}),
      ...(task.modelId ? { modelId: task.modelId } : {}),
    });
    const extension = result.image.mimeType === 'image/png' ? '.png' : extname(task.input.images[0]?.objectKey ?? '') || '.jpg';
    const objectKey = `outputs/${task.taskNo}${extension}`;
    if (result.image.data) await this.storage.save(result.image.data, objectKey);
    else if (result.image.objectKey?.startsWith('http')) {
      const response = await this.fetcher(result.image.objectKey);
      if (!response.ok) throw new Error('AI_PROVIDER_ERROR');
      await this.storage.save(Buffer.from(await response.arrayBuffer()), objectKey);
    } else throw new Error('TASK_FAILED');
    const data = await this.storage.read(objectKey);
    await this.database.addTaskOutput({ taskId: task.id, objectKey, mimeType: result.image.mimeType, size: data.byteLength });
    return this.database.updateTask(task.id, { status: 'SUCCEEDED', progress: 100, output: { objectKey }, finishedAt: new Date() });
  }

  public async markRetrying(taskId: string, retryCount: number): Promise<TaskRecord> {
    return this.database.updateTask(taskId, { status: 'RETRYING', progress: 30, retryCount });
  }

  public async markFailed(taskId: string, error: unknown): Promise<TaskRecord> {
    const message = error instanceof Error ? error.message : 'TASK_FAILED';
    return this.database.updateTask(taskId, {
      status: 'FAILED',
      errorCode: message.split(':')[0] ?? 'TASK_FAILED',
      errorMessage: message,
      finishedAt: new Date(),
    });
  }

  public async cancelTask(taskId: string): Promise<TaskRecord> {
    const task = await this.requireTask(taskId);
    if (task.status === 'SUCCEEDED' || task.status === 'FAILED') throw new Error('TASK_NOT_CANCELLABLE');
    return this.database.updateTask(taskId, { status: 'CANCELLED', finishedAt: new Date() });
  }

  private async requireTask(taskId: string): Promise<TaskRecord> {
    const task = await this.database.getTask(taskId);
    if (!task) throw new Error('TASK_NOT_FOUND');
    return task;
  }
}

export class TaskWorker {
  private started = false;

  public constructor(private readonly queue: TaskQueue, private readonly service: TaskService, private readonly maxRetries = 3) {}

  public start(): void {
    if (this.started) return;
    this.started = true;
    this.queue.process((taskId) => this.processWithRetry(taskId));
  }

  public waitForIdle(): Promise<void> {
    return this.queue.waitForIdle();
  }

  private async processWithRetry(taskId: string): Promise<void> {
    for (let attempt = 0; attempt < this.maxRetries; attempt += 1) {
      try {
        await this.service.processTask(taskId);
        return;
      } catch (error) {
        if (attempt + 1 >= this.maxRetries) {
          await this.service.markFailed(taskId, error);
          return;
        }
        await this.service.markRetrying(taskId, attempt + 1);
        await new Promise((resolve) => setTimeout(resolve, 2 ** attempt));
      }
    }
  }
}
