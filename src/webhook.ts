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

import { hmacSha256, toHex } from './sha256.js';

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

/** Compares two byte arrays without leaking where they differ. */
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
 * Computes the HMAC with Web Crypto when the runtime has it, falling back to
 * the SDK's own implementation otherwise.
 *
 * Node only exposes `crypto.subtle` globally from version 19, and this package
 * supports Node 18, so the fallback is not hypothetical.
 */
async function mac(secret: string, body: Uint8Array): Promise<Uint8Array> {
  const subtle = getSubtle();
  if (!subtle) return hmacSha256(textEncoder.encode(secret), body);
  const key = await subtle.importKey('raw', textEncoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  return new Uint8Array(await subtle.sign('HMAC', key, body as BufferSource));
}

/** Everything both verifiers check before touching a hash. */
function parseSignature(
  rawBody: RawBody | null | undefined,
  signatureHeader: string | null | undefined,
  secret: string,
): { provided: Uint8Array; body: Uint8Array } | undefined {
  if (rawBody === null || rawBody === undefined) return undefined;
  if (typeof signatureHeader !== 'string') return undefined;
  if (typeof secret !== 'string' || secret === '') return undefined;

  const header = signatureHeader.trim();
  if (!header.toLowerCase().startsWith(WEBHOOK_SIGNATURE_PREFIX)) return undefined;

  const provided = hexToBytes(header.slice(WEBHOOK_SIGNATURE_PREFIX.length).trim());
  if (!provided || provided.length !== 32) return undefined;

  return { provided, body: toBytes(rawBody) };
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
 * Uses Web Crypto where available (Node 19+, Bun, Deno, Workers, browsers) and
 * the SDK's own HMAC-SHA256 otherwise, so no Node builtin is imported and the
 * bundle stays usable in the browser. The comparison is constant time.
 */
export async function verifyWebhook(
  rawBody: RawBody | null | undefined,
  signatureHeader: string | null | undefined,
  secret: string,
): Promise<boolean> {
  try {
    const parsed = parseSignature(rawBody, signatureHeader, secret);
    if (!parsed) return false;
    return constantTimeEqual(parsed.provided, await mac(secret, parsed.body));
  } catch {
    return false;
  }
}

/**
 * The synchronous equivalent of `verifyWebhook()`, for handlers that cannot
 * await.
 *
 * Web Crypto has no synchronous API, so this always uses the SDK's own
 * HMAC-SHA256 rather than the runtime's. It imports no Node builtin, so it
 * works in the browser and on the edge as well. Prefer `verifyWebhook()` when
 * you can await, since it uses the platform implementation where there is one.
 */
export function verifyWebhookSync(
  rawBody: RawBody | null | undefined,
  signatureHeader: string | null | undefined,
  secret: string,
): boolean {
  try {
    const parsed = parseSignature(rawBody, signatureHeader, secret);
    if (!parsed) return false;
    return constantTimeEqual(parsed.provided, hmacSha256(textEncoder.encode(secret), parsed.body));
  } catch {
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
  return `${WEBHOOK_SIGNATURE_PREFIX}${toHex(await mac(secret, toBytes(rawBody)))}`;
}
