import { describe, expect, it } from 'vitest';
import { WEBHOOK_SIGNATURE_HEADER, signWebhookBody, verifyWebhook } from '../src/webhook.js';

const SECRET = 'whsec_test_secret';
const BODY = JSON.stringify({
  event: 'messages',
  messages: [{ id: 'msg_1', type: 'text', chat_id: '61371989950@s.whatsapp.net', from_me: false, timestamp: 1735689600 }],
});

describe('verifyWebhook', () => {
  it('exports the header name the service signs with', () => {
    expect(WEBHOOK_SIGNATURE_HEADER).toBe('x-wasender-signature');
  });

  it('accepts a valid signature over the raw body', async () => {
    const signature = await signWebhookBody(BODY, SECRET);
    expect(signature).toMatch(/^sha256=[0-9a-f]{64}$/);
    await expect(verifyWebhook(BODY, signature, SECRET)).resolves.toBe(true);
  });

  it('accepts a Uint8Array body', async () => {
    const bytes = new TextEncoder().encode(BODY);
    const signature = await signWebhookBody(bytes, SECRET);
    await expect(verifyWebhook(bytes, signature, SECRET)).resolves.toBe(true);
    // The string and byte forms of the same body sign identically.
    await expect(verifyWebhook(BODY, signature, SECRET)).resolves.toBe(true);
  });

  it('accepts an ArrayBuffer body', async () => {
    const bytes = new TextEncoder().encode(BODY);
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const signature = await signWebhookBody(BODY, SECRET);
    await expect(verifyWebhook(buffer, signature, SECRET)).resolves.toBe(true);
  });

  it('rejects a tampered body', async () => {
    const signature = await signWebhookBody(BODY, SECRET);
    const tampered = BODY.replace('msg_1', 'msg_2');
    await expect(verifyWebhook(tampered, signature, SECRET)).resolves.toBe(false);
  });

  it('rejects a re-serialised body, which is why raw bytes matter', async () => {
    const signature = await signWebhookBody(BODY, SECRET);
    const reserialised = JSON.stringify(JSON.parse(BODY), null, 2);
    await expect(verifyWebhook(reserialised, signature, SECRET)).resolves.toBe(false);
  });

  it('rejects the wrong secret', async () => {
    const signature = await signWebhookBody(BODY, SECRET);
    await expect(verifyWebhook(BODY, signature, 'whsec_other')).resolves.toBe(false);
  });

  it('returns false rather than throwing for a missing header', async () => {
    await expect(verifyWebhook(BODY, undefined, SECRET)).resolves.toBe(false);
    await expect(verifyWebhook(BODY, null, SECRET)).resolves.toBe(false);
    await expect(verifyWebhook(BODY, '', SECRET)).resolves.toBe(false);
  });

  it('returns false for a malformed header', async () => {
    const valid = await signWebhookBody(BODY, SECRET);
    const hex = valid.slice('sha256='.length);
    await expect(verifyWebhook(BODY, hex, SECRET)).resolves.toBe(false);
    await expect(verifyWebhook(BODY, `sha1=${hex}`, SECRET)).resolves.toBe(false);
    await expect(verifyWebhook(BODY, 'sha256=', SECRET)).resolves.toBe(false);
    await expect(verifyWebhook(BODY, 'sha256=zzzz', SECRET)).resolves.toBe(false);
    await expect(verifyWebhook(BODY, `sha256=${hex.slice(0, 62)}`, SECRET)).resolves.toBe(false);
    await expect(verifyWebhook(BODY, `sha256=${hex}ff`, SECRET)).resolves.toBe(false);
  });

  it('tolerates header casing and surrounding whitespace', async () => {
    const signature = await signWebhookBody(BODY, SECRET);
    const upper = `SHA256=${signature.slice('sha256='.length).toUpperCase()}`;
    await expect(verifyWebhook(BODY, `  ${signature}  `, SECRET)).resolves.toBe(true);
    await expect(verifyWebhook(BODY, upper, SECRET)).resolves.toBe(true);
  });

  it('returns false for a missing body or an empty secret', async () => {
    const signature = await signWebhookBody(BODY, SECRET);
    await expect(verifyWebhook(null, signature, SECRET)).resolves.toBe(false);
    await expect(verifyWebhook(undefined, signature, SECRET)).resolves.toBe(false);
    await expect(verifyWebhook(BODY, signature, '')).resolves.toBe(false);
    await expect(verifyWebhook(BODY, signature, undefined as unknown as string)).resolves.toBe(false);
  });

  it('verifies an empty body, which still has a signature', async () => {
    const signature = await signWebhookBody('', SECRET);
    await expect(verifyWebhook('', signature, SECRET)).resolves.toBe(true);
    await expect(verifyWebhook('x', signature, SECRET)).resolves.toBe(false);
  });
});
