import { spawn } from 'node:child_process';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStaticServer } from './static-server.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const node = process.execPath;
const api = spawn(node, [join(root, 'apps/api/dist/main.js')], {
  cwd: root,
  env: { ...process.env, AI_PROVIDER: process.env.AI_PROVIDER ?? 'mock' },
  stdio: 'inherit',
});
const configuredAdminDir = process.env.ADMIN_DIST_DIR;
const adminDir = configuredAdminDir ?? join(root, 'apps/admin/static');
const apiPort = Number(process.env.API_PORT ?? '3000');
const admin = await createStaticServer({ rootDir: adminDir, htmlReplacements: { '__API_PORT__': String(apiPort) } });
const adminPort = Number(process.env.ADMIN_PORT ?? '3001');
admin.listen(adminPort, '127.0.0.1', () => console.log(`[ADMIN] listening on http://127.0.0.1:${adminPort}`));
const web = await createStaticServer({ rootDir: join(root, 'apps/web/static'), htmlReplacements: { '__API_PORT__': String(apiPort) } });
const webPort = Number(process.env.WEB_PORT ?? '3002');
web.listen(webPort, '127.0.0.1', () => console.log(`[WEB] listening on http://127.0.0.1:${webPort}`));

const shutdown = () => {
  admin.close();
  web.close();
  api.kill('SIGTERM');
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
api.once('exit', (code) => {
  if (code && code !== 0) process.exitCode = code;
  admin.close();
  web.close();
});
