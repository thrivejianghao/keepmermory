import { api, type ApiClient, type ParameterValue, type Skill, type SkillParameterDefinition } from './api';

export interface ParameterField {
  key: string;
  label: string;
  type: SkillParameterDefinition['type'];
  value: ParameterValue;
  options: Array<{ label: string; value: string }>;
  optionIndex: number;
}

const defaultValue = (definition: SkillParameterDefinition): ParameterValue => {
  if (definition.default !== undefined) return definition.default;
  if (definition.type === 'select') return definition.options?.[0]?.value ?? '';
  if (definition.type === 'number') return 0;
  if (definition.type === 'boolean') return false;
  return '';
};

export function createSkillService(client: ApiClient) {
  return {
    async list(): Promise<Skill[]> {
      const skills = await client.skills();
      return skills.filter((item) => !item.status || item.status === 'PUBLISHED');
    },
    get: (id: string): Promise<Skill> => client.skill(id),
    parameterFields(skill: Skill): ParameterField[] {
      return Object.entries(skill.parameters).map(([key, definition]) => {
        const options = definition.options ?? [];
        const value = defaultValue(definition);
        return { key, label: definition.label, type: definition.type, value, options, optionIndex: Math.max(0, options.findIndex((item) => item.value === value)) };
      });
    },
    toParameters(fields: ParameterField[]): Record<string, ParameterValue> {
      return Object.fromEntries(fields.map((field) => [field.key, field.value]));
    },
    validateParameters(skill: Skill, parameters: Record<string, unknown>): void {
      for (const [key, definition] of Object.entries(skill.parameters)) {
        const value = parameters[key];
        const valid = definition.type === 'select'
          ? definition.options?.some((option) => option.value === value) === true
          : definition.type === 'number'
            ? typeof value === 'number' && Number.isFinite(value)
            : definition.type === 'boolean'
              ? typeof value === 'boolean'
              : typeof value === 'string';
        if (!valid) throw new Error(`${definition.label} 参数无效`);
      }
    },
  };
}

export const skillService = createSkillService(api);
