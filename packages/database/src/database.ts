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

export interface Database {
  ensureDevUser(): Promise<UserRecord>;
  createSkill(input: CreateSkillInput): Promise<SkillRecord>;
  getSkill(id: string): Promise<SkillRecord | undefined>;
  listSkills(filter?: { status?: SkillStatus }): Promise<SkillRecord[]>;
  createSkillVersion(input: CreateSkillVersionInput): Promise<SkillVersionRecord>;
  getSkillVersion(skillId: string, version?: string): Promise<SkillVersionRecord | undefined>;
  createTask(input: CreateTaskInput): Promise<TaskRecord>;
  getTask(id: string): Promise<TaskRecord | undefined>;
  updateTask(id: string, patch: Partial<TaskRecord>): Promise<TaskRecord>;
  addTaskOutput(input: Omit<TaskOutputRecord, 'id' | 'createdAt'>): Promise<TaskOutputRecord>;
  listTaskOutputs(taskId?: string): Promise<TaskOutputRecord[]>;
  listTasks(userId?: string): Promise<TaskRecord[]>;
}
