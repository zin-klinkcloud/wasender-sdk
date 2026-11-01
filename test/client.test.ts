import { describe, expect, it } from 'vitest';
import { WasenderClient } from '../src/client.js';
import { WasenderConfigError } from '../src/errors.js';
import { createFetchMock } from './helpers.js';

describe('WasenderClient basics', () => {
  it('matches the documented quickstart', async () => {
    const mock = createFetchMock({
      body: { sent: true, message: { id: 'msg_1', type: 'text', chat_id: 'c', from_me: true, timestamp: 1 } },
    });
    const wa = new WasenderClient({ token: 'wsk_sg_quickstart', fetch: mock.fetch });

    const result = await wa.sendText({ to: '61371989950', body: 'Hello' });

    expect(result.sent).toBe(true);
    expect(result.message?.id).toBe('msg_1');
    const call = mock.calls[0]!;
    expect(call.url).toBe('https://api.wasender.dev/messages/text');
    expect(call.method).toBe('POST');
    expect(call.headers.authorization).toBe('Bearer wsk_sg_quickstart');
    expect(call.headers['content-type']).toBe('application/json');
    expect(call.json).toEqual({ to: '61371989950', body: 'Hello' });
  });

  it('sends the token as a bearer header and never in the query string', async () => {
    const mock = createFetchMock({ body: {} });
    const wa = new WasenderClient({ token: 'wsk_sg_secret', fetch: mock.fetch });
    await wa.getChats({ count: 10 });
    const call = mock.calls[0]!;
    expect(call.headers.authorization).toBe('Bearer wsk_sg_secret');
    expect(call.url).not.toContain('wsk_sg_secret');
  });

  it('uses a custom base URL and trims a trailing slash', async () => {
    const mock = createFetchMock({ body: {} });
    const wa = new WasenderClient({ token: 'wsk_sg_test', baseUrl: 'http://localhost:8787/', fetch: mock.fetch });
    expect(wa.baseUrl).toBe('http://localhost:8787');
    await wa.checkHealth();
    expect(mock.calls[0]!.url).toBe('http://localhost:8787/health');
  });

  it('serialises query parameters per the spec, skipping undefined', async () => {
    const mock = createFetchMock({ body: {} });
    const wa = new WasenderClient({ token: 'wsk_sg_test', fetch: mock.fetch });
    await wa.getMessages({
      chat_id: '61371989950@s.whatsapp.net',
      count: 50,
      offset: 0,
      normal_types: true,
      time_from: 1735689600,
      time_to: undefined,
    });
    const url = new URL(mock.calls[0]!.url);
    expect(url.pathname).toBe('/messages/list');
    expect(url.searchParams.get('chat_id')).toBe('61371989950@s.whatsapp.net');
    expect(url.searchParams.get('count')).toBe('50');
    expect(url.searchParams.get('offset')).toBe('0');
    expect(url.searchParams.get('normal_types')).toBe('true');
    expect(url.searchParams.get('time_from')).toBe('1735689600');
    expect(url.searchParams.has('time_to')).toBe(false);
    // The `@` is escaped on the wire even though URL decodes it for reading.
    expect(mock.calls[0]!.url).toContain('chat_id=61371989950%40s.whatsapp.net');
  });

  it('url-encodes path parameters', async () => {
    const mock = createFetchMock({ body: {} });
    const wa = new WasenderClient({ token: 'wsk_sg_test', fetch: mock.fetch });
    await wa.getMessage('ABGG/FlA+5 Fp?x=1#y');
    expect(mock.calls[0]!.url).toBe('https://api.wasender.dev/messages/ABGG%2FFlA%2B5%20Fp%3Fx%3D1%23y');
  });

  it('sends no body and no content-type on bodyless calls', async () => {
    const mock = createFetchMock({ body: { success: true } });
    const wa = new WasenderClient({ token: 'wsk_sg_test', fetch: mock.fetch });
    await wa.markMessageAsRead('msg_1');
    const call = mock.calls[0]!;
    expect(call.body).toBeUndefined();
    expect(call.headers['content-type']).toBeUndefined();
  });

  it('merges custom headers, with per-call headers winning', async () => {
    const mock = createFetchMock({ body: {} });
    const wa = new WasenderClient({
      token: 'wsk_sg_test',
      fetch: mock.fetch,
      headers: { 'x-tenant': 'acme', 'x-trace': 'client' },
    });
    await wa.checkHealth({}, { headers: { 'x-trace': 'call' } });
    expect(mock.calls[0]!.headers['x-tenant']).toBe('acme');
    expect(mock.calls[0]!.headers['x-trace']).toBe('call');
  });

  it('returns the QR code as binary with base64 and data URL helpers', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const mock = createFetchMock({ bytes: png, contentType: 'image/png' });
    const wa = new WasenderClient({ token: 'wsk_sg_test', fetch: mock.fetch });

    const qr = await wa.getLoginQr({ size: 400 });

    expect(qr.contentType).toBe('image/png');
    expect(new Uint8Array(qr.data)).toEqual(png);
    expect(qr.bytes.byteLength).toBe(4);
    expect(qr.base64()).toBe('iVBORw==');
    expect(qr.dataUrl()).toBe('data:image/png;base64,iVBORw==');
    expect(qr.blob().type).toBe('image/png');
    expect(new URL(mock.calls[0]!.url).searchParams.get('size')).toBe('400');
    expect(mock.calls[0]!.headers.accept).toBe('*/*');
  });

  it('downloads media as binary', async () => {
    const mock = createFetchMock({ bytes: new Uint8Array([1, 2, 3]), contentType: 'application/pdf' });
    const wa = new WasenderClient({ token: 'wsk_sg_test', fetch: mock.fetch });
    const file = await wa.getMedia('med_1');
    expect(file.contentType).toBe('application/pdf');
    expect(file.bytes).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('uploads media as multipart/form-data, as the spec requires', async () => {
    const mock = createFetchMock({ body: { id: 'med_1' } });
    const wa = new WasenderClient({ token: 'wsk_sg_test', fetch: mock.fetch });

    await wa.uploadMedia({ media: new Uint8Array([1, 2, 3]), filename: 'menu.pdf', contentType: 'application/pdf' });

    const call = mock.calls[0]!;
    expect(call.form).toBeInstanceOf(FormData);
    // fetch sets the multipart boundary itself, so the SDK must not pin one.
    expect(call.headers['content-type']).toBeUndefined();
    const part = call.form!.get('media') as File;
    expect(part).toBeInstanceOf(Blob);
    expect(part.type).toBe('application/pdf');
    expect((part as File).name).toBe('menu.pdf');
  });

  it('switches a media send to multipart when the bytes travel with the request', async () => {
    const mock = createFetchMock({ body: { sent: true } });
    const wa = new WasenderClient({ token: 'wsk_sg_test', fetch: mock.fetch });

    await wa.sendImage({
      to: '61371989950',
      media: new Uint8Array([9, 9]),
      caption: 'Here it is',
      quoted: 'msg_0',
      filename: 'photo.jpg',
      mime_type: 'image/jpeg',
    });

    const form = mock.calls[0]!.form!;
    expect(form.get('to')).toBe('61371989950');
    expect(form.get('caption')).toBe('Here it is');
    expect(form.get('quoted')).toBe('msg_0');
    const part = form.get('media') as File;
    expect(part.name).toBe('photo.jpg');
    expect(part.type).toBe('image/jpeg');
  });

  it('keeps a media send as JSON when media is a URL, data URI or media id', async () => {
    const mock = createFetchMock({ body: { sent: true } });
    const wa = new WasenderClient({ token: 'wsk_sg_test', fetch: mock.fetch });
    await wa.sendDocument({ to: '61371989950', media: 'med_1', filename: 'menu.pdf' });
    expect(mock.calls[0]!.form).toBeUndefined();
    expect(mock.calls[0]!.json).toEqual({ to: '61371989950', media: 'med_1', filename: 'menu.pdf' });
  });

  it('exposes a request escape hatch for unwrapped endpoints', async () => {
    const mock = createFetchMock({ body: { anything: 1 } });
    const wa = new WasenderClient({ token: 'wsk_sg_test', fetch: mock.fetch });
    const out = await wa.request<{ anything: number }>({ method: 'GET', path: '/chats', query: { count: 1 } });
    expect(out.anything).toBe(1);
    expect(mock.calls[0]!.url).toBe('https://api.wasender.dev/chats?count=1');
  });

  it('handles an empty 204 response without throwing', async () => {
    const mock = createFetchMock({ status: 204 });
    const wa = new WasenderClient({ token: 'wsk_sg_test', fetch: mock.fetch });
    await expect(wa.deleteChat('61371989950@s.whatsapp.net')).resolves.toBeUndefined();
  });

  it('builds reaction and typing shorthands on the documented endpoints', async () => {
    const mock = createFetchMock({ body: { success: true } });
    const wa = new WasenderClient({ token: 'wsk_sg_test', fetch: mock.fetch });
    await wa.react('msg_1', '👍');
    await wa.sendTyping('61371989950', 3);
    expect(mock.calls[0]!.json).toEqual({ emoji: '👍' });
    expect(mock.calls[0]!.url).toBe('https://api.wasender.dev/messages/msg_1/reaction');
    expect(mock.calls[1]!.json).toEqual({ presence: 'typing', delay: 3 });
    expect(mock.calls[1]!.url).toBe('https://api.wasender.dev/presences/61371989950');
  });
});

describe('credential guards', () => {
  it('rejects an organisation API key passed to the messaging client', () => {
    expect(() => new WasenderClient({ token: 'wsm_abc123' })).toThrow(WasenderConfigError);
    expect(() => new WasenderClient({ token: 'wsm_abc123' })).toThrow(/organisation API key/i);
  });

  it('rejects a missing or blank token', () => {
    expect(() => new WasenderClient({ token: '' })).toThrow(WasenderConfigError);
    expect(() => new WasenderClient({ token: undefined as unknown as string })).toThrow(/channel token/i);
  });

  it('accepts a channel token and trims surrounding whitespace', async () => {
    const mock = createFetchMock({ body: {} });
    const wa = new WasenderClient({ token: '  wsk_sg_padded\n', fetch: mock.fetch });
    await wa.checkHealth();
    expect(mock.calls[0]!.headers.authorization).toBe('Bearer wsk_sg_padded');
  });
});
