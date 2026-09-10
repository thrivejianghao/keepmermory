import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export type ConfiguredProviderId = 'openai' | 'gemini' | 'qwen';
export type ModelProviderId = 'mock' | ConfiguredProviderId;
export type SkillAgentProtocol = 'openai-compatible';
export type SecretSource = 'environment' | 'persisted' | 'cleared' | 'none';

export interface RuntimeProviderConfig {
  providerId: ConfiguredProviderId;
  enabled: boolean;
  modelId: string;
  endpoint: string;
  apiKey?: string;
  secretSource: SecretSource;
}

export interface RuntimeModelConfig {
  defaultProvider: ModelProviderId;
  providers: RuntimeProviderConfig[];
  skillAgent: RuntimeSkillAgentConfig;
}

export interface RuntimeSkillAgentConfig {
  enabled: boolean;
  protocol: SkillAgentProtocol;
  modelId: string;
  endpoint: string;
  apiKey?: string;
  secretSource: SecretSource;
}

interface PersistedProviderConfig {
  providerId: ConfiguredProviderId;
  enabled: boolean;
  modelId: string;
  endpoint: string;
  apiKey?: string | null;
}

interface PersistedModelConfig {
  defaultProvider: ModelProviderId;
  providers: PersistedProviderConfig[];
  skillAgent?: PersistedSkillAgentConfig;
}

interface PersistedSkillAgentConfig {
  enabled: boolean;
  protocol: SkillAgentProtocol;
  modelId: string;
  endpoint: string;
  apiKey?: string | null;
}

export interface PublicProviderConfig {
  providerId: ConfiguredProviderId;
  name: string;
  description: string;
  enabled: boolean;
  modelId: string;
  endpoint: string;
  keyConfigured: boolean;
}

export interface PublicModelConfig {
  defaultProvider: ModelProviderId;
  providers: PublicProviderConfig[];
  skillAgent: PublicSkillAgentConfig;
}

export interface PublicSkillAgentConfig {
  name: string;
  description: string;
  enabled: boolean;
  protocol: SkillAgentProtocol;
  modelId: string;
  endpoint: string;
  keyConfigured: boolean;
}

export interface ModelConfigInput {
  defaultProvider: unknown;
  providers: unknown;
  skillAgent?: unknown;
}

const providerIds: ConfiguredProviderId[] = ['openai', 'gemini', 'qwen'];
const providerMeta: Record<ConfiguredProviderId, { name: string; description: string }> = {
  openai: { name: 'OpenAI Image', description: 'OpenAI 兼容图像模型' },
  gemini: { name: 'Gemini Image', description: 'Google Gemini 图像模型' },
  qwen: { name: 'Qwen Image', description: '阿里云通义千问图像模型' },
};

export function defaultModelConfig(env: NodeJS.ProcessEnv): RuntimeModelConfig {
  const defaultProvider = isModelProviderId(env.AI_PROVIDER) ? env.AI_PROVIDER : 'mock';
  const skillAgentKey = env.SKILL_AGENT_API_KEY?.trim();
  return {
    defaultProvider,
    providers: providerIds.map((providerId) => {
      const apiKey = environmentKey(providerId, env);
    return {
      providerId,
      enabled: Boolean(apiKey),
      modelId: environmentModel(providerId, env),
      endpoint: environmentEndpoint(providerId, env),
      ...(apiKey ? { apiKey } : {}),
      secretSource: apiKey ? 'environment' : 'none',
      };
    }),
    skillAgent: {
      enabled: Boolean(skillAgentKey),
      protocol: 'openai-compatible',
      modelId: env.SKILL_AGENT_MODEL?.trim() || 'qwen3-coder-plus',
      endpoint: normalizeEndpoint(env.SKILL_AGENT_BASE_URL ?? 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1', 'skill-agent', 'MODEL_CONFIG_INVALID'),
      ...(skillAgentKey ? { apiKey: skillAgentKey } : {}),
      secretSource: skillAgentKey ? 'environment' : 'none',
    },
  };
}

export async function loadModelConfig(filePath: string, env: NodeJS.ProcessEnv): Promise<RuntimeModelConfig> {
  const fallback = defaultModelConfig(env);
  let text: string;
  try {
    text = await readFile(filePath, 'utf8');
  } catch (error) {
    if (isNotFound(error)) return fallback;
    throw new Error('MODEL_CONFIG_READ_FAILED');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('MODEL_CONFIG_READ_FAILED');
  }
  return mergePersistedConfig(fallback, parsed);
}

export async function saveModelConfig(filePath: string, current: RuntimeModelConfig, input: ModelConfigInput): Promise<RuntimeModelConfig> {
  const next = validateAndMerge(current, input);
  const persisted: PersistedModelConfig = {
    defaultProvider: next.defaultProvider,
    providers: next.providers.map((provider) => ({
      providerId: provider.providerId,
      enabled: provider.enabled,
      modelId: provider.modelId,
      endpoint: provider.endpoint,
      ...(provider.secretSource === 'persisted' && provider.apiKey ? { apiKey: provider.apiKey } : {}),
      ...(provider.secretSource === 'cleared' ? { apiKey: null } : {}),
    })),
    skillAgent: {
      enabled: next.skillAgent.enabled,
      protocol: next.skillAgent.protocol,
      modelId: next.skillAgent.modelId,
      endpoint: next.skillAgent.endpoint,
      ...(next.skillAgent.secretSource === 'persisted' && next.skillAgent.apiKey ? { apiKey: next.skillAgent.apiKey } : {}),
      ...(next.skillAgent.secretSource === 'cleared' ? { apiKey: null } : {}),
    },
  };
  try {
    await mkdir(dirname(filePath), { recursive: true });
    const temporary = `${filePath}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(persisted, null, 2), { encoding: 'utf8', mode: 0o600 });
    await rename(temporary, filePath);
  } catch {
    throw new Error('MODEL_CONFIG_WRITE_FAILED');
  }
  return next;
}

export function toPublicModelConfig(config: RuntimeModelConfig): PublicModelConfig {
  return {
    defaultProvider: config.defaultProvider,
    providers: config.providers.map((provider) => ({
      providerId: provider.providerId,
      ...providerMeta[provider.providerId],
      enabled: provider.enabled,
      modelId: provider.modelId,
      endpoint: provider.endpoint,
      keyConfigured: Boolean(provider.apiKey),
    })),
    skillAgent: {
      name: 'Skill 编排模型',
      description: 'OpenAI 兼容文本模型，通过工具调用规划 Skill 的图片执行提示词',
      enabled: config.skillAgent.enabled,
      protocol: config.skillAgent.protocol,
      modelId: config.skillAgent.modelId,
      endpoint: config.skillAgent.endpoint,
      keyConfigured: Boolean(config.skillAgent.apiKey),
    },
  };
}

export function providerKey(config: RuntimeModelConfig, providerId: ConfiguredProviderId): string | undefined {
  return config.providers.find((provider) => provider.providerId === providerId)?.apiKey;
}

export function providerConfig(config: RuntimeModelConfig, providerId: ConfiguredProviderId): RuntimeProviderConfig {
  const provider = config.providers.find((candidate) => candidate.providerId === providerId);
  if (!provider) throw new Error('MODEL_CONFIG_INVALID');
  return provider;
}

function mergePersistedConfig(fallback: RuntimeModelConfig, value: unknown): RuntimeModelConfig {
  const object = asObject(value);
  if (!object || !isModelProviderId(object.defaultProvider) || !Array.isArray(object.providers) || object.providers.length !== providerIds.length) {
    throw new Error('MODEL_CONFIG_READ_FAILED');
  }
  const persisted = new Map<ConfiguredProviderId, PersistedProviderConfig>();
  for (const item of object.providers) {
    const parsed = parsePersistedProvider(item);
    if (persisted.has(parsed.providerId)) throw new Error('MODEL_CONFIG_READ_FAILED');
    persisted.set(parsed.providerId, parsed);
  }
  if (persisted.size !== providerIds.length) throw new Error('MODEL_CONFIG_READ_FAILED');
  const providers: RuntimeProviderConfig[] = providerIds.map((providerId) => {
    const base = fallback.providers.find((provider) => provider.providerId === providerId);
    const saved = persisted.get(providerId);
    if (!base || !saved) throw new Error('MODEL_CONFIG_READ_FAILED');
    const hasSecret = Object.prototype.hasOwnProperty.call(saved, 'apiKey');
    const apiKey = hasSecret ? (saved.apiKey ?? undefined) : base.apiKey;
    const secretSource: SecretSource = hasSecret ? (saved.apiKey ? 'persisted' : 'cleared') : (base.apiKey ? 'environment' : 'none');
    return {
      providerId,
      enabled: saved.enabled,
      modelId: saved.modelId,
      endpoint: saved.endpoint,
      ...(apiKey ? { apiKey } : {}),
      secretSource,
    };
  });
  const savedDefault = object.defaultProvider;
  const defaultProvider = savedDefault === 'mock' || providers.some((provider) => provider.providerId === savedDefault && provider.enabled && provider.apiKey) ? savedDefault : 'mock';
  return {
    defaultProvider,
    providers,
    skillAgent: mergePersistedSkillAgent(fallback.skillAgent, object.skillAgent),
  };
}

function validateAndMerge(current: RuntimeModelConfig, input: ModelConfigInput): RuntimeModelConfig {
  const object = asObject(input);
  if (!object || !isModelProviderId(object.defaultProvider) || !Array.isArray(object.providers) || object.providers.length !== providerIds.length) {
    throw new Error('INVALID_INPUT:model-config');
  }
  const nextProviders: RuntimeProviderConfig[] = [];
  const seen = new Set<string>();
  for (const raw of object.providers) {
    const item = asObject(raw);
    if (!item) throw new Error('INVALID_INPUT:model-config');
    const providerId = item.providerId;
    if (!isConfiguredProviderId(providerId) || seen.has(providerId)) throw new Error('INVALID_INPUT:model-config');
    seen.add(providerId);
    const currentProvider = current.providers.find((provider) => provider.providerId === providerId);
    if (!currentProvider || typeof item.enabled !== 'boolean') throw new Error('INVALID_INPUT:model-config');
    const modelId = requireModelId(item.modelId);
    const endpoint = normalizeEndpoint(item.endpoint, providerId);
    const clearApiKey = item.clearApiKey === true;
    const submittedKey = item.apiKey;
    if (item.clearApiKey !== undefined && typeof item.clearApiKey !== 'boolean') throw new Error('INVALID_INPUT:model-config');
    if (submittedKey !== undefined && (typeof submittedKey !== 'string' || submittedKey.length > 4096 || /[^\x20-\x7e]/.test(submittedKey) || submittedKey.includes('****'))) throw new Error('INVALID_INPUT:model-config');
    if (clearApiKey && typeof submittedKey === 'string' && submittedKey.trim()) throw new Error('INVALID_INPUT:model-config');
    let apiKey = currentProvider.apiKey;
    let secretSource = currentProvider.secretSource;
    if (clearApiKey) {
      apiKey = undefined;
      secretSource = 'cleared';
    } else if (typeof submittedKey === 'string' && submittedKey.trim()) {
      apiKey = submittedKey.trim();
      secretSource = 'persisted';
    }
    nextProviders.push({ providerId, enabled: item.enabled, modelId, endpoint, ...(apiKey ? { apiKey } : {}), secretSource });
  }
  if (seen.size !== providerIds.length) throw new Error('INVALID_INPUT:model-config');
  const defaultProvider = object.defaultProvider;
  const defaultEnabled = defaultProvider === 'mock' || nextProviders.some((provider) => provider.providerId === defaultProvider && provider.enabled && provider.apiKey);
  if (!defaultEnabled) throw new Error('INVALID_INPUT:default-provider');
  return { defaultProvider, providers: nextProviders, skillAgent: validateSkillAgent(current.skillAgent, object.skillAgent) };
}

function mergePersistedSkillAgent(fallback: RuntimeSkillAgentConfig, value: unknown): RuntimeSkillAgentConfig {
  if (value === undefined) return fallback;
  const object = asObject(value);
  if (!object || typeof object.enabled !== 'boolean' || object.protocol !== 'openai-compatible') throw new Error('MODEL_CONFIG_READ_FAILED');
  const apiKey = parsePersistedApiKey(object.apiKey);
  const hasSecret = Object.prototype.hasOwnProperty.call(object, 'apiKey');
  const resolvedKey = hasSecret ? (apiKey ?? undefined) : fallback.apiKey;
  const secretSource: SecretSource = hasSecret ? (apiKey ? 'persisted' : 'cleared') : fallback.secretSource;
  const result: RuntimeSkillAgentConfig = {
    enabled: object.enabled,
    protocol: 'openai-compatible',
    modelId: requireModelId(object.modelId, 'MODEL_CONFIG_READ_FAILED'),
    endpoint: normalizeEndpoint(object.endpoint, 'skill-agent', 'MODEL_CONFIG_READ_FAILED'),
    ...(resolvedKey ? { apiKey: resolvedKey } : {}),
    secretSource,
  };
  if (result.enabled && !result.apiKey) throw new Error('MODEL_CONFIG_READ_FAILED');
  return result;
}

function validateSkillAgent(current: RuntimeSkillAgentConfig, value: unknown): RuntimeSkillAgentConfig {
  if (value === undefined) return current;
  const object = asObject(value);
  if (!object || typeof object.enabled !== 'boolean' || object.protocol !== 'openai-compatible') throw new Error('INVALID_INPUT:skill-agent');
  const submittedKey = object.apiKey;
  const clearApiKey = object.clearApiKey === true;
  validateSubmittedKey(submittedKey, object.clearApiKey, clearApiKey, 'INVALID_INPUT:skill-agent');
  let apiKey = current.apiKey;
  let secretSource = current.secretSource;
  if (clearApiKey) {
    apiKey = undefined;
    secretSource = 'cleared';
  } else if (typeof submittedKey === 'string' && submittedKey.trim()) {
    apiKey = submittedKey.trim();
    secretSource = 'persisted';
  }
  if (object.enabled && !apiKey) throw new Error('INVALID_INPUT:skill-agent');
  return {
    enabled: object.enabled,
    protocol: 'openai-compatible',
    modelId: requireModelId(object.modelId),
    endpoint: normalizeEndpoint(object.endpoint, 'skill-agent'),
    ...(apiKey ? { apiKey } : {}),
    secretSource,
  };
}

function parsePersistedProvider(value: unknown): PersistedProviderConfig {
  const object = asObject(value);
  if (!object || !isConfiguredProviderId(object.providerId) || typeof object.enabled !== 'boolean') throw new Error('MODEL_CONFIG_READ_FAILED');
    const endpoint = normalizeEndpoint(object.endpoint, object.providerId, 'MODEL_CONFIG_READ_FAILED');
  const apiKey = object.apiKey;
  if (apiKey !== undefined && apiKey !== null && (typeof apiKey !== 'string' || !apiKey.trim())) throw new Error('MODEL_CONFIG_READ_FAILED');
  const modelId = typeof object.modelId === 'string' && object.modelId.includes('://') ? environmentModel(object.providerId, process.env) : requireModelId(object.modelId, 'MODEL_CONFIG_READ_FAILED');
  const usableKey = typeof apiKey === 'string' && !apiKey.includes('****') ? apiKey : apiKey === null ? null : undefined;
  return { providerId: object.providerId, enabled: object.enabled, modelId, endpoint, ...(usableKey === undefined ? {} : { apiKey: usableKey }) };
}

function parsePersistedApiKey(value: unknown): string | null | undefined {
  if (value !== undefined && value !== null && (typeof value !== 'string' || !value.trim())) throw new Error('MODEL_CONFIG_READ_FAILED');
  if (typeof value === 'string' && value.includes('****')) return undefined;
  return typeof value === 'string' ? value.trim() : value;
}

function validateSubmittedKey(value: unknown, clearValue: unknown, clearApiKey: boolean, errorCode: string): void {
  if (clearValue !== undefined && typeof clearValue !== 'boolean') throw new Error(errorCode);
  if (value !== undefined && (typeof value !== 'string' || value.length > 4096 || /[^\x20-\x7e]/.test(value) || value.includes('****'))) throw new Error(errorCode);
  if (clearApiKey && typeof value === 'string' && value.trim()) throw new Error(errorCode);
}

function normalizeEndpoint(value: unknown, providerId: ConfiguredProviderId | 'skill-agent', errorCode = 'INVALID_INPUT:model-config'): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(errorCode);
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new Error(errorCode); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error(errorCode);
  if ((providerId === 'openai' || providerId === 'skill-agent') && (!url.pathname || url.pathname === '/')) url.pathname = '/v1';
  url.pathname = url.pathname.replace(/\/+$/, '') || '/';
  return url.toString().replace(/\/$/, '');
}

function requireModelId(value: unknown, errorCode = 'INVALID_INPUT:model-config'): string {
  if (typeof value !== 'string' || value.includes('://') || !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,199}$/.test(value.trim())) throw new Error(errorCode);
  return value.trim();
}

function environmentKey(providerId: ConfiguredProviderId, env: NodeJS.ProcessEnv): string | undefined {
  const value = providerId === 'openai' ? env.OPENAI_API_KEY : providerId === 'gemini' ? env.GEMINI_API_KEY : env.DASHSCOPE_API_KEY ?? env.QWEN_API_KEY;
  return value?.trim() || undefined;
}

function environmentModel(providerId: ConfiguredProviderId, env: NodeJS.ProcessEnv): string {
  return providerId === 'openai' ? env.OPENAI_MODEL ?? env.AI_MODEL ?? 'gpt-image-1' : providerId === 'gemini' ? env.GEMINI_MODEL ?? 'gemini-2.5-flash-image' : env.QWEN_MODEL ?? 'qwen-image-edit-plus';
}

function environmentEndpoint(providerId: ConfiguredProviderId, env: NodeJS.ProcessEnv): string {
  const endpoint = providerId === 'openai' ? env.OPENAI_BASE_URL ?? env.OPENAI_API_BASE ?? 'https://api.openai.com/v1' : providerId === 'gemini' ? env.GEMINI_BASE_URL ?? 'https://generativelanguage.googleapis.com/v1beta' : env.QWEN_BASE_URL ?? 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation';
  return normalizeEndpoint(endpoint, providerId, 'MODEL_CONFIG_INVALID');
}

function isConfiguredProviderId(value: unknown): value is ConfiguredProviderId { return typeof value === 'string' && providerIds.includes(value as ConfiguredProviderId); }
function isModelProviderId(value: unknown): value is ModelProviderId { return value === 'mock' || isConfiguredProviderId(value); }
function asObject(value: unknown): Record<string, unknown> | undefined { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined; }
function isNotFound(error: unknown): boolean { return error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT'; }
