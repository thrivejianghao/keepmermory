import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { createApiServer } from '../apps/api/dist/index.js';
import { compatibleFetch } from '../packages/ai-provider/dist/index.js';
import { createStaticServer } from './static-server.mjs';

const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const root = await mkdtemp(join(process.env.TEMP, 'admin-skills-'));
const skillDir = join(root, 'skills', 'built-in');
const output = join(root, 'output/playwright');
await mkdir(skillDir, { recursive: true });
await mkdir(output, { recursive: true });
await writeFile(join(skillDir, 'skill.json'), JSON.stringify({
  schemaVersion: '1.0', id: 'built-in', name: '内置 Skill', version: '1.0.0',
  description: '内置测试 Skill', category: 'test', input: { images: { min: 1, max: 1 } },
  parameters: {}, provider: { type: 'mock', model: 'image-default' },
  workflow: { type: 'sequential', steps: [{ type: 'image_edit' }] },
}));
await writeFile(join(skillDir, 'SKILL.md'), 'Preserve the input image.');

const api = await createApiServer({ skillsDir: join(root, 'skills'), storageDir: join(root, 'storage'), aiProvider: 'mock' });
await new Promise((resolve) => api.listen(0, '127.0.0.1', resolve));
const apiAddress = api.address();
assert.ok(apiAddress && typeof apiAddress === 'object');
const admin = await createStaticServer({ rootDir: join(process.cwd(), 'apps/admin/static'), htmlReplacements: { '__API_PORT__': String(apiAddress.port) } });
await new Promise((resolve) => admin.listen(0, '127.0.0.1', resolve));
const adminAddress = admin.address();
assert.ok(adminAddress && typeof adminAddress === 'object');
const url = `http://127.0.0.1:${adminAddress.port}/`;
const browser = await chromium.launch({ channel: 'msedge', headless: true });

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 960 } });
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto(url);

  await page.getByRole('button', { name: 'Skill 管理', exact: true }).click();
  await page.getByRole('button', { name: '新建 Skill', exact: true }).click();
  await page.locator('#skill-id').fill('browser-created');
  await page.locator('#skill-name').fill('浏览器创建 Skill');
  await page.locator('#skill-description').fill('通过后台完整创建的 Skill');
  await page.locator('#skill-category').fill('portrait');
  await page.locator('#skill-instructions').fill('Preserve identity and produce a clean portrait.');
  await page.getByRole('button', { name: '保存 Skill', exact: true }).click();
  const row = page.locator('[data-skill-row="browser-created"]');
  await row.waitFor();
  assert.match(await row.textContent(), /浏览器创建 Skill/);
  assert.match(await row.textContent(), /DRAFT/);

  await row.getByRole('button', { name: '查看', exact: true }).click();
  const detail = page.locator('.skill-detail-dialog[open]');
  assert.match(await detail.textContent(), /Preserve identity/);
  await detail.locator('.skill-detail-done').click();

  await row.getByRole('button', { name: '编辑', exact: true }).click();
  await page.locator('#skill-name').fill('已发布浏览器 Skill');
  await page.locator('#skill-status').selectOption('PUBLISHED');
  await page.locator('#skill-version').fill('1.1.0');
  await page.getByRole('button', { name: '保存 Skill', exact: true }).click();
  await page.locator('[data-skill-row="browser-created"]').filter({ hasText: '已发布浏览器 Skill' }).waitFor();

  const publicResponse = await compatibleFetch(`http://127.0.0.1:${apiAddress.port}/api/v1/skills`);
  const publicBody = await publicResponse.json();
  assert.equal(publicBody.data.some((skill) => skill.id === 'browser-created' && skill.version === '1.1.0'), true);

  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('[data-skill-row="browser-created"]').getByRole('button', { name: '删除', exact: true }).click();
  await page.locator('[data-skill-row="browser-created"]').waitFor({ state: 'detached' });
  assert.equal((await compatibleFetch(`http://127.0.0.1:${apiAddress.port}/api/v1/skills`).then((response) => response.json())).data.some((skill) => skill.id === 'browser-created'), false);

  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  const mobileEdit = await page.locator('[data-skill-row="built-in"]').getByRole('button', { name: '编辑', exact: true }).boundingBox();
  assert.ok(mobileEdit && mobileEdit.x + mobileEdit.width <= 390, 'Skill actions must be visible without horizontal scrolling on mobile');
  assert.deepEqual(pageErrors, []);
  await page.screenshot({ path: join(output, 'skill-manager-mobile.png'), fullPage: true });
  await page.setViewportSize({ width: 1280, height: 960 });
  await page.screenshot({ path: join(output, 'skill-manager-desktop.png'), fullPage: true });
  console.log('Admin Skill browser verification passed: create, read, update, publish, delete, and responsive layout. Screenshots: ' + output);
} finally {
  await browser.close();
  for (const server of [admin, api]) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}
