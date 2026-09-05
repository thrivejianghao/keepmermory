import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { ImageInput, SkillManifest, SkillParameterDefinition } from '@ai-photo/shared';
import type { AIProviderManager, ImageResult } from '@ai-photo/ai-provider';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export interface LoadedSkill {
  manifest: SkillManifest;
  content: string;
  directory: string;
}

export interface SkillExecutionInput {
  taskId: string;
  userId: string;
  skillId: string;
  version?: string;
  inputImages: ImageInput[];
  parameters: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface SkillExecutionResult {
  image: ImageResult;
  provider: string;
  model: string;
  prompt: string;
}

export class SkillValidator {
  public validate(value: unknown): ValidationResult {
    const errors: string[] = [];
    if (!value || typeof value !== 'object') return { valid: false, errors: ['manifest must be an object'] };
    const manifest = value as Partial<SkillManifest>;
    if (manifest.schemaVersion !== '1.0') errors.push('schemaVersion must be 1.0');
    if (!this.isIdentifier(manifest.id)) errors.push('id must be a kebab-case identifier');
    if (!manifest.name?.trim()) errors.push('name is required');
    if (!this.isSemver(manifest.version)) errors.push('version must use semver');
    if (!manifest.description?.trim()) errors.push('description is required');
    if (!manifest.category?.trim()) errors.push('category is required');
    const images = manifest.input?.images;
    if (!images || !Number.isInteger(images.min) || !Number.isInteger(images.max) || images.min < 1 || images.max < images.min) errors.push('input.images must define valid min/max');
    if (!manifest.parameters || typeof manifest.parameters !== 'object') errors.push('parameters must be an object');
    const provider = manifest.provider;
    if (!provider?.type?.trim() || !provider.model?.trim()) errors.push('provider.type and provider.model are required');
    if (!manifest.workflow || !['sequential', 'parallel', 'conditional'].includes(manifest.workflow.type)) errors.push('workflow.type is invalid');
    return { valid: errors.length === 0, errors };
  }

  private isIdentifier(value: unknown): value is string {
    return typeof value === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
  }

  private isSemver(value: unknown): value is string {
    return typeof value === 'string' && /^\d+\.\d+\.\d+$/.test(value);
  }
}

export class SkillLoader {
  public constructor(private readonly rootDir: string, private readonly validator = new SkillValidator()) {}

  public async load(skillId: string): Promise<LoadedSkill> {
    const directory = join(this.rootDir, skillId);
    const [manifestText, content] = await Promise.all([
      readFile(join(directory, 'skill.json'), 'utf8'),
      readFile(join(directory, 'SKILL.md'), 'utf8'),
    ]);
    let manifest: unknown;
    try {
      manifest = JSON.parse(manifestText) as unknown;
    } catch {
      throw new Error('SKILL_INVALID');
    }
    const validation = this.validator.validate(manifest);
    if (!validation.valid) throw new Error(`SKILL_INVALID:${validation.errors.join(';')}`);
    const typed = manifest as SkillManifest;
    if (typed.id !== skillId) throw new Error('SKILL_INVALID:id mismatch');
    return { manifest: typed, content, directory };
  }

  public async discover(): Promise<LoadedSkill[]> {
    const entries = await readdir(this.rootDir, { withFileTypes: true });
    const skills: LoadedSkill[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('_')) continue;
      try {
        skills.push(await this.load(entry.name));
      } catch {
        // Invalid skills are intentionally excluded from the runtime registry.
      }
    }
    return skills;
  }
}

export class SkillRegistry {
  private skills = new Map<string, LoadedSkill>();

  public constructor(private readonly loader: SkillLoader) {}

  public async reload(): Promise<void> {
    const discovered = await this.loader.discover();
    this.skills = new Map(discovered.map((skill) => [skill.manifest.id, skill]));
  }

  public register(skill: LoadedSkill): void {
    const result = new SkillValidator().validate(skill.manifest);
    if (!result.valid) throw new Error(`SKILL_INVALID:${result.errors.join(';')}`);
    this.skills.set(skill.manifest.id, skill);
  }

  public get(skillId: string): LoadedSkill {
    const skill = this.skills.get(skillId);
    if (!skill) throw new Error('SKILL_NOT_FOUND');
    return skill;
  }

  public list(): LoadedSkill[] {
    return [...this.skills.values()];
  }
}

export interface SkillContext {
  taskId: string;
  userId: string;
  skillId: string;
  skillVersion: string;
  inputImages: ImageInput[];
  parameters: Record<string, unknown>;
  metadata: Record<string, unknown>;
}

export class WorkflowExecutor {
  public constructor(private readonly providers: AIProviderManager) {}

  public async execute(skill: LoadedSkill, context: SkillContext): Promise<SkillExecutionResult> {
    const provider = this.providers.getProvider(skill.manifest.provider.type);
    const prompt = buildPrompt(skill, context);
    const steps = skill.manifest.workflow.steps ?? [{ type: 'image_generate' as const }];
    let image: ImageResult | undefined;
    for (const step of steps) {
      if (step.type === 'image_generate') image = await provider.generate({ prompt: step.prompt ? `${prompt}\n${step.prompt}` : prompt, images: context.inputImages, model: skill.manifest.provider.model, metadata: context.metadata });
      else if (step.type === 'image_edit') image = await provider.edit({ prompt: step.prompt ? `${prompt}\n${step.prompt}` : prompt, images: context.inputImages, model: skill.manifest.provider.model, metadata: context.metadata });
      else if (step.type === 'vision') await provider.analyze({ images: context.inputImages, prompt: step.prompt ?? prompt });
    }
    if (!image) throw new Error('WORKFLOW_NO_IMAGE');
    return { image, provider: skill.manifest.provider.type, model: skill.manifest.provider.model, prompt };
  }
}

export class SkillExecutor {
  public constructor(private readonly registry: SkillRegistry, private readonly workflow: WorkflowExecutor) {}

  public async execute(input: SkillExecutionInput): Promise<SkillExecutionResult> {
    const skill = this.registry.get(input.skillId);
    if (input.version && input.version !== skill.manifest.version) throw new Error('SKILL_VERSION_NOT_FOUND');
    validateInput(skill.manifest, input.inputImages, input.parameters);
    return this.workflow.execute(skill, {
      taskId: input.taskId,
      userId: input.userId,
      skillId: input.skillId,
      skillVersion: skill.manifest.version,
      inputImages: input.inputImages,
      parameters: input.parameters,
      metadata: input.metadata ?? {},
    });
  }
}

const buildPrompt = (skill: LoadedSkill, context: SkillContext): string => {
  const parameters = Object.entries(context.parameters)
    .map(([key, value]) => `${key}: ${String(value)}`)
    .join(', ');
  return `${skill.content.trim()}\nSubject: preserve the identity and natural anatomy in the input photo.\nParameters: ${parameters || 'default'}\nQuality: create a coherent finished image with clean composition and no unintended text or artifacts.`;
};

const validateInput = (manifest: SkillManifest, images: ImageInput[], parameters: Record<string, unknown>): void => {
  const { min, max } = manifest.input.images;
  if (images.length < min || images.length > max) throw new Error('INVALID_INPUT:images');
  for (const [name, definition] of Object.entries(manifest.parameters)) validateParameter(name, definition, parameters[name]);
};

const validateParameter = (name: string, definition: SkillParameterDefinition, value: unknown): void => {
  if (value === undefined && definition.default === undefined) return;
  const actual = value ?? definition.default;
  if (definition.type === 'string' && typeof actual !== 'string') throw new Error(`INVALID_INPUT:parameter:${name}`);
  if (definition.type === 'number' && typeof actual !== 'number') throw new Error(`INVALID_INPUT:parameter:${name}`);
  if (definition.type === 'boolean' && typeof actual !== 'boolean') throw new Error(`INVALID_INPUT:parameter:${name}`);
  if (definition.type === 'select' && (typeof actual !== 'string' || !definition.options?.some((option) => option.value === actual))) throw new Error(`INVALID_INPUT:parameter:${name}`);
};
