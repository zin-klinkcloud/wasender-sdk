/**
 * The transport the two clients share: one `fetch` call, plus query building,
 * error mapping, optional retries and an optional timeout.
 *
 * Nothing here imports a Node builtin, so the same code runs on Node 18+, Bun,
 * Deno, Cloudflare Workers and in the browser.
 */

import {
  WasenderConnectionError,
  WasenderTimeoutError,
  createWasenderError,
  parseRetryAfter,
  type WasenderErrorBody,
} from './errors.js';

/** The subset of `fetch` the SDK uses. Supply your own to intercept requests. */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export type QueryValue = string | number | boolean | null | undefined | Array<string | number | boolean>;

export type QueryParams = Record<string, QueryValue>;

/** Retry policy. Off by default: `retries` is 0 unless you set it. */
export interface RetryOptions {
  /** How many extra attempts to make. 0 disables retrying. */
  retries?: number;
  /** First backoff delay in milliseconds (default 500). */
  baseDelayMs?: number;
  /** Upper bound on any single backoff delay (default 20000). */
  maxDelayMs?: number;
  /** Randomise backoff to avoid synchronised retries (default true). */
  jitter?: boolean;
  /** Honour the `Retry-After` header on 429 responses (default true). */
  respectRetryAfter?: boolean;
  /** Ignore a `Retry-After` longer than this, in milliseconds (default 60000). */
  maxRetryAfterMs?: number;
  /** Statuses to retry. Defaults to 429, 502 and 503, and nothing else. */
  statuses?: readonly number[];
}

/** Per-call overrides accepted as the last argument of every method. */
export interface RequestOptions {
  /** Abort the request from your own controller. */
  signal?: AbortSignal | undefined;
  /** Override the client's `timeoutMs` for this call. */
  timeoutMs?: number | undefined;
  /** Extra headers merged over the client's defaults. */
  headers?: Record<string, string> | undefined;
}

export interface ClientCoreOptions {
  baseUrl: string;
  /** Sent as `Authorization: Bearer <credential>`. */
  credential: string;
  fetch?: FetchLike | undefined;
  /** Abort a request after this many milliseconds. Off by default. */
  timeoutMs?: number | undefined;
  /** Retry policy, or a plain number meaning "this many retries". */
  retry?: RetryOptions | number | undefined;
  /** Shorthand for `retry: { retries: n }`. */
  maxRetries?: number | undefined;
  /** Default headers for every request. */
  headers?: Record<string, string> | undefined;
  /** Replaceable sleep, so tests do not have to wait. */
  sleep?: ((ms: number) => Promise<void>) | undefined;
  /** Sent as `User-Agent` where the runtime allows setting it. */
  userAgent?: string | undefined;
}

/** A binary response body, returned by `getLoginQr()` and `getMedia()`. */
export interface BinaryResult {
  /** The `Content-Type` the server sent, if any. */
  contentType: string | null;
  /** The bytes. */
  data: ArrayBuffer;
  /** The same bytes as a view. */
  bytes: Uint8Array;
  /** Wraps the bytes in a Blob, tagged with `contentType`. */
  blob(): Blob;
  /** Standard base64 of the bytes, for embedding in JSON or HTML. */
  base64(): string;
  /** A `data:` URL, handy for dropping a QR code straight into an `<img>`. */
  dataUrl(): string;
}

export interface CoreRequest extends RequestOptions {
  method: HttpMethod;
  path: string;
  query?: QueryParams | undefined;
  /** JSON request body. Ignored when `form` is set. */
  body?: unknown;
  /** Multipart body. Takes precedence over `body`. */
  form?: FormData | undefined;
  /** What to do with a 2xx body. Defaults to `json`. */
  accept?: 'json' | 'binary' | 'empty' | undefined;
}

const DEFAULT_RETRY: Required<Omit<RetryOptions, 'statuses'>> & { statuses: readonly number[] } = {
  retries: 0,
  baseDelayMs: 500,
  maxDelayMs: 20_000,
  jitter: true,
  respectRetryAfter: true,
  maxRetryAfterMs: 60_000,
  statuses: [429, 502, 503],
};

const REQUEST_ID_HEADERS = ['x-request-id', 'x-wasender-request-id', 'x-correlation-id'];

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Serialises a query bag, skipping undefined and null, repeating arrays. */
export function buildQuery(params: QueryParams | undefined): string {
  if (!params) return '';
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const item of value) search.append(key, String(item));
    } else {
      search.append(key, String(value));
    }
  }
  const text = search.toString();
  return text === '' ? '' : `?${text}`;
}

/** URL-encodes a single path segment. */
export function encodePathSegment(value: string | number): string {
  return encodeURIComponent(String(value));
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function makeBinaryResult(data: ArrayBuffer, contentType: string | null): BinaryResult {
  const bytes = new Uint8Array(data);
  return {
    contentType,
    data,
    bytes,
    blob: () => new Blob([bytes], contentType ? { type: contentType } : {}),
    base64: () => toBase64(bytes),
    dataUrl: () => `data:${contentType ?? 'application/octet-stream'};base64,${toBase64(bytes)}`,
  };
}

function readRequestId(headers: Headers): string | undefined {
  for (const name of REQUEST_ID_HEADERS) {
    const value = headers.get(name);
    if (value) return value;
  }
  return undefined;
}

function normaliseRetry(options: ClientCoreOptions): typeof DEFAULT_RETRY {
  const raw = typeof options.retry === 'number' ? { retries: options.retry } : options.retry ?? {};
  const retries = raw.retries ?? options.maxRetries ?? DEFAULT_RETRY.retries;
  return { ...DEFAULT_RETRY, ...raw, retries };
}

/** True for values the SDK should upload as a multipart part. */
export function isBinaryLike(value: unknown): value is Blob | ArrayBuffer | ArrayBufferView {
  if (typeof Blob !== 'undefined' && value instanceof Blob) return true;
  if (value instanceof ArrayBuffer) return true;
  return ArrayBuffer.isView(value);
}

/** Wraps binary input in a Blob so FormData can take it anywhere. */
export function toBlob(value: Blob | ArrayBuffer | ArrayBufferView, contentType?: string): Blob {
  const options = contentType ? { type: contentType } : {};
  if (value instanceof ArrayBuffer) return new Blob([new Uint8Array(value)], options);
  if (ArrayBuffer.isView(value)) {
    // The cast keeps the typed-array view generic over ArrayBuffer only, which
    // is what BlobPart accepts; SharedArrayBuffer is not a valid body.
    const buffer = value.buffer as ArrayBuffer;
    return new Blob([new Uint8Array(buffer, value.byteOffset, value.byteLength)], options);
  }
  return contentType && value.type !== contentType ? new Blob([value], options) : value;
}

export class ClientCore {
  readonly baseUrl: string;
  private readonly credential: string;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number | undefined;
  private readonly retry: typeof DEFAULT_RETRY;
  private readonly defaultHeaders: Record<string, string>;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: ClientCoreOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.credential = options.credential;
    const picked = options.fetch ?? (typeof globalThis.fetch === 'function' ? (globalThis.fetch.bind(globalThis) as FetchLike) : undefined);
    if (!picked) {
      throw new WasenderConnectionError({
        status: 0,
        code: 'no_fetch',
        message: 'No global fetch was found. Use Node 18+, or pass a fetch implementation as the `fetch` option.',
      });
    }
    this.fetchImpl = picked;
    this.timeoutMs = options.timeoutMs;
    this.retry = normaliseRetry(options);
    this.sleep = options.sleep ?? defaultSleep;
    this.defaultHeaders = {
      authorization: `Bearer ${this.credential}`,
      accept: 'application/json',
      ...(options.userAgent ? { 'user-agent': options.userAgent } : {}),
      ...lowerKeys(options.headers),
    };
  }

  /**
   * Issues one request, applying auth, the timeout and the retry policy.
   *
   * Exposed so you can reach an endpoint the SDK does not wrap yet.
   */
  async request<T>(req: CoreRequest): Promise<T> {
    const url = `${this.baseUrl}${req.path}${buildQuery(req.query)}`;
    const accept = req.accept ?? 'json';
    const maxAttempts = Math.max(0, this.retry.retries) + 1;

    for (let attempt = 0; ; attempt += 1) {
      // Transport failures are not retried: they are not one of the three
      // statuses the API documents as transient.
      const response = await this.send(url, req, accept);

      if (response.ok || response.status === 304) {
        return (await this.readBody(response, accept)) as T;
      }

      const error = await this.toError(response, req.method, url);
      const isLastAttempt = attempt >= maxAttempts - 1;
      if (isLastAttempt || !this.retry.statuses.includes(response.status)) throw error;
      await this.sleep(this.delayFor(attempt, response.status, error.retryAfter));
    }
  }

  private async send(url: string, req: CoreRequest, accept: NonNullable<CoreRequest['accept']>): Promise<Response> {
    const headers: Record<string, string> = { ...this.defaultHeaders, ...lowerKeys(req.headers) };
    if (accept === 'binary' && !req.headers?.accept) headers.accept = '*/*';

    const init: RequestInit = { method: req.method, headers };

    if (req.form) {
      // Let fetch set the multipart boundary itself.
      delete headers['content-type'];
      init.body = req.form;
    } else if (req.body !== undefined) {
      headers['content-type'] = 'application/json';
      init.body = JSON.stringify(req.body);
    }

    const timeoutMs = req.timeoutMs ?? this.timeoutMs;
    const controller = new AbortController();
    const abortWithReason = (reason: unknown) => {
      try {
        controller.abort(reason);
      } catch {
        controller.abort();
      }
    };
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (timeoutMs !== undefined && timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        abortWithReason(new Error('timeout'));
      }, timeoutMs);
    }
    const onOuterAbort = () => abortWithReason(req.signal?.reason);
    if (req.signal) {
      if (req.signal.aborted) onOuterAbort();
      else req.signal.addEventListener('abort', onOuterAbort, { once: true });
    }
    init.signal = controller.signal;

    try {
      return await this.fetchImpl(url, init);
    } catch (error) {
      if (timedOut) {
        throw new WasenderTimeoutError({
          status: 0,
          code: 'timeout',
          message: `Request timed out after ${timeoutMs} ms: ${req.method} ${req.path}`,
          method: req.method,
          url,
          cause: error,
        });
      }
      if (req.signal?.aborted) throw error;
      throw new WasenderConnectionError({
        status: 0,
        code: 'connection_error',
        message: `Could not reach ${this.baseUrl}: ${describe(error)}`,
        method: req.method,
        url,
        cause: error,
      });
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      req.signal?.removeEventListener('abort', onOuterAbort);
    }
  }

  private async readBody(response: Response, accept: NonNullable<CoreRequest['accept']>): Promise<unknown> {
    if (accept === 'binary') {
      return makeBinaryResult(await response.arrayBuffer(), response.headers.get('content-type'));
    }
    if (accept === 'empty' || response.status === 204) {
      // Drain the body so keep-alive sockets are released.
      await response.arrayBuffer().catch(() => undefined);
      return undefined;
    }
    const text = await response.text();
    if (text === '') return undefined;
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return text;
    }
  }

  private async toError(response: Response, method: string, url: string) {
    const raw = await response.text().catch(() => '');
    let data: unknown;
    try {
      data = raw === '' ? undefined : (JSON.parse(raw) as unknown);
    } catch {
      data = undefined;
    }

    const envelope = data && typeof data === 'object' ? (data as { error?: unknown }).error : undefined;
    const body: WasenderErrorBody = envelope && typeof envelope === 'object' ? (envelope as WasenderErrorBody) : {};

    const message =
      typeof body.message === 'string' && body.message !== ''
        ? body.message
        : fallbackMessage(response, raw);

    return createWasenderError({
      status: response.status,
      code: typeof body.code === 'number' ? body.code : response.status,
      message,
      details: typeof body.details === 'string' ? body.details : undefined,
      href: typeof body.href === 'string' ? body.href : undefined,
      support: typeof body.support === 'string' ? body.support : undefined,
      requestId: readRequestId(response.headers),
      retryAfter: parseRetryAfter(response.headers.get('retry-after')),
      raw,
      data,
      method,
      url,
    });
  }

  private delayFor(attempt: number, status: number, retryAfter: number | undefined): number {
    if (status === 429 && this.retry.respectRetryAfter && retryAfter !== undefined) {
      return Math.min(retryAfter * 1000, this.retry.maxRetryAfterMs);
    }
    const exponential = Math.min(this.retry.baseDelayMs * 2 ** attempt, this.retry.maxDelayMs);
    if (!this.retry.jitter) return exponential;
    // Half fixed, half random, so retries spread out without collapsing to zero.
    return Math.round(exponential / 2 + Math.random() * (exponential / 2));
  }
}

function lowerKeys(headers: Record<string, string> | undefined): Record<string, string> {
  if (!headers) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) out[key.toLowerCase()] = value;
  return out;
}

function fallbackMessage(response: Response, raw: string): string {
  const statusLine = `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`;
  const snippet = raw.trim().slice(0, 200);
  return snippet === '' ? statusLine : `${statusLine}: ${snippet}`;
}

function describe(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
