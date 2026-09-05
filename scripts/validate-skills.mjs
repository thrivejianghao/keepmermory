import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = new URL('../skills/', import.meta.url);
const entries = await readdir(root, { withFileTypes: true });
const errors = [];
for (const entry of entries) {
  if (!entry.isDirectory() || entry.name.startsWith('_')) continue;
  const directory = new URL(`${entry.name}/`, root);
  try {
    const manifest = JSON.parse(await readFile(new URL('skill.json', directory), 'utf8'));
    const required = ['schemaVersion', 'id', 'name', 'version', 'description', 'category', 'input', 'parameters', 'provider', 'workflow'];
    for (const key of required) if (!(key in manifest)) errors.push(`${entry.name}: missing ${key}`);
    if (manifest.id !== entry.name) errors.push(`${entry.name}: id mismatch`);
    if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) errors.push(`${entry.name}: invalid version`);
    if (!manifest.input?.images || manifest.input.images.min < 1 || manifest.input.images.max < manifest.input.images.min) errors.push(`${entry.name}: invalid image input`);
    if (!manifest.provider?.type || !manifest.provider?.model) errors.push(`${entry.name}: invalid provider`);
    if (!['sequential', 'parallel', 'conditional'].includes(manifest.workflow?.type)) errors.push(`${entry.name}: invalid workflow`);
    await readFile(new URL('SKILL.md', directory), 'utf8');
    await readFile(new URL('prompts/system.md', directory), 'utf8');
    await readFile(new URL('prompts/generation.md', directory), 'utf8');
  } catch (error) {
    errors.push(`${entry.name}: ${error instanceof Error ? error.message : 'invalid skill'}`);
  }
}
if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; } else console.log(`Validated ${entries.filter((entry) => entry.isDirectory() && !entry.name.startsWith('_')).length} skills.`);
