import { join } from 'node:path';

import { createApiServer } from './index.js';

const root = process.cwd();
const configuredProvider = process.env.AI_PROVIDER;
const aiProvider = configuredProvider === 'openai' || configuredProvider === 'gemini' || configuredProvider === 'qwen' ? configuredProvider : 'mock';
const qwenApiKey = process.env.DASHSCOPE_API_KEY ?? process.env.QWEN_API_KEY;
const server = await createApiServer({
  skillsDir: join(root, 'skills'),
  storageDir: join(root, 'storage'),
  aiProvider,
  ...(process.env.OPENAI_API_KEY ? { openAiApiKey: process.env.OPENAI_API_KEY } : {}),
  ...(process.env.GEMINI_API_KEY ? { geminiApiKey: process.env.GEMINI_API_KEY } : {}),
  ...(qwenApiKey ? { qwenApiKey } : {}),
});
const port = Number(process.env.API_PORT ?? '3000');
server.listen(port, '127.0.0.1', () => console.log(`[API] listening on http://127.0.0.1:${port}`));
