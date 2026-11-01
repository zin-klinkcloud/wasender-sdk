# @wasender/sdk

Official TypeScript SDK for [wasender.dev](https://wasender.dev): send and receive WhatsApp messages over plain HTTP.

- Zero runtime dependencies, built on global `fetch`
- Dual ESM and CJS builds with type declarations
- Covers all 66 operations in the [OpenAPI spec](https://docs.wasender.dev/openapi.yaml): 56 messaging plus 10 provisioning
- Typed errors, optional retries, timeouts, and a webhook signature verifier

Docs: [docs.wasender.dev](https://docs.wasender.dev)

## Install

```bash
npm install @wasender/sdk
```

Requires Node 18 or newer. Also runs on Bun, Deno, Cloudflare Workers and in the browser: anywhere global `fetch` is available.

## Quickstart

```ts
import { WasenderClient } from '@wasender/sdk';

const wa = new WasenderClient({ token: process.env.WASENDER_TOKEN });
await wa.sendText({ to: '61371989950', body: 'Hello' });
```

Two things to know before your first send:

- **A 2xx means accepted, not delivered.** WhatsApp does not reject an unreachable recipient synchronously. Confirm real delivery with `statuses` webhook events or `wa.getMessageStatuses(id)`.
- **Recipients are phone numbers in international format without a leading `+`** (`61371989950`), or a full chat id (`61371989950@s.whatsapp.net`, or `1234567890@g.us` for a group).

## Two credentials, two clients

| | Base URL | Credential | Client |
|---|---|---|---|
| Messaging | `https://api.wasender.dev` | channel token `wsk_...` | `WasenderClient` |
| Provisioning | `https://manage.wasender.dev` | organisation API key `wsm_...` | `WasenderProvisioning` |

A channel token authenticates one WhatsApp number, so it cannot create one. Create an organisation API key in the dashboard under API, then API keys. Passing the wrong credential to either client throws a `WasenderConfigError` immediately, before any request goes out.

## Connecting a number

Create the channel, show its QR code, poll until it connects.

```ts
import { WasenderClient, WasenderProvisioning } from '@wasender/sdk';

const manage = new WasenderProvisioning({ apiKey: process.env.WASENDER_API_KEY });

// 1. Create the number. The token comes back once, so store it now.
const { channel, token } = await manage.createChannel({ name: 'tenant_8421' });

// 2. Fetch a QR code with that channel token and show it to the owner.
const wa = new WasenderClient({ token: token! });
const qr = await wa.getLoginQr({ size: 300 });
// qr.bytes is a Uint8Array, qr.blob() a Blob, qr.dataUrl() an <img> src.
// QR codes rotate roughly every 20 seconds, so re-request when one expires.

// 3. Poll until it is connected. Scanning happens in WhatsApp on the phone,
//    under Settings, Linked devices, Link a device.
let status = channel?.status;
while (status !== 'connected') {
  await new Promise((r) => setTimeout(r, 3000));
  status = (await manage.getChannel(channel!.id!)).channel?.status;
  if (status === 'suspended' || status === 'logged_out') throw new Error(`stopped at ${status}`);
}
```

`wa.checkHealth()` reports the same thing from the channel's own side, which is handy once you only hold a channel token.

## Sending

```ts
// Text, optionally as a reply, with a typing indicator first
await wa.sendText({ to: '61371989950', body: 'On it, give me two minutes.', quoted: messageId, typing_time: 2 });

// Media: a URL we fetch, a base64 data URI, or an uploaded media id
await wa.sendImage({ to, media: 'https://example.com/photo.jpg', caption: 'As promised' });
await wa.sendVideo({ to, media: 'https://example.com/clip.mp4' });
await wa.sendAudio({ to, media: 'https://example.com/track.mp3' });
await wa.sendVoice({ to, media: 'https://example.com/note.ogg' }); // push-to-play, Opus in Ogg
await wa.sendDocument({ to, media: 'https://example.com/menu.pdf', filename: 'menu.pdf' });
await wa.sendSticker({ to, media: 'https://example.com/sticker.webp' });

// Media can also travel with the request, which switches it to multipart
await wa.sendImage({ to, media: bytes, filename: 'photo.jpg', mime_type: 'image/jpeg' });

// Everything else
await wa.sendLocation({ to, latitude: 1.3521, longitude: 103.8198, name: 'Singapore' });
await wa.sendContact({ to, name: 'Ada', vcard: 'BEGIN:VCARD\nVERSION:3.0\nFN:Ada\nEND:VCARD' });
await wa.sendLinkPreview({ to, body: 'Have a look: https://wasender.dev', title: 'wasender.dev' });
await wa.sendPoll({ to, title: 'Tea or coffee?', options: ['Tea', 'Coffee'] });
```

Upload once and reuse the id across recipients, which is much cheaper than re-uploading per send:

```ts
const file = await wa.uploadMedia({ media: bytes, filename: 'menu.pdf', contentType: 'application/pdf' });
await wa.sendDocument({ to, media: file.id!, filename: 'menu.pdf' });
```

Reading, editing and reacting:

```ts
await wa.getMessages({ chat_id: '61371989950@s.whatsapp.net', count: 50 });
await wa.getMessage(messageId);
await wa.editMessage(messageId, { body: 'Corrected' }); // your own messages, within 15 minutes
await wa.react(messageId, '👍');
await wa.deleteMessage(messageId);
await wa.checkPhones({ contacts: ['61371989950', '61371989951'] });
```

Every operation is also available under its exact OpenAPI `operationId` (`wa.sendMessageText`, `wa.getMessagesByChatId`, `wa.promoteGroupAdmins`, and so on), so the spec and your code stay searchable against each other. The short names above are aliases for the common ones.

Two operations exist in the spec but are not supported by the service and always return 501, which the SDK raises as `WasenderNotImplementedError`: `starMessage()` (`PUT /messages/{id}/star`) and `subscribeToPresence()` (`POST /presences/{id}`). They are included so the operation is reachable and the failure is explicit rather than silent. Presence updates arrive through webhooks instead.

## Webhooks

Register a webhook with the channel token, or per tenant with the organisation key:

```ts
await wa.updateSettings({
  webhooks: [{ url: 'https://example.com/webhooks/wasender', events: [{ type: 'messages' }, { type: 'statuses' }] }],
});

// or, with the organisation API key, which also returns the signing secret
const { webhook } = await manage.setChannelWebhook(channelId, {
  url: 'https://example.com/webhooks/tenant_8421',
  events: ['messages', 'statuses'],
});
// webhook.secret is the HMAC key. Read it back later with manage.getChannelWebhook(channelId).
```

Deliveries are signed with `x-wasender-signature: sha256=<hex>`, an HMAC-SHA256 over the **raw** body. Verify before parsing: re-serialising parsed JSON changes the bytes and the signature will never match.

```ts
import express from 'express';
import { verifyWebhook, WEBHOOK_SIGNATURE_HEADER } from '@wasender/sdk';

const app = express();

app.post('/webhooks/wasender', express.raw({ type: 'application/json' }), async (req, res) => {
  const ok = await verifyWebhook(req.body, req.header(WEBHOOK_SIGNATURE_HEADER), process.env.WASENDER_WEBHOOK_SECRET!);
  if (!ok) return res.sendStatus(401);

  res.sendStatus(200); // acknowledge first, then do the work
  const event = JSON.parse(req.body.toString());
  for (const message of event.messages ?? []) {
    if (message.from_me) continue; // your own sends are echoed back
    await queue.add(message); // keep handlers idempotent, keyed on message.id
  }
});
```

`verifyWebhook(rawBody, signatureHeader, secret)` takes a `string`, `Uint8Array` or `ArrayBuffer` body, compares in constant time, and returns `false` rather than throwing for a missing header, a malformed header, the wrong secret or a tampered body. `verifyWebhookSync()` is the same check for handlers that cannot await, and `signWebhookBody()` is exported for testing your own handler.

It uses the runtime's Web Crypto where there is one, and the SDK's own HMAC-SHA256 otherwise (Node only exposes `crypto.subtle` globally from version 19, and this package supports Node 18). No Node builtin is imported either way, so the same code works in the browser and on the edge. The synchronous variant always uses the SDK implementation, since Web Crypto has no synchronous API.

Non-2xx or slow webhook responses are retried with backoff, so return 200 quickly and process afterwards.

## Errors

Every non-2xx response throws a `WasenderError`:

```ts
import { WasenderError, WasenderRateLimitError } from '@wasender/sdk';

try {
  await wa.sendText({ to: '61371989950', body: 'Hello' });
} catch (error) {
  if (error instanceof WasenderRateLimitError) {
    console.log('wait', error.retryAfter, 'seconds');
  } else if (error instanceof WasenderError) {
    console.error(error.status, error.code, error.message, error.details, error.href, error.requestId);
    console.error(error.raw); // the body exactly as received
  }
}
```

| Field | Meaning |
|---|---|
| `status` | HTTP status. `0` for a transport failure or a timeout |
| `code` | `error.code` from the body, falling back to the HTTP status |
| `message`, `details`, `href`, `support` | from the documented error body |
| `requestId` | `x-request-id` from the response headers, when present |
| `retryAfter` | seconds, parsed from `Retry-After` (delta-seconds or HTTP date) |
| `raw`, `data` | the raw body, and the parsed body when it was JSON |
| `isRetryable` | true for 429, 502 and 503 |

Subclasses: `WasenderBadRequestError` (400), `WasenderAuthError` (401), `WasenderPaymentRequiredError` (402), `WasenderForbiddenError` (403), `WasenderNotFoundError` (404), `WasenderConflictError` (409), `WasenderPayloadTooLargeError` (413), `WasenderRateLimitError` (429), `WasenderNotImplementedError` (501), `WasenderUpstreamError` (502), `WasenderChannelUnavailableError` (503). A request that never got a response throws `WasenderConnectionError`, a request that ran out of time throws `WasenderTimeoutError`, and a misconfigured client throws `WasenderConfigError`. All of them extend `WasenderError`, and non-JSON error bodies are handled too.

## Retries and timeouts

Retrying is off by default, because retrying a send you cannot tell apart from a success is a decision for your application, not the SDK.

```ts
const wa = new WasenderClient({
  token: process.env.WASENDER_TOKEN,
  retry: {
    retries: 3,            // 0 disables retrying (the default)
    baseDelayMs: 500,      // exponential: 500, 1000, 2000, ...
    maxDelayMs: 20_000,    // cap on any single wait
    jitter: true,          // spread retries out
    maxRetryAfterMs: 60_000,
  },
  timeoutMs: 30_000,       // per request, via AbortController
});
```

`maxRetries: 3` and `retry: 3` are shorthands for the same thing. Only 429, 502 and 503 are retried, which is what the docs recommend: a 429 waits the `Retry-After` seconds when the response gives one, and 502 and 503 back off exponentially with jitter up to the cap. Nothing else is retried, since every other status needs the request changed. Transport failures are not retried either.

Per call you can override the timeout, pass your own `AbortSignal` and add headers:

```ts
await wa.sendText({ to, body: 'Hello' }, { timeoutMs: 5000, signal: controller.signal, headers: { 'x-trace': id } });
```

Rate limits are 60 messages a minute and 5,000 a day per number by default. They exist to keep the number from being restricted by WhatsApp, so back off rather than work around them.

## Provisioning

One number per customer, from your own code. All ten operations:

```ts
const manage = new WasenderProvisioning({ apiKey: process.env.WASENDER_API_KEY });

await manage.listChannels();
await manage.createChannel({ name: 'tenant_8421', region: 'sg' }); // returns the token, once
await manage.getChannel(id);
await manage.renameChannel(id, { name: 'tenant_8421 (prod)' });
await manage.restartChannel(id);     // reconnect without a re-scan
await manage.disconnectChannel(id);  // discard credentials, keep the channel
await manage.rotateChannelToken(id); // the old token stops working immediately
await manage.getChannelWebhook(id);
await manage.setChannelWebhook(id, { url: null }); // null removes it
await manage.deleteChannel(id);      // irreversible
```

`WasenderManageClient` is exported as an alias of `WasenderProvisioning`.

## Runtime support

| Runtime | Notes |
|---|---|
| Node 18, 20, 22+ | tested in CI. On Node 18 the webhook verifier uses the SDK's own HMAC-SHA256, since global Web Crypto only arrived in Node 19 |
| Bun, Deno | global `fetch` and Web Crypto |
| Cloudflare Workers and other edge runtimes | no Node builtins are imported |
| Browsers | works, but a channel token in client-side code grants full control of the number, so keep it on a server |

Supply your own transport with the `fetch` option if you need tracing, a proxy or a mock.

## Escape hatch

If an endpoint appears before this SDK wraps it:

```ts
await wa.request({ method: 'GET', path: '/some/new/endpoint', query: { count: 10 } });
```

## Honest limits

This service drives WhatsApp through an unofficial client, the same mechanism as WhatsApp Web, and Meta does not sanction it. Use a dedicated number you can afford to lose, do not send first-contact messages to people who have not opted in, and keep a fallback channel for anything auth or revenue critical. For regulated workloads, use Meta's official Cloud API instead.

Message history starts when the number is connected: anything older was never seen by the service and cannot be backfilled.

## Links

- Docs and interactive reference: https://docs.wasender.dev
- Product: https://wasender.dev
- Issues: https://github.com/zin-klinkcloud/wasender-sdk/issues

## License

MIT
