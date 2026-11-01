/**
 * Error types for the wasender.dev SDK.
 *
 * Every non-2xx response is turned into a `WasenderError` (or one of its
 * subclasses). The API documents a single error body shape on every endpoint:
 *
 * ```json
 * {"error": {"code": 429, "message": "Rate limit exceeded", "details": "...",
 *            "href": "https://docs.wasender.dev/errors#rate-limit",
 *            "support": "support@wasender.dev"}}
 * ```
 *
 * Non-JSON bodies (an HTML error page from a proxy, for instance) are kept
 * verbatim on `raw` and the message falls back to the HTTP status line.
 */

/** HTTP statuses the API documents as worth retrying. */
export const RETRYABLE_STATUSES: readonly number[] = [429, 502, 503];

/** The error object inside a wasender.dev error body. */
export interface WasenderErrorBody {
  code?: number;
  message?: string;
  details?: string;
  href?: string;
  support?: string;
  [key: string]: unknown;
}

export interface WasenderErrorInit {
  /** HTTP status code. `0` for transport level failures (no response). */
  status: number;
  /** Error code from the body, falling back to the HTTP status. */
  code?: number | string;
  message: string;
  details?: string;
  href?: string;
  support?: string;
  /** Value of `x-request-id` (or an equivalent header) when present. */
  requestId?: string;
  /** Seconds to wait, parsed from `Retry-After` (numeric or HTTP date). */
  retryAfter?: number;
  /** Raw response body, exactly as received. */
  raw?: string;
  /** Parsed response body when it was valid JSON. */
  data?: unknown;
  /** Request method, for context in logs. */
  method?: string;
  /** Request URL, for context in logs. Never contains the token. */
  url?: string;
  /** Underlying error for transport failures. */
  cause?: unknown;
}

/** Any failed wasender.dev API call. */
export class WasenderError extends Error {
  /** HTTP status code, or `0` when the request never got a response. */
  readonly status: number;
  /** Error code from the body when present, otherwise the HTTP status. */
  readonly code: number | string;
  readonly details: string | undefined;
  readonly href: string | undefined;
  readonly support: string | undefined;
  readonly requestId: string | undefined;
  /** Seconds to wait before retrying, when the response said so. */
  readonly retryAfter: number | undefined;
  /** Raw response body. */
  readonly raw: string | undefined;
  /** Parsed JSON body, when the body was JSON. */
  readonly data: unknown;
  readonly method: string | undefined;
  readonly url: string | undefined;
  /** True for 429, 502 and 503. Everything else needs the request changed. */
  readonly isRetryable: boolean;

  constructor(init: WasenderErrorInit) {
    super(init.message, init.cause === undefined ? undefined : { cause: init.cause });
    this.name = new.target.name;
    this.status = init.status;
    this.code = init.code ?? init.status;
    this.details = init.details;
    this.href = init.href;
    this.support = init.support;
    this.requestId = init.requestId;
    this.retryAfter = init.retryAfter;
    this.raw = init.raw;
    this.data = init.data;
    this.method = init.method;
    this.url = init.url;
    this.isRetryable = RETRYABLE_STATUSES.includes(init.status);
    // Keeps `instanceof` working when the bundle is down-levelled.
    Object.setPrototypeOf(this, new.target.prototype);
  }

  /** True when `value` is a WasenderError, across bundle boundaries. */
  static isWasenderError(value: unknown): value is WasenderError {
    return value instanceof WasenderError;
  }
}

/** 400: malformed request. `details` usually names the offending field. */
export class WasenderBadRequestError extends WasenderError {}

/** 401: missing, malformed, revoked or unknown credential. */
export class WasenderAuthError extends WasenderError {}

/** 402: no active subscription, or a payment more than 7 days overdue. */
export class WasenderPaymentRequiredError extends WasenderError {}

/** 403: not permitted, often a group action that needs admin rights. */
export class WasenderForbiddenError extends WasenderError {}

/** 404: no such resource on this channel. Ids are per number. */
export class WasenderNotFoundError extends WasenderError {}

/** 409: conflicts with the channel's current state. */
export class WasenderConflictError extends WasenderError {}

/** 413: the file is too large for its media type. */
export class WasenderPayloadTooLargeError extends WasenderError {}

/** 429: rate limited. Check `retryAfter` before trying again. */
export class WasenderRateLimitError extends WasenderError {}

/** 501: the endpoint is not implemented by this service. */
export class WasenderNotImplementedError extends WasenderError {}

/** 502: upstream session runtime error. Retry once with backoff. */
export class WasenderUpstreamError extends WasenderError {}

/** 503: the channel is reconnecting, waking or redeploying. Retry with backoff. */
export class WasenderChannelUnavailableError extends WasenderError {}

/**
 * The request never reached the API: DNS failure, refused connection, offline
 * runtime. `status` is `0`.
 */
export class WasenderConnectionError extends WasenderError {}

/** The request was aborted because `timeoutMs` elapsed. `status` is `0`. */
export class WasenderTimeoutError extends WasenderError {}

/** A credential was passed to the wrong client. See the `wsk_`/`wsm_` split. */
export class WasenderConfigError extends WasenderError {}

const BY_STATUS: Record<number, new (init: WasenderErrorInit) => WasenderError> = {
  400: WasenderBadRequestError,
  401: WasenderAuthError,
  402: WasenderPaymentRequiredError,
  403: WasenderForbiddenError,
  404: WasenderNotFoundError,
  409: WasenderConflictError,
  413: WasenderPayloadTooLargeError,
  429: WasenderRateLimitError,
  501: WasenderNotImplementedError,
  502: WasenderUpstreamError,
  503: WasenderChannelUnavailableError,
};

/** Builds the most specific error subclass available for an HTTP status. */
export function createWasenderError(init: WasenderErrorInit): WasenderError {
  const Ctor = BY_STATUS[init.status] ?? WasenderError;
  return new Ctor(init);
}

/**
 * Parses a `Retry-After` header value into whole seconds.
 *
 * Accepts the delta-seconds form (`"30"`) and the HTTP date form
 * (`"Wed, 21 Oct 2026 07:28:00 GMT"`), which is measured against `now`.
 * Returns undefined for anything unparseable, and never a negative number.
 */
export function parseRetryAfter(value: string | null | undefined, now: number = Date.now()): number | undefined {
  if (value === null || value === undefined) return undefined;
  const text = value.trim();
  if (text === '') return undefined;
  if (/^\d+$/.test(text)) return Number(text);
  // A signed number is not valid delta-seconds, and `Date.parse` would read it
  // as a bare year, so reject it rather than guess.
  if (/^[+-]\d+$/.test(text)) return undefined;
  const asDate = Date.parse(text);
  if (Number.isNaN(asDate)) return undefined;
  return Math.max(0, Math.ceil((asDate - now) / 1000));
}
