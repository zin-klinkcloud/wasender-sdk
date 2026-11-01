/**
 * @wasender/sdk: the official TypeScript SDK for wasender.dev.
 *
 * Two clients, matching the API's two credentials:
 *
 * - `WasenderClient` for messaging on https://api.wasender.dev with a channel
 *   token (`wsk_...`), one per connected WhatsApp number.
 * - `WasenderProvisioning` for creating and managing numbers on
 *   https://manage.wasender.dev with an organisation API key (`wsm_...`).
 *
 * ```ts
 * import { WasenderClient } from '@wasender/sdk';
 *
 * const wa = new WasenderClient({ token: process.env.WASENDER_TOKEN });
 * await wa.sendText({ to: '61371989950', body: 'Hello' });
 * ```
 *
 * Zero runtime dependencies, global `fetch`. Docs: https://docs.wasender.dev
 */

export { WasenderClient, DEFAULT_MESSAGING_BASE_URL, type WasenderClientOptions } from './client.js';

export {
  WasenderProvisioning,
  WasenderManageClient,
  DEFAULT_PROVISIONING_BASE_URL,
  type WasenderProvisioningOptions,
  type WasenderManageClientOptions,
} from './provisioning.js';

export {
  WasenderError,
  WasenderBadRequestError,
  WasenderAuthError,
  WasenderPaymentRequiredError,
  WasenderForbiddenError,
  WasenderNotFoundError,
  WasenderConflictError,
  WasenderPayloadTooLargeError,
  WasenderRateLimitError,
  WasenderNotImplementedError,
  WasenderUpstreamError,
  WasenderChannelUnavailableError,
  WasenderConnectionError,
  WasenderTimeoutError,
  WasenderConfigError,
  RETRYABLE_STATUSES,
  createWasenderError,
  parseRetryAfter,
  type WasenderErrorBody,
  type WasenderErrorInit,
} from './errors.js';

export {
  verifyWebhook,
  verifyWebhookSync,
  signWebhookBody,
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_SIGNATURE_PREFIX,
  type RawBody,
} from './webhook.js';

export {
  buildQuery,
  encodePathSegment,
  type BinaryResult,
  type CoreRequest,
  type FetchLike,
  type HttpMethod,
  type QueryParams,
  type QueryValue,
  type RequestOptions,
  type RetryOptions,
} from './http.js';

export type * from './types.js';
