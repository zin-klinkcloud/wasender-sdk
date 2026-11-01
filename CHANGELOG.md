# Changelog

All notable changes to `@wasender/sdk` are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[semantic versioning](https://semver.org/spec/v2.0.0.html).

## 0.1.0

First release.

### Added

- `WasenderClient` for the messaging API at https://api.wasender.dev, covering
  all 56 non-provisioning operations in the OpenAPI 3.1 spec: channel health,
  settings, login QR code, profile and logout; sending text, images, video,
  audio, voice notes, documents, stickers, locations, contact cards, link
  previews and polls; reading, editing, deleting, reacting to and marking
  messages read; delivery receipts; chats; contacts and reachability checks;
  full group administration; media upload, download and delete; presence and
  typing indicators.
- `WasenderProvisioning` (also exported as `WasenderManageClient`) for the
  provisioning API at https://manage.wasender.dev, covering all 10 operations:
  list, create, read, rename, delete, restart, disconnect, rotate token, and
  read or set a channel webhook.
- Every operation is reachable under its exact OpenAPI `operationId`, with short
  aliases (`sendText`, `sendImage`, `health`, `react`, and others) for the
  common calls.
- Typed errors: `WasenderError` with `status`, `code`, `message`, `details`,
  `href`, `support`, `requestId`, `retryAfter`, `raw`, `data` and `isRetryable`,
  plus a subclass per documented status, `WasenderConnectionError`,
  `WasenderTimeoutError` and `WasenderConfigError`.
- Optional retries for 429, 502 and 503 only, honouring `Retry-After` on 429 and
  backing off exponentially with jitter otherwise. Off by default.
- `timeoutMs` using `AbortController`, overridable per call, alongside support
  for a caller supplied `AbortSignal`.
- `verifyWebhook()`, `verifyWebhookSync()` and `signWebhookBody()` for
  `x-wasender-signature` (HMAC-SHA256 over the raw body), with a constant time
  comparison and the `WEBHOOK_SIGNATURE_HEADER` constant. Uses the runtime's
  Web Crypto where there is one and a bundled HMAC-SHA256 otherwise, since
  Node only exposes `crypto.subtle` globally from version 19.
- Credential guards: passing a `wsm_` key to the messaging client, or a `wsk_`
  token to the provisioning client, throws before any request is made.
- A `request()` escape hatch on both clients for endpoints the SDK does not wrap
  yet, and a `fetch` option for supplying your own transport.
- Dual ESM and CJS builds with type declarations for both, zero runtime
  dependencies, and no Node builtins, so the same bundle runs on Node 18+, Bun,
  Deno, Cloudflare Workers and in the browser.
