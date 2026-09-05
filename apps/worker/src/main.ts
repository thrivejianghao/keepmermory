import { createApiServer } from '@ai-photo/api';

// The local task queue is started by the API runtime for the MVP. This process keeps the worker
// entry point explicit so BullMQ can replace the queue adapter without changing task behavior.
const server = await createApiServer({ skillsDir: `${process.cwd()}/skills`, storageDir: `${process.cwd()}/storage` });
server.close();
console.log('[WORKER] ready; queue worker is owned by the task runtime');
