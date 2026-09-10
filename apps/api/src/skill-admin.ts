import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import type { CreateSkillInput, Database, SkillManifest, SkillRecord, SkillStatus } from '@ai-photo/database';
import type { LoadedSkill, SkillRegistry } from '@ai-photo/skill-engine';

export interface AdminSkillInput {
  id?: unknown;
  name?: unknown;
  description?: unknown;
  coverUrl?: unknown;
  category?: unknown;
  status?: unknown;
  version?: unknown;
  sort?: unknown;
  instructions?: unknown;
  imageMin?: unknown;
  imageMax?: unknown;
}

export interface AdminSkillDetail {
  id: string;
  name: string;
  description: string;
  coverUrl?: string;
  category: string;
  status: SkillStatus;
  version: string;
  sort: number;
  instructions: string;
  imageMin: number;
  imageMax: number;
}

interface StoredSkill {
  record: CreateSkillInput;
  manifest: SkillManifest;
  content: string;
}

interface SkillCatalogFile {
  upserts: StoredSkill[];
  deletedIds: string[];
}

const statuses: SkillStatus[] = ['DRAFT', 'TESTING', 'PUBLISHED', 'OFFLINE', 'DEPRECATED'];

export class SkillAdminService {
  private readonly skills = new Map<string, StoredSkill>();
  private readonly upserts = new Map<string, StoredSkill>();
  private readonly deletedIds = new Set<string>();

  public constructor(
    private readonly database: Database,
    private readonly registry: SkillRegistry,
    private readonly catalogFile: string,
  ) {}

  public async initialize(): Promise<void> {
    for (const loaded of this.registry.list()) {
      const record = await this.database.getSkill(loaded.manifest.id);
      if (record) this.skills.set(record.id, toStoredSkill(record, loaded));
    }
    const catalog = await this.readCatalog();
    for (const id of catalog.deletedIds) {
      this.deletedIds.add(id);
      if (await this.database.getSkill(id)) await this.database.deleteSkill(id);
      this.registry.unregister(id);
      this.skills.delete(id);
    }
    for (const stored of catalog.upserts) {
      validateStoredSkill(stored);
      await this.applyStoredSkill(stored);
      this.upserts.set(stored.record.id, stored);
      this.deletedIds.delete(stored.record.id);
    }
  }

  public async list(): Promise<SkillRecord[]> {
    return this.database.listSkills();
  }

  public get(id: string): AdminSkillDetail {
    const stored = this.skills.get(id);
    if (!stored) throw new Error('SKILL_NOT_FOUND');
    return toDetail(stored);
  }

  public async create(input: AdminSkillInput): Promise<SkillRecord> {
    const id = requireIdentifier(input.id, 'id');
    if (await this.database.getSkill(id)) throw new Error('SKILL_ALREADY_EXISTS');
    const detail = parseDetail(input, id);
    const stored = fromDetail(detail);
    await this.applyStoredSkill(stored);
    this.upserts.set(id, stored);
    this.deletedIds.delete(id);
    await this.persist();
    return this.requireRecord(id);
  }

  public async update(id: string, input: AdminSkillInput): Promise<SkillRecord> {
    const current = this.skills.get(id);
    if (!current) throw new Error('SKILL_NOT_FOUND');
    const detail = parseDetail(input, id);
    const stored = fromDetail(detail, current.manifest);
    await this.applyStoredSkill(stored);
    this.upserts.set(id, stored);
    this.deletedIds.delete(id);
    await this.persist();
    return this.requireRecord(id);
  }

  public async setStatus(id: string, statusValue: unknown): Promise<SkillRecord> {
    const current = this.get(id);
    const status = requireStatus(statusValue);
    return this.update(id, { ...current, status });
  }

  public async delete(id: string): Promise<{ id: string }> {
    if (!this.skills.has(id)) throw new Error('SKILL_NOT_FOUND');
    await this.database.deleteSkill(id);
    this.registry.unregister(id);
    this.skills.delete(id);
    this.upserts.delete(id);
    this.deletedIds.add(id);
    await this.persist();
    return { id };
  }

  private async applyStoredSkill(stored: StoredSkill): Promise<void> {
    const id = stored.record.id;
    const current = await this.database.getSkill(id);
    if (current) await this.database.updateSkill(id, withoutId(stored.record));
    else await this.database.createSkill(stored.record);
    await this.database.upsertSkillVersion({
      skillId: id,
      version: stored.manifest.version,
      status: stored.record.status,
      manifest: stored.manifest as unknown as Record<string, unknown>,
      content: stored.content,
      inputSchema: { images: stored.manifest.input.images, parameters: stored.manifest.parameters },
      workflowConfig: stored.manifest.workflow as unknown as Record<string, unknown>,
      providerId: stored.manifest.provider.type,
      modelId: stored.manifest.provider.model,
    });
    this.registry.register({ manifest: structuredClone(stored.manifest), content: stored.content, directory: `admin://${id}` });
    this.skills.set(id, structuredClone(stored));
  }

  private async requireRecord(id: string): Promise<SkillRecord> {
    const record = await this.database.getSkill(id);
    if (!record) throw new Error('SKILL_NOT_FOUND');
    return record;
  }

  private async readCatalog(): Promise<SkillCatalogFile> {
    let text;
    try {
      text = await readFile(this.catalogFile, 'utf8');
    } catch (error) {
      if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') return { upserts: [], deletedIds: [] };
      throw new Error('SKILL_CATALOG_READ_FAILED');
    }
    try {
      const parsed = JSON.parse(text) as Partial<SkillCatalogFile>;
      if (!Array.isArray(parsed.upserts) || !Array.isArray(parsed.deletedIds) || parsed.deletedIds.some((id) => typeof id !== 'string')) throw new Error();
      return { upserts: parsed.upserts, deletedIds: parsed.deletedIds };
    } catch {
      throw new Error('SKILL_CATALOG_READ_FAILED');
    }
  }

  private async persist(): Promise<void> {
    const catalog: SkillCatalogFile = { upserts: [...this.upserts.values()], deletedIds: [...this.deletedIds] };
    try {
      await mkdir(dirname(this.catalogFile), { recursive: true });
      const temporary = `${this.catalogFile}.${process.pid}.tmp`;
      await writeFile(temporary, JSON.stringify(catalog, null, 2), { encoding: 'utf8', mode: 0o600 });
      await rename(temporary, this.catalogFile);
    } catch {
      throw new Error('SKILL_CATALOG_WRITE_FAILED');
    }
  }
}

function toStoredSkill(record: SkillRecord, loaded: LoadedSkill): StoredSkill {
  return {
    record: {
      id: record.id, slug: record.slug, name: record.name, description: record.description,
      ...(record.coverUrl ? { coverUrl: record.coverUrl } : {}), category: record.category,
      status: record.status, currentVersion: record.currentVersion ?? loaded.manifest.version, sort: record.sort,
    },
    manifest: structuredClone(loaded.manifest),
    content: loaded.content,
  };
}

function toDetail(stored: StoredSkill): AdminSkillDetail {
  const images = stored.manifest.input.images;
  return {
    id: stored.record.id,
    name: stored.record.name,
    description: stored.record.description,
    ...(stored.record.coverUrl ? { coverUrl: stored.record.coverUrl } : {}),
    category: stored.record.category,
    status: stored.record.status,
    version: stored.manifest.version,
    sort: stored.record.sort ?? 0,
    instructions: stored.content,
    imageMin: images.min,
    imageMax: images.max,
  };
}

function parseDetail(input: AdminSkillInput, id: string): AdminSkillDetail {
  const imageMin = requireInteger(input.imageMin, 'imageMin', 1, 8);
  const imageMax = requireInteger(input.imageMax, 'imageMax', imageMin, 8);
  return {
    id,
    name: requireText(input.name, 'name', 128),
    description: requireText(input.description, 'description', 2000),
    ...optionalUrl(input.coverUrl),
    category: requireIdentifier(input.category, 'category'),
    status: requireStatus(input.status),
    version: requireSemver(input.version),
    sort: requireInteger(input.sort, 'sort', 0, 9999),
    instructions: requireText(input.instructions, 'instructions', 20000),
    imageMin,
    imageMax,
  };
}

function fromDetail(detail: AdminSkillDetail, current?: SkillManifest): StoredSkill {
  const manifest: SkillManifest = {
    schemaVersion: '1.0',
    id: detail.id,
    name: detail.name,
    version: detail.version,
    description: detail.description,
    category: detail.category,
    input: { images: { min: detail.imageMin, max: detail.imageMax } },
    parameters: current?.parameters ?? {},
    provider: current?.provider ?? { type: 'mock', model: 'image-default' },
    workflow: current?.workflow ?? { type: 'sequential', steps: [{ type: 'image_edit' }] },
  };
  return {
    record: {
      id: detail.id,
      slug: detail.id,
      name: detail.name,
      description: detail.description,
      ...(detail.coverUrl ? { coverUrl: detail.coverUrl } : {}),
      category: detail.category,
      status: detail.status,
      currentVersion: detail.version,
      sort: detail.sort,
    },
    manifest,
    content: detail.instructions,
  };
}

function validateStoredSkill(stored: StoredSkill): void {
  if (!stored || typeof stored !== 'object' || !stored.record || !stored.manifest || stored.record.id !== stored.manifest.id) throw new Error('SKILL_CATALOG_READ_FAILED');
  parseDetail(toDetail(stored), stored.record.id);
}

function withoutId(input: CreateSkillInput): Omit<CreateSkillInput, 'id'> {
  const { id: _id, ...rest } = input;
  return rest;
}

function requireText(value: unknown, name: string, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw new Error(`INVALID_INPUT:${name}`);
  return value.trim();
}

function requireIdentifier(value: unknown, name: string): string {
  const text = requireText(value, name, 64);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(text)) throw new Error(`INVALID_INPUT:${name}`);
  return text;
}

function requireSemver(value: unknown): string {
  const text = requireText(value, 'version', 32);
  if (!/^\d+\.\d+\.\d+$/.test(text)) throw new Error('INVALID_INPUT:version');
  return text;
}

function requireStatus(value: unknown): SkillStatus {
  if (typeof value !== 'string' || !statuses.includes(value as SkillStatus)) throw new Error('INVALID_INPUT:status');
  return value as SkillStatus;
}

function requireInteger(value: unknown, name: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) throw new Error(`INVALID_INPUT:${name}`);
  return value;
}

function optionalUrl(value: unknown): { coverUrl?: string } {
  if (value === undefined || value === null || value === '') return {};
  const text = requireText(value, 'coverUrl', 512);
  let url;
  try { url = new URL(text); } catch { throw new Error('INVALID_INPUT:coverUrl'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('INVALID_INPUT:coverUrl');
  return { coverUrl: url.toString() };
}
