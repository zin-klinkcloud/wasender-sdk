import { describe, expect, it } from 'vitest';
import { WasenderClient } from '../src/client.js';
import {
  RETRYABLE_STATUSES,
  WasenderAuthError,
  WasenderBadRequestError,
  WasenderConnectionError,
  WasenderError,
  WasenderNotImplementedError,
  WasenderPaymentRequiredError,
  WasenderRateLimitError,
  parseRetryAfter,
} from '../src/errors.js';
import { createFetchMock, errorBody } from './helpers.js';

function client(fetchImpl: ReturnType<typeof createFetchMock>['fetch']): WasenderClient {
  return new WasenderClient({ token: 'wsk_sg_test', fetch: fetchImpl });
}

describe('error parsing', () => {
  it('parses the documented JSON error envelope', async () => {
    const mock = createFetchMock({
      status: 429,
      body: errorBody(429, 'Rate limit exceeded', {
        details: '60 messages a minute',
        href: 'https://docs.wasender.dev/errors#rate-limit',
      }),
      headers: { 'retry-after': '30', 'x-request-id': 'req_abc' },
    });

    const error = await client(mock.fetch)
      .sendText({ to: '61371989950', body: 'Hi' })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(WasenderRateLimitError);
    const err = error as WasenderRateLimitError;
    expect(err).toBeInstanceOf(WasenderError);
    expect(err.name).toBe('WasenderRateLimitError');
    expect(err.status).toBe(429);
    expect(err.code).toBe(429);
    expect(err.message).toBe('Rate limit exceeded');
    expect(err.details).toBe('60 messages a minute');
    expect(err.href).toBe('https://docs.wasender.dev/errors#rate-limit');
    expect(err.support).toBe('support@wasender.dev');
    expect(err.requestId).toBe('req_abc');
    expect(err.retryAfter).toBe(30);
    expect(err.isRetryable).toBe(true);
    expect(err.method).toBe('POST');
    expect(err.url).toBe('https://api.wasender.dev/messages/text');
    expect(err.raw).toContain('Rate limit exceeded');
    expect((err.data as { error: { code: number } }).error.code).toBe(429);
  });

  it('falls back to the status line for a non-JSON body', async () => {
    const mock = createFetchMock({
      status: 502,
      text: '<html><body>Bad gateway</body></html>',
      contentType: 'text/html',
    });

    const error = (await client(mock.fetch)
      .checkHealth()
      .catch((e: unknown) => e)) as WasenderError;

    expect(error.status).toBe(502);
    expect(error.code).toBe(502);
    expect(error.message).toContain('HTTP 502');
    expect(error.message).toContain('Bad gateway');
    expect(error.raw).toBe('<html><body>Bad gateway</body></html>');
    expect(error.data).toBeUndefined();
    expect(error.isRetryable).toBe(true);
  });

  it('handles an empty error body', async () => {
    const mock = createFetchMock({ status: 500, text: '' });
    const error = (await client(mock.fetch)
      .checkHealth()
      .catch((e: unknown) => e)) as WasenderError;
    expect(error.status).toBe(500);
    expect(error.message).toMatch(/^HTTP 500/);
    expect(error.isRetryable).toBe(false);
  });

  it('maps statuses to specific subclasses', async () => {
    const cases: Array<[number, new (...args: never[]) => WasenderError]> = [
      [400, WasenderBadRequestError],
      [401, WasenderAuthError],
      [402, WasenderPaymentRequiredError],
      [429, WasenderRateLimitError],
      [501, WasenderNotImplementedError],
    ];
    for (const [status, Ctor] of cases) {
      const mock = createFetchMock({ status, body: errorBody(status, `status ${status}`) });
      const error = await client(mock.fetch)
        .checkHealth()
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(Ctor);
    }
  });

  it('raises the documented 501 for the two unsupported operations', async () => {
    const mock = createFetchMock({
      status: 501,
      body: errorBody(501, 'Not supported by this service', { details: 'PUT /messages/{id}/star' }),
    });
    const wa = client(mock.fetch);

    await expect(wa.starMessage('msg_1', { star: true })).rejects.toBeInstanceOf(WasenderNotImplementedError);
    await expect(wa.subscribeToPresence('61371989950')).rejects.toThrow('Not supported by this service');
  });

  it('wraps a transport failure as a connection error with status 0', async () => {
    const failing = async () => {
      throw new TypeError('fetch failed');
    };
    const error = (await client(failing as never)
      .checkHealth()
      .catch((e: unknown) => e)) as WasenderError;

    expect(error).toBeInstanceOf(WasenderConnectionError);
    expect(error.status).toBe(0);
    expect(error.code).toBe('connection_error');
    expect(error.isRetryable).toBe(false);
    expect(error.message).toContain('fetch failed');
    expect((error.cause as Error).message).toBe('fetch failed');
  });

  it('marks exactly 429, 502 and 503 as retryable', () => {
    expect([...RETRYABLE_STATUSES]).toEqual([429, 502, 503]);
  });
});

describe('parseRetryAfter', () => {
  const now = Date.parse('2026-11-01T00:00:00Z');

  it('reads delta-seconds', () => {
    expect(parseRetryAfter('30')).toBe(30);
    expect(parseRetryAfter(' 0 ')).toBe(0);
  });

  it('reads an HTTP date, relative to now', () => {
    expect(parseRetryAfter('Sun, 01 Nov 2026 00:00:45 GMT', now)).toBe(45);
  });

  it('never returns a negative wait for a date in the past', () => {
    expect(parseRetryAfter('Sat, 31 Oct 2026 23:59:00 GMT', now)).toBe(0);
  });

  it('returns undefined for missing or unparseable values', () => {
    expect(parseRetryAfter(null)).toBeUndefined();
    expect(parseRetryAfter(undefined)).toBeUndefined();
    expect(parseRetryAfter('')).toBeUndefined();
    expect(parseRetryAfter('soon')).toBeUndefined();
    expect(parseRetryAfter('-5')).toBeUndefined();
  });

  it('is read from the response header into the error', async () => {
    const mock = createFetchMock({
      status: 429,
      body: errorBody(429, 'Rate limit exceeded'),
      headers: { 'retry-after': 'Sun, 01 Nov 2026 00:00:45 GMT' },
    });
    const error = (await client(mock.fetch)
      .checkHealth()
      .catch((e: unknown) => e)) as WasenderError;
    // Parsed against the real clock, so just assert it came through as a number.
    expect(typeof error.retryAfter).toBe('number');
  });
});
