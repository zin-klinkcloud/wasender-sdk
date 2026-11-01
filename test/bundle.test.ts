/**
 * Smoke test for the published artefacts: the ESM bundle imports, the CJS
 * bundle requires, and both expose the same public surface.
 *
 * Skipped when `dist` has not been built, so `npm test` works on a fresh clone.
 */

import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const esmUrl = new URL('../dist/index.js', import.meta.url);
const cjsUrl = new URL('../dist/index.cjs', import.meta.url);
const built = existsSync(fileURLToPath(esmUrl)) && existsSync(fileURLToPath(cjsUrl));

const EXPECTED_EXPORTS = [
  'WasenderClient',
  'WasenderProvisioning',
  'WasenderManageClient',
  'WasenderError',
  'WasenderRateLimitError',
  'WasenderConnectionError',
  'verifyWebhook',
  'signWebhookBody',
  'WEBHOOK_SIGNATURE_HEADER',
  'parseRetryAfter',
  'DEFAULT_MESSAGING_BASE_URL',
  'DEFAULT_PROVISIONING_BASE_URL',
];

describe.skipIf(!built)('built bundles', () => {
  it('exposes the public surface from the ESM bundle', async () => {
    const mod = (await import(esmUrl.href)) as Record<string, unknown>;
    for (const name of EXPECTED_EXPORTS) expect(typeof mod[name]).not.toBe('undefined');
    const wa = new (mod.WasenderClient as new (o: { token: string }) => { baseUrl: string })({ token: 'wsk_sg_test' });
    expect(wa.baseUrl).toBe('https://api.wasender.dev');
  });

  it('exposes the public surface from the CJS bundle', () => {
    const require = createRequire(import.meta.url);
    const mod = require(fileURLToPath(cjsUrl)) as Record<string, unknown>;
    for (const name of EXPECTED_EXPORTS) expect(typeof mod[name]).not.toBe('undefined');
    const manage = new (mod.WasenderProvisioning as new (o: { apiKey: string }) => { baseUrl: string })({
      apiKey: 'wsm_test',
    });
    expect(manage.baseUrl).toBe('https://manage.wasender.dev');
  });

  it('ships type declarations for both module systems', () => {
    expect(existsSync(fileURLToPath(new URL('../dist/index.d.ts', import.meta.url)))).toBe(true);
    expect(existsSync(fileURLToPath(new URL('../dist/index.d.cts', import.meta.url)))).toBe(true);
  });
});
