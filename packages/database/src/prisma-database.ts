import type {
  CreateSkillInput,
  CreateSkillVersionInput,
  CreateTaskInput,
  SkillRecord,
  SkillStatus,
  SkillVersionRecord,
  TaskOutputRecord,
  TaskRecord,
  UserRecord,
} from '@ai-photo/shared';

import type { Database } from './database.js';

type JsonObject = Record<string, unknown>;

interface PrismaDelegate<T> {
  create(args: JsonObject): Promise<T>;
  findMany(args: JsonObject): Promise<T[]>;
  findUnique(args: JsonObject): Promise<T | null>;
  update(args: JsonObject): Promise<T>;
  upsert(args: JsonObject): Promise<T>;
}

export interface PrismaClientContract {
  user: Pick<PrismaDelegate<UserRecord>, 'upsert'>;
  skill: PrismaDelegate<SkillRecord>;
  skillVersion: PrismaDelegate<SkillVersionRecord>;
  task: PrismaDelegate<TaskRecord>;
  taskOutput: Pick<PrismaDelegate<TaskOutputRecord>, 'create' | 'findMany'>;
}

export class PrismaDatabase implements Database {
  public constructor(private readonly prisma: PrismaClientContract) {}

  public ensureDevUser(): Promise<UserRecord> {
    return this.prisma.user.upsert({
      where: { id: 'dev-user' },
      update: {},
      create: { id: 'dev-user', nickname: '开发用户' },
    });
  }

  public createSkill(input: CreateSkillInput): Promise<SkillRecord> {
    const data = { slug: input.slug ?? input.id, sort: input.sort ?? 0, ...input };
    return this.prisma.skill.upsert({ where: { id: input.id }, update: data, create: data });
  }

  public async getSkill(id: string): Promise<SkillRecord | undefined> {
    return (await this.prisma.skill.findUnique({ where: { id } })) ?? undefined;
  }

  public listSkills(filter: { status?: SkillStatus } = {}): Promise<SkillRecord[]> {
    return this.prisma.skill.findMany({
      where: filter.status ? { status: filter.status } : {},
      orderBy: { sort: 'asc' },
    });
  }

  public createSkillVersion(input: CreateSkillVersionInput): Promise<SkillVersionRecord> {
    return this.prisma.skillVersion.create({
      data: {
        skillId: input.skillId,
        version: input.version,
        status: input.status,
        skillManifest: input.manifest,
        skillContent: input.content,
        inputSchema: input.inputSchema,
        outputSchema: input.outputSchema,
        workflowConfig: input.workflowConfig,
        providerId: input.providerId,
        modelId: input.modelId,
        timeoutSeconds: input.timeoutSeconds ?? 120,
        maxRetries: input.maxRetries ?? 3,
      },
    });
  }

  public async getSkillVersion(
    skillId: string,
    version?: string,
  ): Promise<SkillVersionRecord | undefined> {
    const selected = version ?? (await this.getSkill(skillId))?.currentVersion;
    if (!selected) return undefined;
    return (
      (await this.prisma.skillVersion.findUnique({
        where: { skillId_version: { skillId, version: selected } },
      })) ?? undefined
    );
  }

  public async createTask(input: CreateTaskInput): Promise<TaskRecord> {
    const skill = await this.getSkill(input.skillId);
    const skillVersion = input.skillVersion ?? skill?.currentVersion;
    if (!skillVersion) throw new Error('SKILL_VERSION_NOT_FOUND');
    const version = await this.getSkillVersion(input.skillId, skillVersion);
    if (!version) throw new Error('SKILL_VERSION_NOT_FOUND');
    const suffix = Math.random().toString(36).slice(2, 8).toUpperCase();
    return this.prisma.task.create({
      data: {
        taskNo: `TASK-${Date.now()}-${suffix}`,
        userId: input.userId,
        skillId: input.skillId,
        skillVersionId: version.id,
        inputJson: { input: input.input, parameters: input.parameters, skillVersion },
        providerId: version.providerId,
        modelId: version.modelId,
      },
    });
  }

  public async getTask(id: string): Promise<TaskRecord | undefined> {
    return (await this.prisma.task.findUnique({ where: { id } })) ?? undefined;
  }

  public updateTask(id: string, patch: Partial<TaskRecord>): Promise<TaskRecord> {
    return this.prisma.task.update({ where: { id }, data: patch });
  }

  public addTaskOutput(
    input: Omit<TaskOutputRecord, 'id' | 'createdAt'>,
  ): Promise<TaskOutputRecord> {
    return this.prisma.taskOutput.create({ data: input });
  }

  public listTaskOutputs(taskId?: string): Promise<TaskOutputRecord[]> {
    return this.prisma.taskOutput.findMany({
      where: taskId ? { taskId } : {},
      orderBy: { createdAt: 'desc' },
    });
  }

  public listTasks(userId?: string): Promise<TaskRecord[]> {
    return this.prisma.task.findMany({
      where: userId ? { userId } : {},
      orderBy: { createdAt: 'desc' },
    });
  }
}
