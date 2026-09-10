import assert from 'node:assert/strict';

const providerModule = await import('../packages/ai-provider/dist/index.js');
const { GeminiProvider, OpenAIProvider, QwenProvider, OpenAICompatibleSkillAgent } = providerModule;

assert.equal(typeof OpenAICompatibleSkillAgent, 'function', 'The provider package must expose an OpenAI-compatible Skill agent');

const sourceReader = async () => Buffer.from('source-image');
delete process.env.OPENAI_BASE_URL;
delete process.env.OPENAI_API_BASE;

let openAiRequest;
const openai = new OpenAIProvider({
  apiKey: 'test-key',
  sourceReader,
  fetcher: async (input, init) => {
    openAiRequest = { input: String(input), init };
    return jsonResponse({ data: [{ b64_json: Buffer.from('openai-result').toString('base64') }] });
  },
});
const openAiResult = await openai.edit({ prompt: 'portrait', images: [{ objectKey: 'photo.jpg', mimeType: 'image/jpeg' }], model: 'gpt-image-1' });
assert.equal(openAiRequest.input, 'https://api.openai.com/v1/images/edits');
assert.equal(openAiRequest.init.body.get('model'), 'gpt-image-1');
assert.equal(openAiRequest.init.body.getAll('image[]').length, 1);
assert.deepEqual(openAiResult.data, Buffer.from('openai-result'));

const unavailableOpenai = new OpenAIProvider({
  apiKey: 'test-key',
  sourceReader,
  fetcher: async () => { throw new TypeError('fetch failed', { cause: { code: 'UND_ERR_CONNECT_TIMEOUT' } }); },
});
await assert.rejects(() => unavailableOpenai.edit({ prompt: 'portrait', images: [{ objectKey: 'photo.jpg', mimeType: 'image/jpeg' }], model: 'gpt-image-1' }), /OPENAI_NETWORK_UNAVAILABLE/);

for (const [name, base] of [['OPENAI_BASE_URL', 'https://relay.example'], ['OPENAI_API_BASE', 'https://relay.example/v1/']]) {
  process.env[name] = base;
  let target;
  const relay = new OpenAIProvider({ apiKey: 'test-key', sourceReader, fetcher: async (url) => {
    target = String(url);
    return jsonResponse({ data: [{ b64_json: Buffer.from('relay-result').toString('base64') }] });
  } });
  await relay.edit({ prompt: 'portrait', images: [{ objectKey: 'photo.jpg' }], model: 'gpt-image-1' });
  assert.equal(target, 'https://relay.example/v1/images/edits', `${name} must route images to the configured relay`);
  await relay.generate({ prompt: 'portrait', images: [], model: 'gpt-image-1' });
  assert.equal(target, 'https://relay.example/v1/images/generations');
  delete process.env[name];
}

let geminiRequest;
const gemini = new GeminiProvider({
  apiKey: 'test-key',
  sourceReader,
  fetcher: async (input, init) => {
    geminiRequest = { input: String(input), init };
    return jsonResponse({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: Buffer.from('gemini-result').toString('base64') } }] } }] });
  },
});
const geminiResult = await gemini.edit({ prompt: 'portrait', images: [{ objectKey: 'photo.jpg', mimeType: 'image/jpeg' }], model: 'gemini-image-model' });
const geminiBody = JSON.parse(geminiRequest.init.body);
assert.equal(geminiRequest.input, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-image-model:generateContent');
assert.equal(geminiRequest.init.headers['x-goog-api-key'], 'test-key');
assert.equal(geminiBody.contents[0].parts[0].inlineData.mimeType, 'image/jpeg');
assert.deepEqual(geminiResult.data, Buffer.from('gemini-result'));

let qwenRequest;
const qwen = new QwenProvider({
  apiKey: 'test-key',
  sourceReader,
  fetcher: async (input, init) => {
    qwenRequest = { input: String(input), init };
    return jsonResponse({ output: { choices: [{ message: { content: [{ image: 'https://example.com/qwen-result.png' }] } }] } });
  },
});
const qwenResult = await qwen.edit({ prompt: 'poster', images: [{ objectKey: 'photo.jpg', mimeType: 'image/jpeg' }], model: 'qwen-image-plus' });
const qwenBody = JSON.parse(qwenRequest.init.body);
assert.equal(qwenRequest.input, 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation');
assert.equal(qwenBody.model, 'qwen-image-plus');
assert.equal(qwenBody.input.messages[0].content[0].image.startsWith('data:image/jpeg;base64,'), true);
assert.equal(qwenResult.objectKey, 'https://example.com/qwen-result.png');

let tokenPlanImageRequest;
const tokenPlanImage = new QwenProvider({
  apiKey: 'token-plan-key',
  endpoint: 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
  sourceReader: async () => Buffer.from('photo'),
  fetcher: async (input, init) => {
    tokenPlanImageRequest = { input: String(input), init };
    return jsonResponse({ output: { choices: [{ message: { content: [{ image: 'https://example.com/token-plan-result.png' }] } }] } });
  },
});
const tokenPlanImageResult = await tokenPlanImage.edit({ prompt: 'portrait', images: [{ objectKey: 'photo.jpg', mimeType: 'image/jpeg' }], model: 'wan2.7-image' });
const tokenPlanImageBody = JSON.parse(tokenPlanImageRequest.init.body);
assert.equal(tokenPlanImageRequest.input, 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions');
assert.equal(tokenPlanImageBody.input, undefined);
assert.equal(tokenPlanImageBody.messages[0].content[0].image.startsWith('data:image/jpeg;base64,'), true);
assert.equal(tokenPlanImageBody.messages[0].content[1].text, 'portrait');
assert.equal(tokenPlanImageResult.objectKey, 'https://example.com/token-plan-result.png');

let agentRequest;
const skillAgent = new OpenAICompatibleSkillAgent({
  apiKey: 'token-plan-key',
  endpoint: 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/',
  model: 'qwen3-coder-plus',
  fetcher: async (input, init) => {
    agentRequest = { input: String(input), init };
    return jsonResponse({ choices: [{ message: { tool_calls: [{ type: 'function', function: {
      name: 'execute_image_skill', arguments: JSON.stringify({ prompt: 'A planned cinematic postcard prompt' }),
    } }] } }] });
  },
});
const plan = await skillAgent.plan({
  skillId: 'travel-postcard',
  skillName: '旅行明信片',
  skillVersion: '1.0.0',
  instructions: 'Preserve the traveler and destination.',
  prompt: 'Build the travel postcard.',
  parameters: { style: 'film' },
});
const agentBody = JSON.parse(agentRequest.init.body);
assert.equal(agentRequest.input, 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions');
assert.equal(agentRequest.init.headers.Authorization, 'Bearer token-plan-key');
assert.equal(agentBody.model, 'qwen3-coder-plus');
assert.equal(agentBody.tools[0].function.name, 'execute_image_skill');
assert.equal(agentBody.tool_choice.function.name, 'execute_image_skill');
assert.equal(agentBody.enable_thinking, false, 'Aliyun Token Plan must disable thinking for forced tool calls');
assert.equal(plan.prompt, 'A planned cinematic postcard prompt');
let genericAgentBody;
await assert.rejects(() => new OpenAICompatibleSkillAgent({
  apiKey: 'token-plan-key', endpoint: 'https://example.com/v1', model: 'model',
  fetcher: async (_input, init) => {
    genericAgentBody = JSON.parse(init.body);
    return jsonResponse({ choices: [{ message: { content: 'No tool call' } }] });
  },
}).plan({ skillId: 'x', skillName: 'X', skillVersion: '1.0.0', instructions: '', prompt: 'x', parameters: {} }), /SKILL_AGENT_INVALID_RESPONSE/);
assert.equal(genericAgentBody.enable_thinking, undefined, 'Generic OpenAI-compatible APIs must not receive Aliyun-only options');

console.log('Provider verification passed: image adapters and the OpenAI-compatible Skill agent are valid.');

function jsonResponse(body) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
