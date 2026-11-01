import { describe, expect, it, vi } from 'vitest';
import { WasenderClient } from '../src/client.js';
import { WasenderError, WasenderTimeoutError } from '../src/errors.js';
import { createFetchMock, createSleepSpy, errorBody, type Reply } from './helpers.js';

const OK: Reply = { body: { sent: true } };

describe('retries', () => {
  it('is off by default', async () => {
    const mock = createFetchMock({ status: 503, body: errorBody(503, 'Channel not connected') });
    const wa = new WasenderClient({ token: 'wsk_sg_test', fetch: mock.fetch });
    await expect(wa.sendText({ to: '61371989950', body: 'Hi' })).rejects.toThrow('Channel not connected');
    expect(mock.count).toBe(1);
  });

  it('waits the Retry-After seconds on 429 and then succeeds', async () => {
    const mock = createFetchMock([
      { status: 429, body: errorBody(429, 'Rate limit exceeded'), headers: { 'retry-after': '7' } },
      OK,
    ]);
    const sleeper = createSleepSpy();
    const wa = new WasenderClient({ token: 'wsk_sg_test', fetch: mock.fetch, retry: { retries: 2 }, sleep: sleeper.sleep });

    await expect(wa.sendText({ to: '61371989950', body: 'Hi' })).resolves.toEqual({ sent: true });
    expect(mock.count).toBe(2);
    expect(sleeper.delays).toEqual([7000]);
  });

  it('caps a very long Retry-After', async () => {
    const mock = createFetchMock([{ status: 429, body: errorBody(429, 'slow down'), headers: { 'retry-after': '3600' } }, OK]);
    const sleeper = createSleepSpy();
    const wa = new WasenderClient({
      token: 'wsk_sg_test',
      fetch: mock.fetch,
      retry: { retries: 1, maxRetryAfterMs: 30_000 },
      sleep: sleeper.sleep,
    });
    await wa.sendText({ to: '61371989950', body: 'Hi' });
    expect(sleeper.delays).toEqual([30_000]);
  });

  it('backs off exponentially on 503, capped, when there is no Retry-After', async () => {
    const mock = createFetchMock([
      { status: 503, body: errorBody(503, 'reconnecting') },
      { status: 503, body: errorBody(503, 'reconnecting') },
      { status: 503, body: errorBody(503, 'reconnecting') },
      OK,
    ]);
    const sleeper = createSleepSpy();
    const wa = new WasenderClient({
      token: 'wsk_sg_test',
      fetch: mock.fetch,
      retry: { retries: 3, baseDelayMs: 100, maxDelayMs: 250, jitter: false },
      sleep: sleeper.sleep,
    });

    await expect(wa.checkHealth()).resolves.toBeDefined();
    expect(mock.count).toBe(4);
    expect(sleeper.delays).toEqual([100, 200, 250]);
  });

  it('retries 502 too', async () => {
    const mock = createFetchMock([{ status: 502, body: errorBody(502, 'upstream') }, OK]);
    const sleeper = createSleepSpy();
    const wa = new WasenderClient({ token: 'wsk_sg_test', fetch: mock.fetch, maxRetries: 1, sleep: sleeper.sleep });
    await expect(wa.checkHealth()).resolves.toBeDefined();
    expect(mock.count).toBe(2);
  });

  it('keeps jittered delays inside half the exponential window', async () => {
    const mock = createFetchMock([{ status: 503, body: errorBody(503, 'reconnecting') }, OK]);
    const sleeper = createSleepSpy();
    const wa = new WasenderClient({
      token: 'wsk_sg_test',
      fetch: mock.fetch,
      retry: { retries: 1, baseDelayMs: 1000, jitter: true },
      sleep: sleeper.sleep,
    });
    await wa.checkHealth();
    expect(sleeper.delays[0]).toBeGreaterThanOrEqual(500);
    expect(sleeper.delays[0]).toBeLessThanOrEqual(1000);
  });

  it('never retries 400 or 401', async () => {
    for (const status of [400, 401, 403, 404, 413, 500, 501]) {
      const mock = createFetchMock({ status, body: errorBody(status, `status ${status}`) });
      const sleeper = createSleepSpy();
      const wa = new WasenderClient({ token: 'wsk_sg_test', fetch: mock.fetch, retry: { retries: 5 }, sleep: sleeper.sleep });
      await expect(wa.sendText({ to: '61371989950', body: 'Hi' })).rejects.toBeInstanceOf(WasenderError);
      expect(mock.count).toBe(1);
      expect(sleeper.delays).toEqual([]);
    }
  });

  it('gives up after the configured number of retries and throws the last error', async () => {
    const mock = createFetchMock({ status: 503, body: errorBody(503, 'still reconnecting') });
    const sleeper = createSleepSpy();
    const wa = new WasenderClient({ token: 'wsk_sg_test', fetch: mock.fetch, retry: 2, sleep: sleeper.sleep });
    await expect(wa.checkHealth()).rejects.toThrow('still reconnecting');
    expect(mock.count).toBe(3);
    expect(sleeper.delays).toHaveLength(2);
  });

  it('does not retry a transport failure', async () => {
    let calls = 0;
    const failing = async () => {
      calls += 1;
      throw new TypeError('fetch failed');
    };
    const wa = new WasenderClient({ token: 'wsk_sg_test', fetch: failing as never, retry: { retries: 3 } });
    await expect(wa.checkHealth()).rejects.toThrow(/Could not reach/);
    expect(calls).toBe(1);
  });
});

describe('timeouts', () => {
  it('aborts the request after timeoutMs and reports a timeout error', async () => {
    const hanging = (_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        });
      });

    const wa = new WasenderClient({ token: 'wsk_sg_test', fetch: hanging, timeoutMs: 20 });
    const error = (await wa.checkHealth().catch((e: unknown) => e)) as WasenderError;

    expect(error).toBeInstanceOf(WasenderTimeoutError);
    expect(error.status).toBe(0);
    expect(error.code).toBe('timeout');
    expect(error.message).toContain('20 ms');
  });

  it('honours a per-call timeout override', async () => {
    const hanging = (_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });
    const wa = new WasenderClient({ token: 'wsk_sg_test', fetch: hanging });
    await expect(wa.checkHealth({}, { timeoutMs: 15 })).rejects.toBeInstanceOf(WasenderTimeoutError);
  });

  it('clears the timer on a fast response, leaving nothing pending', async () => {
    const mock = createFetchMock({ body: {} });
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
    const wa = new WasenderClient({ token: 'wsk_sg_test', fetch: mock.fetch, timeoutMs: 5000 });
    await wa.checkHealth();
    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
  });

  it('propagates a caller-supplied abort signal untouched', async () => {
    const controller = new AbortController();
    const hanging = (_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const error = new Error('aborted by caller');
          error.name = 'AbortError';
          reject(error);
        });
      });
    const wa = new WasenderClient({ token: 'wsk_sg_test', fetch: hanging });
    const pending = wa.checkHealth({}, { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toThrow('aborted by caller');
  });
});
