import assert from 'node:assert/strict';
import { mkdtemp, readFile, mkdir, writeFile } from 'node:fs/promises';
import { createServer, request as httpRequest } from 'node:http';
import { join } from 'node:path';
import { createApiServer } from '../apps/api/dist/index.js';

const root = await mkdtemp(join(process.env.TEMP ?? 'E:/codex-temp', 'model-config-'));
const configFile = join(root, '.local/models.json');
const options = { skillsDir: join(process.cwd(), 'skills'), storageDir: join(root, 'storage'), configFile,
  openAiApiKey: 'inherited-test-key', geminiApiKey: '', qwenApiKey: '' };
const headers = { 'Content-Type': 'application/json', 'X-Admin-Config': '1' };
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
const calls = [];
const relay = createServer(async (req, res) => {
  if (req.url === '/download') { res.writeHead(302, { Location: '/result' }).end(); return; }
  if (req.url === '/result') { res.setHeader('Content-Type', 'image/png'); res.end(Buffer.from(png, 'base64')); return; }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  calls.push({ path: req.url, key: req.headers.authorization ?? req.headers['x-goog-api-key'], body: Buffer.concat(chunks).toString() });
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(req.url.includes('/chat/completions')
    ? { choices: [{ message: { tool_calls: [{ type: 'function', function: {
      name: 'execute_image_skill', arguments: JSON.stringify({ prompt: 'Token Plan generated execution prompt' }),
    } }] } }] }
    : req.url.includes(':generateContent')
    ? { candidates: [{ content: { parts: [{ inlineData: { data: png, mimeType: 'image/png' } }] } }] }
    : req.url.includes('qwen') ? { output: { results: [{ url: `http://${req.headers.host}/download` }] } } : { data: [{ b64_json: png }] }));
});
let api;
let base;
async function start() {
  api = await createApiServer(options);
  base = await listen(api);
}
async function listen(server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${server.address().port}`;
}
async function close(server) {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
const config = () => request('/admin/model-config', { headers });
const save = (body, customHeaders = headers) => request('/admin/model-config', { method: 'POST', headers: customHeaders, body: JSON.stringify(body) });
function request(path, init = {}) {
  return new Promise((resolve, reject) => {
    const req = httpRequest(base + '/api/v1' + path, init, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString();
        resolve({ status: res.statusCode, body: JSON.parse(text), text, headers: res.headers });
      });
    });
    req.on('error', reject);
    if (init.body) req.write(init.body);
    req.end();
  });
}

try {
  const legacyConfigFile = join(root, 'legacy-models.json');
  await writeFile(legacyConfigFile, JSON.stringify({ defaultProvider: 'mock', providers: [
    { providerId: 'openai', enabled: false, modelId: 'gpt-image-1', endpoint: 'https://api.openai.com/v1' },
    { providerId: 'gemini', enabled: false, modelId: 'gemini-2.5-flash-image', endpoint: 'https://generativelanguage.googleapis.com/v1beta' },
    { providerId: 'qwen', enabled: true, modelId: 'https://workspace.example/compatible-mode/v1', endpoint: 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation', apiKey: 'legacy-key' },
  ] }));
  const legacy = await createApiServer({ ...options, configFile: legacyConfigFile, openAiApiKey: '', geminiApiKey: '', qwenApiKey: '' });
  await new Promise((resolve) => legacy.listen(0, '127.0.0.1', resolve));
  const legacyBase = `http://127.0.0.1:${legacy.address().port}`;
  const legacyModels = await new Promise((resolve, reject) => httpRequest(legacyBase + '/api/v1/models', (res) => { const parts = []; res.on('data', (part) => parts.push(part)); res.on('end', () => resolve(JSON.parse(Buffer.concat(parts).toString()))); }).on('error', reject).end());
  assert.equal(legacyModels.data.items.find((item) => item.providerId === 'qwen').modelId, 'qwen-image-edit-plus', 'Old URL-in-model fields must migrate to the default model ID');
  await close(legacy);
  const relayUrl = await listen(relay);
  await start();
  const initial = await config();
  assert.equal(initial.status, 200, 'Admin must expose a model configuration entry');
  assert.equal(initial.body.data.providers.length, 3);
  assert.ok(initial.body.data.skillAgent, 'Admin must expose a separate Skill agent configuration');
  assert.equal(initial.body.data.skillAgent.protocol, 'openai-compatible');
  assert.equal(initial.body.data.skillAgent.keyConfigured, false);
  assert.equal(initial.body.data.providers[0].keyConfigured, true);
  assert.equal(initial.text.includes('inherited-test-key'), false, 'Read responses must never expose keys');
  assert.equal((await request('/admin/model-config')).status, 403);
  assert.equal((await config()).headers['cache-control'], 'no-store');
  let next = initial.body.data;
  next.defaultProvider = 'openai';
  next.providers = next.providers.map((item) => ({ ...item, enabled: true, apiKey: `local-test-${item.providerId}`,
    modelId: `test-image-${item.providerId}`, endpoint: item.providerId === 'openai' ? relayUrl : `${relayUrl}/${item.providerId}` }));
  next.skillAgent = { ...next.skillAgent, enabled: true, modelId: 'qwen3-coder-plus',
    endpoint: `${relayUrl}/compatible-mode/v1`, apiKey: 'token-plan-test-key' };
  const saved = await save(next);
  assert.equal(saved.status, 200);
  assert.equal(saved.text.includes('local-test-'), false);
  assert.equal(saved.text.includes('token-plan-test-key'), false);
  assert.equal(saved.body.data.skillAgent.keyConfigured, true);
  assert.equal(saved.body.data.skillAgent.endpoint, `${relayUrl}/compatible-mode/v1`);
  assert.equal(saved.body.data.providers[0].endpoint, relayUrl + '/v1');
  const publicModels = await request('/models');
  assert.equal(publicModels.body.data.default.modelId, 'test-image-openai');
  assert.equal(publicModels.text.includes(relayUrl), false);
  assert.equal(publicModels.text.includes('local-test-'), false);
  assert.equal((await request('/health')).body.data.provider, 'openai');

  for (const providerId of ['openai', 'gemini', 'qwen']) {
    const boundary = 'model-config-upload';
    const upload = await request('/uploads', { method: 'POST', headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
      body: Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.png"\r\nContent-Type: image/png\r\n\r\n`), Buffer.from(png, 'base64'), Buffer.from(`\r\n--${boundary}--\r\n`)]) });
    const task = await request('/tasks', { method: 'POST', headers, body: JSON.stringify({ skillId: 'travel-postcard', providerId,
      modelId: `test-image-${providerId}`, images: [{ objectKey: upload.body.data.objectKey, mimeType: 'image/png' }] }) });
    assert.equal(task.status, 200);
    let result;
    for (let attempt = 0; attempt < 100; attempt++) {
      result = await request(`/tasks/${task.body.data.taskId}/result`);
      if (['SUCCEEDED', 'FAILED'].includes(result.body.data.task.status)) break;
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    assert.equal(result.body.data.task.status, 'SUCCEEDED', providerId + ' must execute with the saved configuration: ' + result.body.data.task.errorMessage);
    assert.equal(result.text.includes('local-test-'), false);
  }
  const agentCalls = calls.filter((call) => call.path === '/compatible-mode/v1/chat/completions');
  const imageCalls = calls.filter((call) => call.path !== '/compatible-mode/v1/chat/completions');
  assert.equal(agentCalls.length, 3, 'Every enabled task must be planned through the configured Skill agent');
  assert.equal(agentCalls[0].key, 'Bearer token-plan-test-key');
  assert.equal(JSON.parse(agentCalls[0].body).model, 'qwen3-coder-plus');
  assert.equal(JSON.parse(agentCalls[0].body).tools[0].function.name, 'execute_image_skill');
  assert.equal(imageCalls.length, 3);
  assert.equal(imageCalls[0].path, '/v1/images/edits');
  assert.equal(imageCalls[0].key, 'Bearer local-test-openai');
  assert.match(imageCalls[0].body, /Token Plan generated execution prompt/);
  assert.equal(imageCalls[1].path, '/gemini/models/test-image-gemini:generateContent');
  assert.equal(imageCalls[1].key, 'local-test-gemini');
  assert.match(imageCalls[1].body, /Token Plan generated execution prompt/);
  assert.equal(imageCalls[2].path, '/qwen');
  assert.equal(JSON.parse(imageCalls[2].body).model, 'test-image-qwen');
  assert.equal(imageCalls[2].key, 'Bearer local-test-qwen');
  assert.match(imageCalls[2].body, /Token Plan generated execution prompt/);

  const before = await readFile(configFile, 'utf8');
  assert.equal(before.includes('inherited-test-key'), false, 'Unchanged environment secrets must not be copied to disk');
  assert.equal((await save(next, { ...headers, Origin: 'https://evil.example' })).status, 403);
  assert.equal((await save(next, { ...headers, Host: 'evil.example' })).status, 403);
  for (const endpoint of ['file:///etc/passwd', 'https://user:secret@example.com', 'https://example.com/?key=secret', 'not-a-url']) {
    const invalid = structuredClone(next);
    invalid.providers[0].endpoint = endpoint;
    const result = await save(invalid);
    assert.equal(result.status, 400);
    assert.equal(result.text.includes('secret'), false);
  }
  for (const modelId of ['https://example.com/model', 'http://model', 'https://ws-example/compatible-mode/v1']) {
    const invalid = structuredClone(next);
    invalid.providers[0].modelId = modelId;
    assert.equal((await save(invalid)).status, 400, 'Model fields must contain a model ID, not a URL');
  }
  for (const endpoint of ['file:///etc/passwd', 'https://user:secret@example.com', 'https://example.com/?key=secret']) {
    const invalid = structuredClone(next);
    invalid.skillAgent.endpoint = endpoint;
    assert.equal((await save(invalid)).status, 400, 'Skill agent endpoints must reject unsafe URLs');
  }
  {
    const invalid = structuredClone(next);
    invalid.skillAgent.modelId = 'https://example.com/model';
    assert.equal((await save(invalid)).status, 400, 'Skill agent model fields must contain an ID');
  }
  {
    const invalid = structuredClone(next);
    invalid.providers[0].apiKey = 'sk-test-****-masked';
    assert.equal((await save(invalid)).status, 400, 'Redacted console keys must not replace a real key');
  }
  assert.equal((await save(null)).status, 400);
  assert.equal((await save({ ...next, providers: [] })).status, 400);
  for (const badValue of [true, null, 'bad\nkey', 'x'.repeat(4097)]) {
    const invalid = structuredClone(next);
    invalid.providers[0].apiKey = badValue;
    assert.equal((await save(invalid)).status, 400, 'Invalid key values must be rejected');
  }
  assert.equal(await readFile(configFile, 'utf8'), before, 'Rejected writes must preserve the saved configuration');

  next = saved.body.data;
  next.providers[0].apiKey = '';
  next.skillAgent.apiKey = '';
  assert.equal((await save(next)).status, 200, 'Blank key preserves the current secret');
  await close(api);
  await start();
  assert.equal((await request('/models')).body.data.default.modelId, 'test-image-openai');
  assert.equal((await config()).body.data.providers[0].keyConfigured, true);
  assert.equal((await config()).body.data.skillAgent.keyConfigured, true);

  next.skillAgent.clearApiKey = true;
  assert.equal((await save(next)).status, 400, 'An enabled Skill agent must keep a usable key');
  next.skillAgent.enabled = false;
  assert.equal((await save(next)).status, 200);
  next = (await config()).body.data;
  assert.equal(next.skillAgent.keyConfigured, false, 'Cleared Skill agent keys must not be returned or reused');

  next.providers[0].clearApiKey = true;
  assert.equal((await save(next)).status, 400, 'The default provider must remain usable');
  next.defaultProvider = 'mock';
  next.providers[0].enabled = false;
  assert.equal((await save(next)).status, 200);
  await close(api);
  await start();
  assert.equal((await config()).body.data.providers[0].keyConfigured, false, 'Cleared key must not fall back to inherited environment');
  const disabled = await request('/tasks', { method: 'POST', headers, body: JSON.stringify({ skillId: 'travel-postcard', providerId: 'openai', modelId: 'test-image-openai', images: [] }) });
  assert.equal(disabled.status, 400);
  assert.match(disabled.body.message, /MODEL_UNAVAILABLE/);

  await close(api);
  // An unwritable destination must not activate an unsaved configuration.
  options.configFile = join(root, 'blocked');
  await start();
  const unchanged = (await config()).body.data;
  await mkdir(options.configFile);
  assert.equal((await save({ ...next, defaultProvider: 'mock' })).status, 500);
  assert.deepEqual((await config()).body.data, unchanged);
  await close(api);
  // Startup must fail closed on corrupt or unreadable persisted settings.
  await assert.rejects(createApiServer(options), /MODEL_CONFIG_READ_FAILED/);
  api = undefined;
  console.log('Model configuration passed: Skill agent tool calling, redaction, validation, persistence, and all three image adapters against a local relay.');
} finally {
  if (api?.listening) await close(api);
  await close(relay);
}
