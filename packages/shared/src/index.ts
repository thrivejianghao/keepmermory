export type SkillStatus = 'DRAFT' | 'TESTING' | 'PUBLISHED' | 'OFFLINE' | 'DEPRECATED';

export type TaskStatus =
  | 'PENDING'
  | 'QUEUED'
  | 'PROCESSING'
  | 'RETRYING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'CANCELLED';

export interface UserRecord {
  id: string;
  openId?: string;
  nickname?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface SkillRecord {
  id: string;
  slug: string;
  name: string;
  description: string;
  coverUrl?: string;
  category: string;
  status: SkillStatus;
  currentVersion?: string;
  sort: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface SkillVersionRecord {
  id: string;
  skillId: string;
  version: string;
  status: SkillStatus;
  manifest: Record<string, unknown>;
  content?: string;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  workflowConfig?: Record<string, unknown>;
  providerId?: string;
  modelId?: string;
  timeoutSeconds: number;
  maxRetries: number;
  createdAt: Date;
  publishedAt?: Date;
}

export interface ImageInput {
  objectKey: string;
  mimeType?: string;
  url?: string;
}

export interface TaskRecord {
  id: string;
  taskNo: string;
  userId: string;
  skillId: string;
  skillVersionId?: string;
  skillVersion: string;
  status: TaskStatus;
  progress: number;
  input: { images: ImageInput[] };
  parameters: Record<string, unknown>;
  output?: Record<string, unknown>;
  providerId?: string;
  modelId?: string;
  retryCount: number;
  errorCode?: string;
  errorMessage?: string;
  startedAt?: Date;
  finishedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface TaskOutputRecord {
  id: string;
  taskId: string;
  objectKey: string;
  mimeType: string;
  width?: number;
  height?: number;
  size?: number;
  createdAt: Date;
}

export interface CreateSkillInput {
  id: string;
  slug?: string;
  name: string;
  description: string;
  coverUrl?: string;
  category: string;
  status: SkillStatus;
  currentVersion?: string;
  sort?: number;
}

export interface CreateSkillVersionInput {
  skillId: string;
  version: string;
  status: SkillStatus;
  manifest: Record<string, unknown>;
  content?: string;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  workflowConfig?: Record<string, unknown>;
  providerId?: string;
  modelId?: string;
  timeoutSeconds?: number;
  maxRetries?: number;
}

export interface CreateTaskInput {
  userId: string;
  skillId: string;
  skillVersion?: string;
  providerId?: string;
  modelId?: string;
  input: { images: ImageInput[] };
  parameters: Record<string, unknown>;
}

export interface SkillParameterDefinition {
  type: 'string' | 'number' | 'boolean' | 'select';
  label: string;
  default?: string | number | boolean;
  options?: Array<{ label: string; value: string }>;
}

export interface SkillManifest {
  schemaVersion: '1.0';
  id: string;
  name: string;
  version: string;
  description: string;
  category: string;
  input: { images: { min: number; max: number } };
  parameters: Record<string, SkillParameterDefinition>;
  provider: { type: string; model: string };
  workflow: { type: 'sequential' | 'parallel' | 'conditional'; steps?: WorkflowStep[] };
}

export interface WorkflowStep {
  type: 'vision' | 'image_generate' | 'image_edit' | 'text_generate' | 'image_process' | 'postprocess' | 'quality_check';
  prompt?: string;
}
