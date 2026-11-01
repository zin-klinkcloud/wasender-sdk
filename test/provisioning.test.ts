import { describe, expect, it } from 'vitest';
import { WasenderClient } from '../src/client.js';
import { WasenderConfigError, WasenderPaymentRequiredError } from '../src/errors.js';
import { WasenderManageClient, WasenderProvisioning } from '../src/provisioning.js';
import { createFetchMock, errorBody } from './helpers.js';

const CHANNEL_ID = 'ch_3z3kty7szh76jc72nsdzqr8p';

describe('WasenderProvisioning', () => {
  it('defaults to the manage base URL and sends the API key as a bearer token', async () => {
    const mock = createFetchMock({ body: { channels: [] } });
    const manage = new WasenderProvisioning({ apiKey: 'wsm_live_key', fetch: mock.fetch });

    expect(manage.baseUrl).toBe('https://manage.wasender.dev');
    await manage.listChannels();

    const call = mock.calls[0]!;
    expect(call.url).toBe('https://manage.wasender.dev/channels');
    expect(call.headers.authorization).toBe('Bearer wsm_live_key');
  });

  it('creates a channel and returns the one-time token', async () => {
    const mock = createFetchMock({
      status: 201,
      body: { channel: { id: CHANNEL_ID, status: 'pending' }, token: 'wsk_sg_new' },
    });
    const manage = new WasenderProvisioning({ apiKey: 'wsm_live_key', fetch: mock.fetch });

    const created = await manage.createChannel({ name: 'tenant_8421', region: 'sg' });

    expect(created.token).toBe('wsk_sg_new');
    expect(created.channel?.status).toBe('pending');
    expect(mock.calls[0]!.method).toBe('POST');
    expect(mock.calls[0]!.json).toEqual({ name: 'tenant_8421', region: 'sg' });
  });

  it('url-encodes the channel id', async () => {
    const mock = createFetchMock({ body: {} });
    const manage = new WasenderProvisioning({ apiKey: 'wsm_live_key', fetch: mock.fetch });
    await manage.getChannel('ch_a/b c');
    expect(mock.calls[0]!.url).toBe('https://manage.wasender.dev/channels/ch_a%2Fb%20c');
  });

  it('removes a webhook with a null url', async () => {
    const mock = createFetchMock({ body: { webhook: { url: null } } });
    const manage = new WasenderProvisioning({ apiKey: 'wsm_live_key', fetch: mock.fetch });
    await manage.setChannelWebhook(CHANNEL_ID, { url: null });
    expect(mock.calls[0]!.method).toBe('PUT');
    expect(mock.calls[0]!.json).toEqual({ url: null });
  });

  it('reads back the webhook signing secret', async () => {
    const mock = createFetchMock({
      body: { webhook: { url: 'https://example.com/hook', secret: 'whsec_x', active: true, failureCount: 0 } },
    });
    const manage = new WasenderProvisioning({ apiKey: 'wsm_live_key', fetch: mock.fetch });
    const out = await manage.getChannelWebhook(CHANNEL_ID);
    expect(out.webhook?.secret).toBe('whsec_x');
    expect(out.webhook?.active).toBe(true);
  });

  it('surfaces 402 when the workspace has no active subscription', async () => {
    const mock = createFetchMock({ status: 402, body: errorBody(402, 'Plan limit reached') });
    const manage = new WasenderProvisioning({ apiKey: 'wsm_live_key', fetch: mock.fetch });
    await expect(manage.createChannel({ name: 'tenant_1' })).rejects.toBeInstanceOf(WasenderPaymentRequiredError);
  });

  it('accepts a custom base URL and respects transport options', async () => {
    const mock = createFetchMock({ body: {} });
    const manage = new WasenderProvisioning({
      apiKey: 'wsm_live_key',
      baseUrl: 'http://localhost:9999',
      fetch: mock.fetch,
      headers: { 'x-tenant': 'acme' },
    });
    await manage.restartChannel(CHANNEL_ID);
    expect(mock.calls[0]!.url).toBe(`http://localhost:9999/channels/${CHANNEL_ID}/restart`);
    expect(mock.calls[0]!.headers['x-tenant']).toBe('acme');
  });

  it('is also exported as WasenderManageClient', () => {
    const manage = new WasenderManageClient({ apiKey: 'wsm_live_key' });
    expect(manage).toBeInstanceOf(WasenderProvisioning);
    expect(WasenderManageClient).toBe(WasenderProvisioning);
  });
});

describe('credential guards on the provisioning client', () => {
  it('rejects a channel token', () => {
    expect(() => new WasenderProvisioning({ apiKey: 'wsk_sg_abc' })).toThrow(WasenderConfigError);
    expect(() => new WasenderProvisioning({ apiKey: 'wsk_sg_abc' })).toThrow(/channel token/i);
  });

  it('rejects a missing key', () => {
    expect(() => new WasenderProvisioning({ apiKey: '' })).toThrow(/organisation API key/i);
  });
});

describe('connect a number end to end, against a mock', () => {
  it('creates a channel, fetches the QR with the channel token, then polls until connected', async () => {
    const manageMock = createFetchMock((call) => {
      if (call.method === 'POST') {
        return { status: 201, body: { channel: { id: CHANNEL_ID, status: 'pending' }, token: 'wsk_sg_fresh' } };
      }
      return { body: { channel: { id: CHANNEL_ID, status: 'connected', phoneNumber: '61371989950' } } };
    });
    const apiMock = createFetchMock({ bytes: new Uint8Array([0x89, 0x50]), contentType: 'image/png' });

    const manage = new WasenderProvisioning({ apiKey: 'wsm_live_key', fetch: manageMock.fetch });
    const { channel, token } = await manage.createChannel({ name: 'tenant_8421' });

    const wa = new WasenderClient({ token: token!, fetch: apiMock.fetch });
    const qr = await wa.getLoginQr({ size: 300 });
    const polled = await manage.getChannel(channel!.id!);

    expect(qr.contentType).toBe('image/png');
    expect(apiMock.calls[0]!.url).toContain('https://api.wasender.dev/users/login/image');
    expect(apiMock.calls[0]!.headers.authorization).toBe('Bearer wsk_sg_fresh');
    expect(polled.channel?.status).toBe('connected');
    expect(manageMock.count).toBe(2);
  });
});
