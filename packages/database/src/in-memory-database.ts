import type {
  CreateSkillInput,
  CreateSkillVersionInput,
  CreateTaskInput,
  Database,
  SkillRecord,
  SkillVersionRecord,
  TaskOutputRecord,
  TaskRecord,
  UserRecord,
} from './index.js';

const cloneRecord = <T extends object>(record: T): T => structuredClone(record);

export class InMemoryDatabase implements Database {
  private readonly users = new Map<string, UserRecord>();
  private readonly skills = new Map<string, SkillRecord>();
  private readonly versions = new Map<string, SkillVersionRecord>();
  private readonly tasks = new Map<string, TaskRecord>();
  private readonly outputs = new Map<string, TaskOutputRecord>();
  private taskSequence = 10000;

  public async ensureDevUser(): Promise<UserRecord> {
    const current = this.users.get('dev-user');
    if (current) return cloneRecord(current);
    const now = new Date();
    const user: UserRecord = { id: 'dev-user', nickname: '开发用户', createdAt: now, updatedAt: now };
    this.users.set(user.id, user);
    return cloneRecord(user);
  }

  public async createSkill(input: CreateSkillInput): Promise<SkillRecord> {
    const now = new Date();
    const skill: SkillRecord = {
      id: input.id,
      slug: input.slug ?? input.id,
      name: input.name,
      description: input.description,
      ...(input.coverUrl ? { coverUrl: input.coverUrl } : {}),
      category: input.category,
      status: input.status,
      ...(input.currentVersion ? { currentVersion: input.currentVersion } : {}),
      sort: input.sort ?? 0,
      createdAt: now,
      updatedAt: now,
    };
    this.skills.set(skill.id, skill);
    return cloneRecord(skill);
  }

  public async getSkill(id: string): Promise<SkillRecord | undefined> {
    const skill = this.skills.get(id);
    return skill ? cloneRecord(skill) : undefined;
  }

  public async listSkills(filter: { status?: SkillRecord['status'] } = {}): Promise<SkillRecord[]> {
    return [...this.skills.values()]
      .filter((skill) => !filter.status || skill.status === filter.status)
      .sort((left, right) => left.sort - right.sort)
      .map(cloneRecord);
  }

  public async createSkillVersion(input: CreateSkillVersionInput): Promise<SkillVersionRecord> {
    const id = `${input.skillId}@${input.version}`;
    const now = new Date();
    const version: SkillVersionRecord = {
      id,
      skillId: input.skillId,
      version: input.version,
      status: input.status,
      manifest: cloneRecord(input.manifest),
      ...(input.content ? { content: input.content } : {}),
      ...(input.inputSchema ? { inputSchema: cloneRecord(input.inputSchema) } : {}),
      ...(input.outputSchema ? { outputSchema: cloneRecord(input.outputSchema) } : {}),
      ...(input.workflowConfig ? { workflowConfig: cloneRecord(input.workflowConfig) } : {}),
      ...(input.providerId ? { providerId: input.providerId } : {}),
      ...(input.modelId ? { modelId: input.modelId } : {}),
      timeoutSeconds: input.timeoutSeconds ?? 120,
      maxRetries: input.maxRetries ?? 3,
      createdAt: now,
      ...(input.status === 'PUBLISHED' ? { publishedAt: now } : {}),
    };
    this.versions.set(id, version);
    return cloneRecord(version);
  }

  public async getSkillVersion(skillId: string, version?: string): Promise<SkillVersionRecord | undefined> {
    const skill = this.skills.get(skillId);
    const selected = version ?? skill?.currentVersion;
    if (!selected) return undefined;
    const record = this.versions.get(`${skillId}@${selected}`);
    return record ? cloneRecord(record) : undefined;
  }

  public async createTask(input: CreateTaskInput): Promise<TaskRecord> {
    const skill = this.skills.get(input.skillId);
    const skillVersion = input.skillVersion ?? skill?.currentVersion;
    if (!skillVersion) throw new Error('SKILL_VERSION_NOT_FOUND');
    const version = this.versions.get(`${input.skillId}@${skillVersion}`);
    const now = new Date();
    const task: TaskRecord = {
      id: String(++this.taskSequence),
      taskNo: `TASK-${this.taskSequence}`,
      userId: input.userId,
      skillId: input.skillId,
      ...(version ? { skillVersionId: version.id } : {}),
      skillVersion,
      status: 'PENDING',
      progress: 0,
      input: cloneRecord(input.input),
      parameters: cloneRecord(input.parameters),
      ...(version?.providerId ? { providerId: version.providerId } : {}),
      ...(version?.modelId ? { modelId: version.modelId } : {}),
      retryCount: 0,
      createdAt: now,
      updatedAt: now,
    };
    this.tasks.set(task.id, task);
    return cloneRecord(task);
  }

  public async getTask(id: string): Promise<TaskRecord | undefined> {
    const task = this.tasks.get(id);
    return task ? cloneRecord(task) : undefined;
  }

  public async updateTask(id: string, patch: Partial<TaskRecord>): Promise<TaskRecord> {
    const current = this.tasks.get(id);
    if (!current) throw new Error('TASK_NOT_FOUND');
    const updated: TaskRecord = { ...current, ...cloneRecord(patch), updatedAt: new Date() };
    this.tasks.set(id, updated);
    return cloneRecord(updated);
  }

  public async addTaskOutput(input: Omit<TaskOutputRecord, 'id' | 'createdAt'>): Promise<TaskOutputRecord> {
    const output: TaskOutputRecord = { ...input, id: `OUTPUT-${this.outputs.size + 1}`, createdAt: new Date() };
    this.outputs.set(output.id, output);
    return cloneRecord(output);
  }

  public async listTaskOutputs(taskId?: string): Promise<TaskOutputRecord[]> {
    return [...this.outputs.values()]
      .filter((output) => !taskId || output.taskId === taskId)
      .map(cloneRecord);
  }

  public async listTasks(userId?: string): Promise<TaskRecord[]> {
    return [...this.tasks.values()]
      .filter((task) => !userId || task.userId === userId)
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
      .map(cloneRecord);
  }
}
