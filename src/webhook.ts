/**
 * Webhook signature verification.
 *
 * wasender.dev signs every webhook delivery with
 * `x-wasender-signature: sha256=<hex>`, an HMAC-SHA256 of the raw request body
 * using the webhook's secret. Verify against the bytes you received: parsing
 * and re-serialising JSON changes the bytes and the signature will never match.
 *
 * The secret comes back from `setChannelWebhook()` and can be read again with
 * `getChannelWebhook()`, or found in the dashboard.
 */

/** The header wasender.dev puts the signature in. */
export const WEBHOOK_SIGNATURE_HEADER = 'x-wasender-signature' as const;

/** The only signature scheme currently used. */
export const WEBHOOK_SIGNATURE_PREFIX = 'sha256=' as const;

export type RawBody = string | Uint8Array | ArrayBuffer;

const textEncoder = new TextEncoder();

function toBytes(body: RawBody): Uint8Array {
  if (typeof body === 'string') return textEncoder.encode(body);
  if (body instanceof Uint8Array) return body;
  return new Uint8Array(body);
}

/** Compares two equal-length byte arrays without leaking where they differ. */
function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= (a[i] as number) ^ (b[i] as number);
  return diff === 0;
}

function hexToBytes(hex: string): Uint8Array | undefined {
  if (hex.length === 0 || hex.length % 2 !== 0) return undefined;
  if (!/^[0-9a-fA-F]+$/.test(hex)) return undefined;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function getSubtle(): SubtleCrypto | undefined {
  const maybe = (globalThis as { crypto?: Crypto }).crypto;
  return maybe && typeof maybe.subtle?.importKey === 'function' ? maybe.subtle : undefined;
}

/**
 * Checks a webhook signature against the raw body.
 *
 * Returns false rather than throwing for every failure mode: a missing header,
 * a header without the `sha256=` prefix, non-hex digits, the wrong secret, a
 * tampered body, or an empty secret. That keeps handlers to one branch.
 *
 * ```ts
 * const ok = await verifyWebhook(rawBody, req.headers['x-wasender-signature'], secret);
 * if (!ok) return res.sendStatus(401);
 * ```
 *
 * Uses Web Crypto (`crypto.subtle`), which is global on Node 18+, Bun, Deno,
 * Cloudflare Workers and in browsers, so the SDK stays dependency free and the
 * bundle stays usable in the browser. There is deliberately no synchronous
 * variant: a synchronous HMAC would mean importing `node:crypto`, which breaks
 * non-Node bundles. The comparison is constant time.
 */
export async function verifyWebhook(
  rawBody: RawBody | null | undefined,
  signatureHeader: string | null | undefined,
  secret: string,
): Promise<boolean> {
  try {
    if (rawBody === null || rawBody === undefined) return false;
    if (typeof signatureHeader !== 'string') return false;
    if (typeof secret !== 'string' || secret === '') return false;

    const header = signatureHeader.trim();
    if (!header.toLowerCase().startsWith(WEBHOOK_SIGNATURE_PREFIX)) return false;

    const provided = hexToBytes(header.slice(WEBHOOK_SIGNATURE_PREFIX.length).trim());
    if (!provided || provided.length !== 32) return false;

    const subtle = getSubtle();
    if (!subtle) {
      throw new Error(
        'Web Crypto is unavailable in this runtime, so webhook signatures cannot be verified. Node 18+ or any modern runtime provides it.',
      );
    }

    const key = await subtle.importKey('raw', textEncoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
      'sign',
    ]);
    const expected = new Uint8Array(await subtle.sign('HMAC', key, toBytes(rawBody) as BufferSource));
    return constantTimeEqual(provided, expected);
  } catch (error) {
    // A genuinely broken runtime should be loud; bad input should not be.
    if (error instanceof Error && error.message.startsWith('Web Crypto is unavailable')) throw error;
    return false;
  }
}

/**
 * Computes the value a correct `x-wasender-signature` header would have.
 *
 * Useful for testing your own handler. Do not use it to compare signatures by
 * hand: use `verifyWebhook()`, which compares in constant time.
 */
export async function signWebhookBody(rawBody: RawBody, secret: string): Promise<string> {
  const subtle = getSubtle();
  if (!subtle) {
    throw new Error('Web Crypto is unavailable in this runtime, so a webhook signature cannot be computed.');
  }
  const key = await subtle.importKey('raw', textEncoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  const mac = new Uint8Array(await subtle.sign('HMAC', key, toBytes(rawBody) as BufferSource));
  let hex = '';
  for (const byte of mac) hex += byte.toString(16).padStart(2, '0');
  return `${WEBHOOK_SIGNATURE_PREFIX}${hex}`;
}
