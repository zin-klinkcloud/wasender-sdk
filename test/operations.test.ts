/**
 * Coverage test: every operationId in the wasender.dev OpenAPI 3.1 spec is
 * reachable, and lands on the method and path the spec declares.
 *
 * The operationId list is embedded rather than read from the spec file so the
 * suite stays self-contained in CI. It is the full set of 66: 56 messaging
 * operations on api.wasender.dev plus 10 provisioning operations on
 * manage.wasender.dev.
 */

import { describe, expect, it } from 'vitest';
import { WasenderClient } from '../src/client.js';
import { WasenderProvisioning } from '../src/provisioning.js';
import { createFetchMock } from './helpers.js';

const MESSAGE_ID = 'ABGG/FlA+5 Fp';
const MESSAGE_ID_ENC = 'ABGG%2FFlA%2B5%20Fp';
const CHAT_ID = '61371989950@s.whatsapp.net';
const CHAT_ID_ENC = '61371989950%40s.whatsapp.net';
const GROUP_ID = '1234567890@g.us';
const GROUP_ID_ENC = '1234567890%40g.us';
const CONTACT_ID = '61371989950';
const MEDIA_ID = 'media/abc 1';
const MEDIA_ID_ENC = 'media%2Fabc%201';
const INVITE_CODE = 'Abc123XyZ';
const CHANNEL_ID = 'ch_3z3kty7szh76jc72nsdzqr8p';

interface OpCase<T> {
  id: string;
  method: string;
  path: string;
  call: (client: T) => Promise<unknown>;
}

const MESSAGING_OPS: Array<OpCase<WasenderClient>> = [
  // Channel
  { id: 'checkHealth', method: 'GET', path: '/health', call: (wa) => wa.checkHealth() },
  { id: 'getSettings', method: 'GET', path: '/settings', call: (wa) => wa.getSettings() },
  { id: 'updateSettings', method: 'PATCH', path: '/settings', call: (wa) => wa.updateSettings({ full_history: true }) },
  { id: 'getLoginQr', method: 'GET', path: '/users/login/image', call: (wa) => wa.getLoginQr() },
  { id: 'getProfile', method: 'GET', path: '/users/profile', call: (wa) => wa.getProfile() },
  { id: 'updateProfile', method: 'PATCH', path: '/users/profile', call: (wa) => wa.updateProfile({ name: 'Support' }) },
  { id: 'logoutUser', method: 'POST', path: '/users/logout', call: (wa) => wa.logoutUser() },

  // Messages
  { id: 'getMessages', method: 'GET', path: '/messages/list', call: (wa) => wa.getMessages() },
  {
    id: 'getMessagesByChatId',
    method: 'GET',
    path: `/messages/list/${CHAT_ID_ENC}`,
    call: (wa) => wa.getMessagesByChatId(CHAT_ID),
  },
  {
    id: 'sendMessageText',
    method: 'POST',
    path: '/messages/text',
    call: (wa) => wa.sendMessageText({ to: CONTACT_ID, body: 'Hello' }),
  },
  {
    id: 'sendMessageImage',
    method: 'POST',
    path: '/messages/image',
    call: (wa) => wa.sendMessageImage({ to: CONTACT_ID, media: 'https://example.com/a.jpg' }),
  },
  {
    id: 'sendMessageVideo',
    method: 'POST',
    path: '/messages/video',
    call: (wa) => wa.sendMessageVideo({ to: CONTACT_ID, media: 'https://example.com/a.mp4' }),
  },
  {
    id: 'sendMessageAudio',
    method: 'POST',
    path: '/messages/audio',
    call: (wa) => wa.sendMessageAudio({ to: CONTACT_ID, media: 'https://example.com/a.mp3' }),
  },
  {
    id: 'sendMessageVoice',
    method: 'POST',
    path: '/messages/voice',
    call: (wa) => wa.sendMessageVoice({ to: CONTACT_ID, media: 'https://example.com/a.ogg' }),
  },
  {
    id: 'sendMessageDocument',
    method: 'POST',
    path: '/messages/document',
    call: (wa) => wa.sendMessageDocument({ to: CONTACT_ID, media: 'https://example.com/a.pdf', filename: 'a.pdf' }),
  },
  {
    id: 'sendMessageSticker',
    method: 'POST',
    path: '/messages/sticker',
    call: (wa) => wa.sendMessageSticker({ to: CONTACT_ID, media: 'https://example.com/a.webp' }),
  },
  {
    id: 'sendMessageLocation',
    method: 'POST',
    path: '/messages/location',
    call: (wa) => wa.sendMessageLocation({ to: CONTACT_ID, latitude: 1.3521, longitude: 103.8198 }),
  },
  {
    id: 'sendMessageContact',
    method: 'POST',
    path: '/messages/contact',
    call: (wa) => wa.sendMessageContact({ to: CONTACT_ID, name: 'Ada', vcard: 'BEGIN:VCARD\nEND:VCARD' }),
  },
  {
    id: 'sendMessageLinkPreview',
    method: 'POST',
    path: '/messages/link_preview',
    call: (wa) => wa.sendMessageLinkPreview({ to: CONTACT_ID, body: 'https://wasender.dev' }),
  },
  {
    id: 'sendMessagePoll',
    method: 'POST',
    path: '/messages/poll',
    call: (wa) => wa.sendMessagePoll({ to: CONTACT_ID, title: 'Tea or coffee?', options: ['Tea', 'Coffee'] }),
  },
  { id: 'getMessage', method: 'GET', path: `/messages/${MESSAGE_ID_ENC}`, call: (wa) => wa.getMessage(MESSAGE_ID) },
  {
    id: 'markMessageAsRead',
    method: 'POST',
    path: `/messages/${MESSAGE_ID_ENC}`,
    call: (wa) => wa.markMessageAsRead(MESSAGE_ID),
  },
  {
    id: 'editMessage',
    method: 'PUT',
    path: `/messages/${MESSAGE_ID_ENC}`,
    call: (wa) => wa.editMessage(MESSAGE_ID, { body: 'Fixed' }),
  },
  {
    id: 'deleteMessage',
    method: 'DELETE',
    path: `/messages/${MESSAGE_ID_ENC}`,
    call: (wa) => wa.deleteMessage(MESSAGE_ID),
  },
  {
    id: 'reactToMessage',
    method: 'PUT',
    path: `/messages/${MESSAGE_ID_ENC}/reaction`,
    call: (wa) => wa.reactToMessage(MESSAGE_ID, { emoji: '👍' }),
  },
  {
    id: 'removeReaction',
    method: 'DELETE',
    path: `/messages/${MESSAGE_ID_ENC}/reaction`,
    call: (wa) => wa.removeReaction(MESSAGE_ID),
  },
  {
    id: 'starMessage',
    method: 'PUT',
    path: `/messages/${MESSAGE_ID_ENC}/star`,
    call: (wa) => wa.starMessage(MESSAGE_ID, { star: true }),
  },
  {
    id: 'getMessageStatuses',
    method: 'GET',
    path: `/statuses/${MESSAGE_ID_ENC}`,
    call: (wa) => wa.getMessageStatuses(MESSAGE_ID),
  },

  // Chats
  { id: 'getChats', method: 'GET', path: '/chats', call: (wa) => wa.getChats() },
  { id: 'getChat', method: 'GET', path: `/chats/${CHAT_ID_ENC}`, call: (wa) => wa.getChat(CHAT_ID) },
  { id: 'markChatAsRead', method: 'POST', path: `/chats/${CHAT_ID_ENC}`, call: (wa) => wa.markChatAsRead(CHAT_ID) },
  {
    id: 'updateChat',
    method: 'PATCH',
    path: `/chats/${CHAT_ID_ENC}`,
    call: (wa) => wa.updateChat(CHAT_ID, { archive: true }),
  },
  { id: 'deleteChat', method: 'DELETE', path: `/chats/${CHAT_ID_ENC}`, call: (wa) => wa.deleteChat(CHAT_ID) },

  // Contacts
  { id: 'getContacts', method: 'GET', path: '/contacts', call: (wa) => wa.getContacts() },
  {
    id: 'checkPhones',
    method: 'POST',
    path: '/contacts',
    call: (wa) => wa.checkPhones({ contacts: [CONTACT_ID] }),
  },
  { id: 'getContact', method: 'GET', path: `/contacts/${CONTACT_ID}`, call: (wa) => wa.getContact(CONTACT_ID) },
  {
    id: 'getContactProfile',
    method: 'GET',
    path: `/contacts/${CONTACT_ID}/profile`,
    call: (wa) => wa.getContactProfile(CONTACT_ID),
  },

  // Groups
  { id: 'getGroups', method: 'GET', path: '/groups', call: (wa) => wa.getGroups() },
  {
    id: 'createGroup',
    method: 'POST',
    path: '/groups',
    call: (wa) => wa.createGroup({ subject: 'Standup', participants: [CONTACT_ID] }),
  },
  { id: 'getGroup', method: 'GET', path: `/groups/${GROUP_ID_ENC}`, call: (wa) => wa.getGroup(GROUP_ID) },
  {
    id: 'updateGroup',
    method: 'PATCH',
    path: `/groups/${GROUP_ID_ENC}`,
    call: (wa) => wa.updateGroup(GROUP_ID, { subject: 'Standup 2' }),
  },
  { id: 'leaveGroup', method: 'DELETE', path: `/groups/${GROUP_ID_ENC}`, call: (wa) => wa.leaveGroup(GROUP_ID) },
  {
    id: 'addGroupParticipant',
    method: 'POST',
    path: `/groups/${GROUP_ID_ENC}/participants`,
    call: (wa) => wa.addGroupParticipant(GROUP_ID, { participants: [CONTACT_ID] }),
  },
  {
    id: 'removeGroupParticipant',
    method: 'DELETE',
    path: `/groups/${GROUP_ID_ENC}/participants`,
    call: (wa) => wa.removeGroupParticipant(GROUP_ID, { participants: [CONTACT_ID] }),
  },
  {
    id: 'promoteGroupAdmins',
    method: 'PATCH',
    path: `/groups/${GROUP_ID_ENC}/admins`,
    call: (wa) => wa.promoteGroupAdmins(GROUP_ID, { participants: [CONTACT_ID] }),
  },
  {
    id: 'demoteGroupAdmins',
    method: 'DELETE',
    path: `/groups/${GROUP_ID_ENC}/admins`,
    call: (wa) => wa.demoteGroupAdmins(GROUP_ID, { participants: [CONTACT_ID] }),
  },
  {
    id: 'joinGroupByCode',
    method: 'POST',
    path: `/groups/link/${INVITE_CODE}`,
    call: (wa) => wa.joinGroupByCode(INVITE_CODE),
  },
  {
    id: 'getGroupInvite',
    method: 'GET',
    path: `/groups/${GROUP_ID_ENC}/invite`,
    call: (wa) => wa.getGroupInvite(GROUP_ID),
  },
  {
    id: 'revokeGroupInvite',
    method: 'DELETE',
    path: `/groups/${GROUP_ID_ENC}/invite`,
    call: (wa) => wa.revokeGroupInvite(GROUP_ID),
  },

  // Media
  { id: 'getMediaFiles', method: 'GET', path: '/media', call: (wa) => wa.getMediaFiles() },
  {
    id: 'uploadMedia',
    method: 'POST',
    path: '/media',
    call: (wa) => wa.uploadMedia({ media: new Uint8Array([1, 2, 3]), filename: 'a.bin' }),
  },
  { id: 'getMedia', method: 'GET', path: `/media/${MEDIA_ID_ENC}`, call: (wa) => wa.getMedia(MEDIA_ID) },
  { id: 'deleteMedia', method: 'DELETE', path: `/media/${MEDIA_ID_ENC}`, call: (wa) => wa.deleteMedia(MEDIA_ID) },

  // Presences
  {
    id: 'setMyPresence',
    method: 'PUT',
    path: '/presences/me',
    call: (wa) => wa.setMyPresence({ presence: 'online' }),
  },
  {
    id: 'subscribeToPresence',
    method: 'POST',
    path: `/presences/${CHAT_ID_ENC}`,
    call: (wa) => wa.subscribeToPresence(CHAT_ID),
  },
  {
    id: 'sendPresence',
    method: 'PUT',
    path: `/presences/${CHAT_ID_ENC}`,
    call: (wa) => wa.sendPresence(CHAT_ID, { presence: 'typing', delay: 3 }),
  },
];

const PROVISIONING_OPS: Array<OpCase<WasenderProvisioning>> = [
  { id: 'listChannels', method: 'GET', path: '/channels', call: (m) => m.listChannels() },
  { id: 'createChannel', method: 'POST', path: '/channels', call: (m) => m.createChannel({ name: 'tenant_1' }) },
  { id: 'getChannel', method: 'GET', path: `/channels/${CHANNEL_ID}`, call: (m) => m.getChannel(CHANNEL_ID) },
  {
    id: 'renameChannel',
    method: 'PATCH',
    path: `/channels/${CHANNEL_ID}`,
    call: (m) => m.renameChannel(CHANNEL_ID, { name: 'tenant_2' }),
  },
  {
    id: 'deleteChannel',
    method: 'DELETE',
    path: `/channels/${CHANNEL_ID}`,
    call: (m) => m.deleteChannel(CHANNEL_ID),
  },
  {
    id: 'restartChannel',
    method: 'POST',
    path: `/channels/${CHANNEL_ID}/restart`,
    call: (m) => m.restartChannel(CHANNEL_ID),
  },
  {
    id: 'disconnectChannel',
    method: 'POST',
    path: `/channels/${CHANNEL_ID}/disconnect`,
    call: (m) => m.disconnectChannel(CHANNEL_ID),
  },
  {
    id: 'rotateChannelToken',
    method: 'POST',
    path: `/channels/${CHANNEL_ID}/rotate-token`,
    call: (m) => m.rotateChannelToken(CHANNEL_ID),
  },
  {
    id: 'getChannelWebhook',
    method: 'GET',
    path: `/channels/${CHANNEL_ID}/webhook`,
    call: (m) => m.getChannelWebhook(CHANNEL_ID),
  },
  {
    id: 'setChannelWebhook',
    method: 'PUT',
    path: `/channels/${CHANNEL_ID}/webhook`,
    call: (m) => m.setChannelWebhook(CHANNEL_ID, { url: 'https://example.com/hook' }),
  },
];

describe('OpenAPI operation coverage', () => {
  it('covers all 56 messaging operations and all 10 provisioning operations', () => {
    expect(MESSAGING_OPS).toHaveLength(56);
    expect(PROVISIONING_OPS).toHaveLength(10);
    expect(new Set(MESSAGING_OPS.map((o) => o.id)).size).toBe(56);
    expect(new Set(PROVISIONING_OPS.map((o) => o.id)).size).toBe(10);
  });

  it('exposes every messaging operationId as a method', () => {
    const wa = new WasenderClient({ token: 'wsk_sg_test' }) as unknown as Record<string, unknown>;
    const missing = MESSAGING_OPS.filter((op) => typeof wa[op.id] !== 'function').map((op) => op.id);
    expect(missing).toEqual([]);
  });

  it('exposes every provisioning operationId as a method', () => {
    const manage = new WasenderProvisioning({ apiKey: 'wsm_test' }) as unknown as Record<string, unknown>;
    const missing = PROVISIONING_OPS.filter((op) => typeof manage[op.id] !== 'function').map((op) => op.id);
    expect(missing).toEqual([]);
  });

  describe.each(MESSAGING_OPS)('messaging $id', (op) => {
    it(`calls ${op.method} ${op.path}`, async () => {
      const mock = createFetchMock({ body: { ok: true } });
      const wa = new WasenderClient({ token: 'wsk_sg_test', fetch: mock.fetch });
      await op.call(wa);
      expect(mock.count).toBe(1);
      const call = mock.calls[0]!;
      expect(call.method).toBe(op.method);
      // Compare the encoded path, so path parameter encoding is asserted too.
      expect(new URL(call.url).pathname).toBe(op.path);
      expect(call.url.startsWith('https://api.wasender.dev')).toBe(true);
      expect(call.headers.authorization).toBe('Bearer wsk_sg_test');
    });
  });

  describe.each(PROVISIONING_OPS)('provisioning $id', (op) => {
    it(`calls ${op.method} ${op.path}`, async () => {
      const mock = createFetchMock({ body: { ok: true } });
      const manage = new WasenderProvisioning({ apiKey: 'wsm_test', fetch: mock.fetch });
      await op.call(manage);
      expect(mock.count).toBe(1);
      const call = mock.calls[0]!;
      expect(call.method).toBe(op.method);
      expect(new URL(call.url).pathname).toBe(op.path);
      expect(call.url.startsWith('https://manage.wasender.dev')).toBe(true);
      expect(call.headers.authorization).toBe('Bearer wsm_test');
    });
  });

  it('keeps the documented convenience aliases', () => {
    const wa = new WasenderClient({ token: 'wsk_sg_test' }) as unknown as Record<string, unknown>;
    const aliases = [
      'sendText',
      'sendImage',
      'sendVideo',
      'sendAudio',
      'sendVoice',
      'sendDocument',
      'sendSticker',
      'sendLocation',
      'sendContact',
      'sendLinkPreview',
      'sendPoll',
      'health',
      'listMessages',
      'listChats',
      'listContacts',
      'listGroups',
      'listMedia',
      'markAsRead',
      'react',
      'unreact',
      'getStatuses',
      'sendTyping',
      'logout',
    ];
    const missing = aliases.filter((name) => typeof wa[name] !== 'function');
    expect(missing).toEqual([]);
  });
});
