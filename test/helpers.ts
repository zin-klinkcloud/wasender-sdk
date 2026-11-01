/** A mocked fetch, so the whole test suite runs without touching the network. */

import type { FetchLike } from '../src/http.js';

export interface RecordedCall {
  url: string;
  /** Path and query, without the origin. */
  pathname: string;
  search: string;
  method: string;
  headers: Record<string, string>;
  /** Parsed JSON body, when the request sent one. */
  json: unknown;
  /** Raw body passed to fetch. */
  body: BodyInit | null | undefined;
  form: FormData | undefined;
}

export interface ReplySpec {
  status?: number;
  /** JSON body. */
  body?: unknown;
  /** Exact text body, used instead of `body`. */
  text?: string;
  /** Binary body, used instead of `body`. */
  bytes?: Uint8Array;
  headers?: Record<string, string>;
  contentType?: string;
}

export type Reply = Response | ReplySpec;

export interface FetchMock {
  fetch: FetchLike;
  calls: RecordedCall[];
  /** Number of times the mock was invoked. */
  readonly count: number;
}

function toResponse(reply: Reply): Response {
  if (reply instanceof Response) return reply;
  const status = reply.status ?? 200;
  const headers = new Headers(reply.headers ?? {});
  let payload: BodyInit | null;
  if (reply.bytes) {
    payload = reply.bytes as unknown as BodyInit;
    if (!headers.has('content-type')) headers.set('content-type', reply.contentType ?? 'application/octet-stream');
  } else if (reply.text !== undefined) {
    payload = reply.text;
    if (!headers.has('content-type') && reply.contentType) headers.set('content-type', reply.contentType);
  } else if (reply.body !== undefined) {
    payload = JSON.stringify(reply.body);
    if (!headers.has('content-type')) headers.set('content-type', 'application/json');
  } else {
    payload = null;
  }
  return new Response(status === 204 ? null : payload, { status, headers });
}

/**
 * Builds a fetch mock from a list of replies, or a function of the call.
 *
 * A list shorter than the number of calls reuses its last entry, which keeps
 * "always reply 200" tests to one line.
 */
export function createFetchMock(replies: Reply | Reply[] | ((call: RecordedCall, index: number) => Reply)): FetchMock {
  const calls: RecordedCall[] = [];

  const fetch: FetchLike = async (input, init = {}) => {
    const url = new URL(input);
    const headers = new Headers(init.headers ?? {});
    const headerBag: Record<string, string> = {};
    headers.forEach((value, key) => {
      headerBag[key] = value;
    });

    let json: unknown;
    if (typeof init.body === 'string') {
      try {
        json = JSON.parse(init.body);
      } catch {
        json = init.body;
      }
    }

    const call: RecordedCall = {
      url: String(input),
      pathname: url.pathname,
      search: url.search,
      method: init.method ?? 'GET',
      headers: headerBag,
      json,
      body: init.body,
      form: typeof FormData !== 'undefined' && init.body instanceof FormData ? init.body : undefined,
    };
    calls.push(call);

    if (init.signal?.aborted) throw abortError();

    const index = calls.length - 1;
    const reply =
      typeof replies === 'function'
        ? replies(call, index)
        : Array.isArray(replies)
          ? (replies[Math.min(index, replies.length - 1)] as Reply)
          : replies;
    return toResponse(reply);
  };

  return {
    fetch,
    calls,
    get count() {
      return calls.length;
    },
  };
}

export function abortError(): Error {
  const error = new Error('This operation was aborted');
  error.name = 'AbortError';
  return error;
}

/** A sleep spy, so retry tests assert the delays instead of waiting them out. */
export function createSleepSpy(): { sleep: (ms: number) => Promise<void>; delays: number[] } {
  const delays: number[] = [];
  return {
    delays,
    sleep: async (ms: number) => {
      delays.push(ms);
    },
  };
}

/** The error body shape the API documents on every endpoint. */
export function errorBody(code: number, message: string, extra: Record<string, unknown> = {}): unknown {
  return { error: { code, message, support: 'support@wasender.dev', ...extra } };
}
