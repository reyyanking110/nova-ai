import { createApp } from './app.js';
import { env } from './config.js';
import { log } from './core.js';
import express from 'express';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
const app = createApp();
const web = fileURLToPath(new URL('../../web/dist/', import.meta.url));
if (existsSync(web)) {
  app.use(express.static(web, { index: false }));
  app.get('/{*path}', (_req, res) => res.sendFile(`${web}/index.html`));
}
const server = app.listen(env.PORT, '0.0.0.0', () =>
  log.info({ port: env.PORT }, 'NOVA API listening'),
);
for (const signal of ['SIGTERM', 'SIGINT'])
  process.on(signal, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10000).unref();
  });
