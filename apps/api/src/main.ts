import { join } from 'node:path';

import { createApiServer } from './index.js';

const root = process.cwd();
const server = await createApiServer({
  skillsDir: join(root, 'skills'),
  storageDir: join(root, 'storage'),
  aiProvider: process.env.AI_PROVIDER === 'openai' ? 'openai' : 'mock',
  ...(process.env.OPENAI_API_KEY ? { openAiApiKey: process.env.OPENAI_API_KEY } : {}),
});
const port = Number(process.env.API_PORT ?? '3000');
server.listen(port, '127.0.0.1', () => console.log(`[API] listening on http://127.0.0.1:${port}`));
