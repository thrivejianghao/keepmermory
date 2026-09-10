import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const compiler = process.env.TYPESCRIPT_CLI ?? resolve('node_modules/typescript/lib/tsc.js');
const output = mkdtempSync(join(process.env.MINIAPP_TEST_TMP ?? tmpdir(), 'ai-photo-miniapp-tests-'));
const compile = spawnSync(process.execPath, [
  compiler,
  'apps/miniapp/tests/services.test.ts',
  'apps/miniapp/types/wechat.d.ts',
  '--target', 'ES2022',
  '--module', 'CommonJS',
  '--moduleResolution', 'Node',
  '--lib', 'ES2023,DOM',
  '--strict',
  '--skipLibCheck',
  '--esModuleInterop',
  '--outDir', output,
], { cwd: resolve('.'), encoding: 'utf8' });

if (compile.status !== 0) {
  process.stderr.write(compile.stdout);
  process.stderr.write(compile.stderr);
  process.exit(compile.status ?? 1);
}

const run = spawnSync(process.execPath, [join(output, 'tests', 'services.test.js')], { encoding: 'utf8' });
process.stdout.write(run.stdout);
process.stderr.write(run.stderr);
process.exit(run.status ?? 1);
