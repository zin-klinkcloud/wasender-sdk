/**
 * `WasenderProvisioning`: the provisioning API at https://manage.wasender.dev.
 *
 * These endpoints create and manage WhatsApp numbers, and they authenticate
 * with an organisation API key (`wsm_...`), not a channel token. A channel
 * token authenticates one number, so it cannot create one: there is nothing to
 * authenticate with before the number exists.
 */

import { WasenderConfigError } from './errors.js';
import {
  ClientCore,
  encodePathSegment as enc,
  type ClientCoreOptions,
  type CoreRequest,
  type FetchLike,
  type RequestOptions,
  type RetryOptions,
} from './http.js';
import type {
  ChannelWebhookResponse,
  CreateChannelBody,
  CreateChannelResponse,
  GetChannelResponse,
  ListChannelsResponse,
  RenameChannelBody,
  RenameChannelResponse,
  RotateChannelTokenResponse,
  SetChannelWebhookBody,
  SuccessResponse,
} from './types.js';

export const DEFAULT_PROVISIONING_BASE_URL = 'https://manage.wasender.dev';

export interface WasenderProvisioningOptions {
  /**
   * An organisation API key (`wsm_...`), created in the dashboard under
   * API -> API keys and shown once. Sent as `Authorization: Bearer`.
   */
  apiKey: string;
  /** Defaults to https://manage.wasender.dev. */
  baseUrl?: string;
  fetch?: FetchLike;
  /** Abort a request after this many milliseconds. Off by default. */
  timeoutMs?: number;
  /** Retry policy, or a number meaning "this many retries". Off by default. */
  retry?: RetryOptions | number;
  /** Shorthand for `retry: { retries: n }`. */
  maxRetries?: number;
  headers?: Record<string, string>;
  sleep?: (ms: number) => Promise<void>;
  userAgent?: string;
}

function assertOrgApiKey(apiKey: unknown): string {
  if (typeof apiKey !== 'string' || apiKey.trim() === '') {
    throw new WasenderConfigError({
      status: 0,
      code: 'missing_api_key',
      message:
        'WasenderProvisioning needs an organisation API key: new WasenderProvisioning({ apiKey: process.env.WASENDER_API_KEY }).',
    });
  }
  const value = apiKey.trim();
  if (value.startsWith('wsk_')) {
    throw new WasenderConfigError({
      status: 0,
      code: 'wrong_credential',
      message:
        'That is a channel token (wsk_), which authenticates one number and cannot create one. Pass an organisation API key (wsm_) to WasenderProvisioning, or use WasenderClient for https://api.wasender.dev.',
      href: 'https://docs.wasender.dev',
    });
  }
  return value;
}

/**
 * The provisioning client: one number per customer, from your own code.
 *
 * ```ts
 * import { WasenderProvisioning, WasenderClient } from '@wasender/sdk';
 *
 * const manage = new WasenderProvisioning({ apiKey: process.env.WASENDER_API_KEY });
 * const { channel, token } = await manage.createChannel({ name: 'tenant_8421' });
 * // Store `token` now: it is shown once and only a hash is kept.
 * const wa = new WasenderClient({ token: token! });
 * const qr = await wa.getLoginQr();
 * ```
 */
export class WasenderProvisioning {
  private readonly core: ClientCore;

  constructor(options: WasenderProvisioningOptions) {
    const apiKey = assertOrgApiKey(options?.apiKey);
    this.core = new ClientCore({
      baseUrl: options.baseUrl ?? DEFAULT_PROVISIONING_BASE_URL,
      credential: apiKey,
      fetch: options.fetch,
      timeoutMs: options.timeoutMs,
      retry: options.retry,
      maxRetries: options.maxRetries,
      headers: options.headers,
      sleep: options.sleep,
      userAgent: options.userAgent,
    } satisfies ClientCoreOptions);
  }

  /** The base URL this client talks to. */
  get baseUrl(): string {
    return this.core.baseUrl;
  }

  /** Escape hatch for a provisioning endpoint the SDK does not wrap yet. */
  request<T = unknown>(req: CoreRequest): Promise<T> {
    return this.core.request<T>(req);
  }

  /** Lists every number in the workspace. */
  listChannels(opts?: RequestOptions): Promise<ListChannelsResponse> {
    return this.core.request({ method: 'GET', path: '/channels', ...opts });
  }

  /**
   * Creates a WhatsApp number and returns its channel token.
   *
   * The token is shown once and only a hash is stored, so save it against
   * whoever owns the number in the same handler. If it is lost,
   * `rotateChannelToken()` issues a replacement.
   *
   * The channel starts `pending`. Fetch a QR code with
   * `new WasenderClient({ token }).getLoginQr()`, have the owner scan it, then
   * poll `getChannel()` until `status` is `connected`.
   *
   * Returns 402 if the workspace has no active subscription or trial.
   */
  createChannel(body: CreateChannelBody = {}, opts?: RequestOptions): Promise<CreateChannelResponse> {
    return this.core.request({ method: 'POST', path: '/channels', body, ...opts });
  }

  /** Reads one number. Poll this after creating one to see when it connects. */
  getChannel(channelId: string, opts?: RequestOptions): Promise<GetChannelResponse> {
    return this.core.request({ method: 'GET', path: `/channels/${enc(channelId)}`, ...opts });
  }

  /** Renames a number. The label is for your reference only. */
  renameChannel(channelId: string, body: RenameChannelBody, opts?: RequestOptions): Promise<RenameChannelResponse> {
    return this.core.request({ method: 'PATCH', path: `/channels/${enc(channelId)}`, body, ...opts });
  }

  /**
   * Deletes a number.
   *
   * Tears down the WhatsApp session and stops the token working immediately.
   * Irreversible: reconnecting means creating a new number and a fresh scan.
   */
  deleteChannel(channelId: string, opts?: RequestOptions): Promise<SuccessResponse> {
    return this.core.request({ method: 'DELETE', path: `/channels/${enc(channelId)}`, ...opts });
  }

  /**
   * Restarts the session without a QR re-scan: the repair for a number that is
   * technically connected but has stopped delivering. Costs a few seconds
   * offline, and returns 409 if the number has never connected.
   */
  restartChannel(channelId: string, opts?: RequestOptions): Promise<SuccessResponse> {
    return this.core.request({ method: 'POST', path: `/channels/${enc(channelId)}/restart`, ...opts });
  }

  /**
   * Unlinks the number from WhatsApp, discarding its credentials. The channel
   * and its token survive, but reconnecting needs a fresh QR scan. Use
   * `restartChannel()` instead if you only want to reconnect.
   */
  disconnectChannel(channelId: string, opts?: RequestOptions): Promise<SuccessResponse> {
    return this.core.request({ method: 'POST', path: `/channels/${enc(channelId)}/disconnect`, ...opts });
  }

  /**
   * Issues a replacement channel token. The previous one stops working
   * immediately and the new one is shown once.
   */
  rotateChannelToken(channelId: string, opts?: RequestOptions): Promise<RotateChannelTokenResponse> {
    return this.core.request({ method: 'POST', path: `/channels/${enc(channelId)}/rotate-token`, ...opts });
  }

  /**
   * Reads a number's webhook configuration, including the HMAC signing secret
   * used by `verifyWebhook()`.
   */
  getChannelWebhook(channelId: string, opts?: RequestOptions): Promise<ChannelWebhookResponse> {
    return this.core.request({ method: 'GET', path: `/channels/${enc(channelId)}/webhook`, ...opts });
  }

  /** Sets or removes a number's webhook. Pass `url: null` to remove it. */
  setChannelWebhook(
    channelId: string,
    body: SetChannelWebhookBody,
    opts?: RequestOptions,
  ): Promise<ChannelWebhookResponse> {
    return this.core.request({ method: 'PUT', path: `/channels/${enc(channelId)}/webhook`, body, ...opts });
  }
}

/** Alias for {@link WasenderProvisioning}. */
export const WasenderManageClient = WasenderProvisioning;
export type WasenderManageClient = WasenderProvisioning;

/** Alias for {@link WasenderProvisioningOptions}. */
export type WasenderManageClientOptions = WasenderProvisioningOptions;
