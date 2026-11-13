import { chromium } from 'playwright-core';
import bundled from '@sparticuz/chromium';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { existsSync, readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { brotliDecompressSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
const require = createRequire(import.meta.url);
// The npm-distributed Chromium bundles Linux libraries; unpack if the host lacks them.
const root = dirname(dirname(require.resolve('@sparticuz/chromium')));
const libs = mkdtempSync(join(tmpdir(), 'nova-browser-'));
const archive = join(root, 'bin', 'al2023.tar.br');
if (existsSync(archive)) {
  writeFileSync(join(libs, 'libs.tar'), brotliDecompressSync(readFileSync(archive)));
  execFileSync('tar', ['-xf', join(libs, 'libs.tar'), '-C', libs]);
}
const browser = await chromium.launch({
  executablePath: await bundled.executablePath(),
  args: bundled.args.filter(
    (a) => !a.includes('disable-web-security') && !a.includes('allow-running-insecure-content'),
  ),
  env: {
    ...process.env,
    LD_LIBRARY_PATH: `${join(libs, 'lib')}:${process.env.LD_LIBRARY_PATH ?? ''}`,
  },
  headless: true,
});
const errors = [];
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
page.on('pageerror', (e) => errors.push(e.message));
const origin = process.env.CHECK_URL ?? 'http://127.0.0.1:3001';
const pages = [
  'Overview',
  'Conversations',
  'Contacts',
  'AI Settings',
  'Memory',
  'Tasks',
  'Reminders',
  'Documents',
  'Business Profiles',
  'Tool Permissions',
  'Usage and Costs',
  'Activity Logs',
  'Integrations',
  'Account Settings',
];
await page.goto(origin);
await page.getByRole('heading', { name: 'Welcome to NOVA.' }).waitFor();
await mkdir('.artifacts', { recursive: true });
await page.screenshot({ path: '.artifacts/desktop.png', fullPage: true });
for (const name of pages) {
  await page.locator('nav').getByRole('link', { name, exact: true }).click();
  await page.getByRole('heading', { level: 1 }).waitFor();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  assert.equal(overflow, false, `${name} overflows desktop`);
}
await page.locator('nav').getByRole('link', { name: 'Tasks', exact: true }).click();
await page.getByRole('button', { name: 'Add task' }).first().click();
await page.getByLabel('Task title').fill('Browser smoke task');
await page.getByRole('button', { name: 'Save changes' }).click();
await page.getByRole('alert').waitFor();
assert.match(await page.getByRole('alert').innerText(), /Connect Supabase/);
await page.getByRole('button', { name: 'Close dialog' }).click();
await page.locator('nav').getByRole('link', { name: 'Integrations', exact: true }).click();
await page.getByText('Configuration guide', { exact: true }).first().click();
assert.equal(
  await page
    .getByText('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY on the server.', { exact: true })
    .isVisible(),
  true,
);
await page.setViewportSize({ width: 390, height: 844 });
for (const name of pages) {
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.locator('nav').getByRole('link', { name, exact: true }).click();
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
    false,
    `${name} overflows mobile`,
  );
}
await page.getByRole('button', { name: 'Open navigation' }).click();
await page.locator('nav').getByRole('link', { name: 'Overview', exact: true }).click();
await page.waitForFunction(
  () => document.querySelector('.sidebar').getBoundingClientRect().right <= 1,
);
await page.screenshot({ path: '.artifacts/mobile.png', fullPage: true, animations: 'disabled' });
assert.deepEqual(errors, [], 'Browser runtime errors');
await browser.close();
console.log(
  'PASS: all 14 routes at 1440px and 390px; form validation/setup failure, configuration guide; no horizontal page overflow or browser errors.',
);
