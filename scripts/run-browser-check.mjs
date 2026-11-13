import { spawn } from 'node:child_process';
import { setTimeout } from 'node:timers/promises';
const port = process.env.TEST_PORT ?? '3002';
const child = spawn(process.execPath, ['--import', 'tsx', 'apps/api/src/index.ts'], {
  env: { ...process.env, PORT: port, NODE_ENV: 'test' },
  stdio: 'inherit',
});
try {
  let ready = false;
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) {
        ready = true;
        break;
      }
    } catch {}
    if (child.exitCode !== null) throw new Error('API exited during browser test startup');
    await setTimeout(200);
  }
  if (!ready) throw new Error('API did not become ready');
  const code = await new Promise((resolve) =>
    spawn(process.execPath, ['scripts/browser-check.mjs'], {
      env: { ...process.env, CHECK_URL: `http://127.0.0.1:${port}` },
      stdio: 'inherit',
    }).on('exit', resolve),
  );
  if (code !== 0) process.exitCode = 1;
} finally {
  child.kill('SIGTERM');
}
