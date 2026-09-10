export interface SkillManagerOptions {
  onChanged?: () => void;
}

export function mountSkillManager(
  root: HTMLElement,
  apiBase: string,
  options?: SkillManagerOptions,
): () => void;
