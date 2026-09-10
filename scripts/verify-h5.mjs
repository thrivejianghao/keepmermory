import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createStaticServer } from './static-server.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const outputDir = process.env.H5_QA_OUTPUT ?? join(process.cwd(), 'output/playwright');
await mkdir(outputDir, { recursive: true });
const server = await createStaticServer({ rootDir: join(process.cwd(), 'apps/web/static') });
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
const skill = { id: 'travel-postcard', name: 'Travel Postcard', description: 'Test', category: 'travel', version: '1.0.0' };
const model = { providerId: 'openai', modelId: 'gpt-image-1', name: 'OpenAI Image', description: 'Configured', available: true };

async function scenario(width, resultHandler) {
  const context = await browser.newContext({ viewport: { width, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  let creates = 0;
  let uploads = 0;
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const reply = (data, status = 200) => route.fulfill({ status, contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' },
      body: JSON.stringify({ code: status === 200 ? 0 : status, message: status === 200 ? 'success' : 'Temporary disconnect', data }) });
    if (route.request().method() === 'OPTIONS') return reply(null);
    if (path.endsWith('/health')) return reply({ provider: 'mock', status: 'ok' });
    if (path.endsWith('/skills')) return reply([skill]);
    if (path.endsWith('/models')) return reply({ items: [model], default: model });
    if (path.endsWith('/uploads')) { uploads++; return reply({ objectKey: 'uploads/photo.png', mimeType: 'image/png' }); }
    if (path.endsWith('/tasks')) {
      creates++;
      assert.equal(route.request().postDataJSON().providerId, 'openai');
      return reply({ taskId: 'test-task', taskNo: 'TEST-1', status: 'QUEUED' });
    }
    if (path.endsWith('/result')) return resultHandler(reply);
    if (path.includes('/files/')) return route.fulfill({ contentType: 'image/png', body: png });
    throw new Error(`Unexpected API call: ${path}`);
  });
  await page.goto(url);
  await page.locator('[data-skill]').click();
  await page.locator('#model-select:enabled').waitFor();
  await page.locator('#photo-input').setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: png });
  return { context, page, errors, counts: () => ({ creates, uploads }) };
}

const taskResult = (status, errorMessage = null) => ({
  task: { id: 'test-task', taskNo: 'TEST-1', skillId: skill.id, providerId: 'openai', modelId: 'gpt-image-1', status, progress: status === 'SUCCEEDED' ? 100 : 20, errorMessage },
  outputs: status === 'SUCCEEDED' ? [{ objectKey: 'outputs/result.png' }] : [],
});

try {
  let complete = false;
  const slow = await scenario(1280, (reply) => reply(taskResult(complete ? 'SUCCEEDED' : 'PROCESSING')));
  await slow.page.locator('#generate').click();
  await slow.page.waitForResponse((response) => response.url().endsWith('/result'));
  assert.equal(await slow.page.locator('#model-select').isDisabled(), true, 'Model must be locked while a task is running');
  assert.equal(await slow.page.locator('#photo-input').isDisabled(), true);
  await slow.page.waitForTimeout(35000);
  assert.equal(await slow.page.locator('#generate').isDisabled(), true, 'Slow image tasks must stay pending');
  assert.equal(await slow.page.locator('#create-error').textContent(), '');
  complete = true;
  await slow.page.locator('#result-flow.active').waitFor();
  await slow.page.locator('#result-image').evaluate((image) => image.decode());
  assert.deepEqual(slow.counts(), { creates: 1, uploads: 1 });
  assert.deepEqual(slow.errors, []);
  await slow.page.screenshot({ path: join(outputDir, 'generation-success-desktop.png'), fullPage: true });
  await slow.context.close();

  let disconnected = true;
  const resume = await scenario(390, (reply) => disconnected ? reply(null, 503) : reply(taskResult('SUCCEEDED')));
  await resume.page.locator('#generate').click();
  await resume.page.locator('#generate:enabled').waitFor();
  assert.match(await resume.page.locator('#generate').textContent(), /继续查询/);
  await resume.page.reload();
  await resume.page.locator('#create-flow.active').waitFor();
  assert.match(await resume.page.locator('#generate').textContent(), /继续查询/);
  disconnected = false;
  await resume.page.locator('#generate').click();
  await resume.page.locator('#result-flow.active').waitFor();
  assert.deepEqual(resume.counts(), { creates: 1, uploads: 1 }, 'Resuming must not upload or create another paid task');
  assert.deepEqual(resume.errors, []);
  await resume.context.close();

  const failed = await scenario(390, (reply) => reply(taskResult('FAILED', 'OPENAI_NETWORK_UNAVAILABLE')));
  await failed.page.locator('#generate').click();
  await failed.page.locator('#create-error .error').waitFor();
  assert.match(await failed.page.locator('#create-error').textContent(), /OpenAI/);
  assert.match(await failed.page.locator('#create-error').textContent(), /网络|连接/);
  assert.equal(await failed.page.locator('#generate').isEnabled(), true);
  assert.equal(await failed.page.locator('#model-select').isEnabled(), true);
  assert.equal(await failed.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.deepEqual(failed.errors, []);
  await failed.page.screenshot({ path: join(outputDir, 'generation-error-mobile.png'), fullPage: true });
  await failed.context.close();
  if (process.env.LIVE_H5_URL) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    await page.goto(process.env.LIVE_H5_URL);
    await page.locator('[data-skill="travel-postcard"]').click();
    await page.locator('#model-select:enabled').waitFor();
    await page.locator('#model-select').selectOption('mock/image-default');
    await page.locator('#photo-input').setInputFiles({ name: 'local-smoke.png', mimeType: 'image/png', buffer: png });
    await page.locator('#generate').click();
    await page.locator('#result-flow.active').waitFor();
    await page.locator('#result-image').evaluate((image) => image.decode());
    assert.match(await page.locator('#result-meta').textContent(), /mock\/image-default/);
    await context.close();
    console.log('Live H5 verified: browser upload -> API -> Mock worker -> rendered result.');
  }
  console.log('H5 verification passed: slow tasks, locked controls, reload/resume without duplicate tasks, network errors, desktop/mobile.');
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
