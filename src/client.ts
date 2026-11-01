/**
 * `WasenderClient`: the messaging API at https://api.wasender.dev.
 *
 * Every method is named after its OpenAPI `operationId`, so the spec and the
 * SDK stay searchable against each other. Short aliases (`sendText`,
 * `health`, ...) are defined at the end of the class for the common calls.
 */

import { WasenderConfigError } from './errors.js';
import {
  ClientCore,
  encodePathSegment as enc,
  isBinaryLike,
  toBlob,
  type BinaryResult,
  type ClientCoreOptions,
  type CoreRequest,
  type FetchLike,
  type QueryParams,
  type RequestOptions,
  type RetryOptions,
} from './http.js';
import type {
  AddGroupParticipantResponse,
  ChatsResponse,
  Chat,
  CheckHealthParams,
  CheckPhonesBody,
  CheckPhonesResponse,
  Contact,
  ContactsResponse,
  CreateGroupBody,
  EditMessageBody,
  GetLoginQrParams,
  GetMessagesByChatIdParams,
  GetMessagesParams,
  Group,
  GroupInviteResponse,
  GroupParticipantsBody,
  GroupsResponse,
  Health,
  MediaFile,
  MediaFilesResponse,
  Message,
  MessageStatusesResponse,
  MessagesList,
  PagingParams,
  Profile,
  ReactToMessageBody,
  SendContactBody,
  SendDocumentBody,
  SendLinkPreviewBody,
  SendLocationBody,
  SendMediaBody,
  SendPollBody,
  SendPresenceBody,
  SendTextBody,
  SentMessage,
  SetMyPresenceBody,
  Settings,
  StarMessageBody,
  SuccessResponse,
  UpdateChatBody,
  UpdateGroupBody,
  UpdateProfileBody,
} from './types.js';

export const DEFAULT_MESSAGING_BASE_URL = 'https://api.wasender.dev';

export interface WasenderClientOptions {
  /**
   * A channel token (`wsk_...`), one per connected WhatsApp number. Sent as
   * `Authorization: Bearer`. Treat it as a password: it grants full control of
   * that number.
   */
  token: string;
  /** Defaults to https://api.wasender.dev. */
  baseUrl?: string;
  /** Supply your own fetch, for example to add tracing or a proxy agent. */
  fetch?: FetchLike;
  /** Abort a request after this many milliseconds. Off by default. */
  timeoutMs?: number;
  /** Retry policy, or a number meaning "this many retries". Off by default. */
  retry?: RetryOptions | number;
  /** Shorthand for `retry: { retries: n }`. */
  maxRetries?: number;
  /** Extra headers on every request. */
  headers?: Record<string, string>;
  /** Replaceable sleep, so tests do not have to wait out a backoff. */
  sleep?: (ms: number) => Promise<void>;
  /** Sent as `User-Agent` where the runtime allows setting it. */
  userAgent?: string;
}

/** Uploadable media, or a reference to media the service can fetch. */
type MediaField = SendMediaBody['media'];

function assertChannelToken(token: unknown): string {
  if (typeof token !== 'string' || token.trim() === '') {
    throw new WasenderConfigError({
      status: 0,
      code: 'missing_token',
      message: 'WasenderClient needs a channel token: new WasenderClient({ token: process.env.WASENDER_TOKEN }).',
    });
  }
  const value = token.trim();
  if (value.startsWith('wsm_')) {
    throw new WasenderConfigError({
      status: 0,
      code: 'wrong_credential',
      message:
        'That is an organisation API key (wsm_), which only works on the provisioning API. Pass a channel token (wsk_) to WasenderClient, or use WasenderProvisioning for https://manage.wasender.dev.',
      href: 'https://docs.wasender.dev',
    });
  }
  return value;
}

/**
 * The messaging client: send and read on one connected WhatsApp number.
 *
 * ```ts
 * import { WasenderClient } from '@wasender/sdk';
 *
 * const wa = new WasenderClient({ token: process.env.WASENDER_TOKEN });
 * await wa.sendText({ to: '61371989950', body: 'Hello' });
 * ```
 *
 * A 2xx means WhatsApp accepted the message, not that it was delivered.
 */
export class WasenderClient {
  private readonly core: ClientCore;

  constructor(options: WasenderClientOptions) {
    const token = assertChannelToken(options?.token);
    this.core = new ClientCore({
      baseUrl: options.baseUrl ?? DEFAULT_MESSAGING_BASE_URL,
      credential: token,
      ...passThrough(options),
    });
  }

  /** The base URL this client talks to. */
  get baseUrl(): string {
    return this.core.baseUrl;
  }

  /**
   * Escape hatch for an endpoint the SDK does not wrap yet.
   *
   * ```ts
   * await wa.request({ method: 'GET', path: '/chats', query: { count: 10 } });
   * ```
   */
  request<T = unknown>(req: CoreRequest): Promise<T> {
    return this.core.request<T>(req);
  }

  /* ---------------------------------------------------------------------- */
  /* Channel                                                                */
  /* ---------------------------------------------------------------------- */

  /**
   * Reports whether the number is connected and ready to send. Safe to poll.
   *
   * A `hibernated` channel is healthy: it has been parked to save resources and
   * wakes on the next request that needs the socket.
   */
  checkHealth(params: CheckHealthParams = {}, opts?: RequestOptions): Promise<Health> {
    return this.core.request({ method: 'GET', path: '/health', query: params as QueryParams, ...opts });
  }

  /** Reads the channel's settings, including its webhook registrations. */
  getSettings(opts?: RequestOptions): Promise<Settings> {
    return this.core.request({ method: 'GET', path: '/settings', ...opts });
  }

  /**
   * Sets the webhook the channel delivers events to, plus the automatic
   * behaviours applied to incoming messages.
   */
  updateSettings(body: Settings, opts?: RequestOptions): Promise<Settings> {
    return this.core.request({ method: 'PATCH', path: '/settings', body, ...opts });
  }

  /**
   * Fetches the QR code to link this number, as a PNG.
   *
   * The spec declares `image/png` as the only response content type, so the
   * result is always binary. Use `.dataUrl()` to drop it into an `<img>`, or
   * `.bytes` to write it to disk.
   *
   * QR codes rotate roughly every 20 seconds, so re-request when one expires.
   * Returns 409 once the channel is connected, since there is nothing to scan.
   */
  getLoginQr(params: GetLoginQrParams = {}, opts?: RequestOptions): Promise<BinaryResult> {
    return this.core.request({
      method: 'GET',
      path: '/users/login/image',
      query: params as QueryParams,
      accept: 'binary',
      ...opts,
    });
  }

  /** Reads this number's own WhatsApp profile. */
  getProfile(opts?: RequestOptions): Promise<Profile> {
    return this.core.request({ method: 'GET', path: '/users/profile', ...opts });
  }

  /** Updates this number's own display name, about line or picture. */
  updateProfile(body: UpdateProfileBody, opts?: RequestOptions): Promise<Profile> {
    return this.core.request({ method: 'PATCH', path: '/users/profile', body, ...opts });
  }

  /**
   * Logs the device out of WhatsApp and discards the stored credentials. The
   * channel is kept, so reconnecting means scanning a fresh QR code.
   *
   * This does not cancel billing: delete the channel to stop being charged.
   */
  logoutUser(opts?: RequestOptions): Promise<SuccessResponse> {
    return this.core.request({ method: 'POST', path: '/users/logout', ...opts });
  }

  /* ---------------------------------------------------------------------- */
  /* Messages: reading                                                      */
  /* ---------------------------------------------------------------------- */

  /**
   * Lists messages, across all chats or within one via `chat_id`.
   *
   * Served from stored history, which starts when the number is connected:
   * messages sent before that were never seen and cannot be backfilled.
   */
  getMessages(params: GetMessagesParams = {}, opts?: RequestOptions): Promise<MessagesList> {
    return this.core.request({ method: 'GET', path: '/messages/list', query: params as QueryParams, ...opts });
  }

  /** Lists messages in one chat. */
  getMessagesByChatId(
    chatId: string,
    params: GetMessagesByChatIdParams = {},
    opts?: RequestOptions,
  ): Promise<MessagesList> {
    return this.core.request({
      method: 'GET',
      path: `/messages/list/${enc(chatId)}`,
      query: params as QueryParams,
      ...opts,
    });
  }

  /** Reads one message by id. */
  getMessage(messageId: string, opts?: RequestOptions): Promise<Message> {
    return this.core.request({ method: 'GET', path: `/messages/${enc(messageId)}`, ...opts });
  }

  /** Delivery and read receipts for one message, per recipient. */
  getMessageStatuses(messageId: string, opts?: RequestOptions): Promise<MessageStatusesResponse> {
    return this.core.request({ method: 'GET', path: `/statuses/${enc(messageId)}`, ...opts });
  }

  /* ---------------------------------------------------------------------- */
  /* Messages: sending                                                      */
  /* ---------------------------------------------------------------------- */

  /**
   * Sends a text message.
   *
   * `to` takes a phone number in international format without `+`
   * (`61371989950`) or a full chat id (`...@s.whatsapp.net`, `...@g.us`).
   *
   * A first-ever message to someone who has never messaged you is the single
   * most reliable way to get a number restricted. Send to people who expect it.
   */
  sendMessageText(body: SendTextBody, opts?: RequestOptions): Promise<SentMessage> {
    return this.core.request({ method: 'POST', path: '/messages/text', body, ...opts });
  }

  /**
   * Sends an image.
   *
   * `media` takes a URL, a base64 data URI, a previously uploaded media id, or
   * binary content, which switches the request to multipart/form-data.
   */
  sendMessageImage(body: SendMediaBody, opts?: RequestOptions): Promise<SentMessage> {
    return this.sendMedia('/messages/image', body, opts);
  }

  /** Sends a video. */
  sendMessageVideo(body: SendMediaBody, opts?: RequestOptions): Promise<SentMessage> {
    return this.sendMedia('/messages/video', body, opts);
  }

  /** Sends an audio file, shown as an attachment. */
  sendMessageAudio(body: SendMediaBody, opts?: RequestOptions): Promise<SentMessage> {
    return this.sendMedia('/messages/audio', body, opts);
  }

  /**
   * Sends a voice note, shown as push-to-play rather than an attachment.
   *
   * WhatsApp expects Opus in an Ogg container. Other formats are transcoded,
   * which adds latency.
   */
  sendMessageVoice(body: SendMediaBody, opts?: RequestOptions): Promise<SentMessage> {
    return this.sendMedia('/messages/voice', body, opts);
  }

  /** Sends a document. `filename` sets the name shown to the recipient. */
  sendMessageDocument(body: SendDocumentBody, opts?: RequestOptions): Promise<SentMessage> {
    return this.sendMedia('/messages/document', body, opts);
  }

  /** Sends a sticker. */
  sendMessageSticker(body: SendMediaBody, opts?: RequestOptions): Promise<SentMessage> {
    return this.sendMedia('/messages/sticker', body, opts);
  }

  /** Sends a location pin. */
  sendMessageLocation(body: SendLocationBody, opts?: RequestOptions): Promise<SentMessage> {
    return this.core.request({ method: 'POST', path: '/messages/location', body, ...opts });
  }

  /** Sends a contact card. `vcard` is a vCard 3.0 payload. */
  sendMessageContact(body: SendContactBody, opts?: RequestOptions): Promise<SentMessage> {
    return this.core.request({ method: 'POST', path: '/messages/contact', body, ...opts });
  }

  /** Sends a link with a rich preview card. */
  sendMessageLinkPreview(body: SendLinkPreviewBody, opts?: RequestOptions): Promise<SentMessage> {
    return this.core.request({ method: 'POST', path: '/messages/link_preview', body, ...opts });
  }

  /** Sends a poll (2 to 12 options). */
  sendMessagePoll(body: SendPollBody, opts?: RequestOptions): Promise<SentMessage> {
    return this.core.request({ method: 'POST', path: '/messages/poll', body, ...opts });
  }

  /* ---------------------------------------------------------------------- */
  /* Messages: acting on one                                                */
  /* ---------------------------------------------------------------------- */

  /** Marks one message as read. */
  markMessageAsRead(messageId: string, opts?: RequestOptions): Promise<SuccessResponse> {
    return this.core.request({ method: 'POST', path: `/messages/${enc(messageId)}`, ...opts });
  }

  /**
   * Edits a message.
   *
   * WhatsApp only allows editing your own messages, within 15 minutes.
   */
  editMessage(messageId: string, body: EditMessageBody, opts?: RequestOptions): Promise<SentMessage> {
    return this.core.request({ method: 'PUT', path: `/messages/${enc(messageId)}`, body, ...opts });
  }

  /** Deletes a message. */
  deleteMessage(messageId: string, opts?: RequestOptions): Promise<SuccessResponse> {
    return this.core.request({ method: 'DELETE', path: `/messages/${enc(messageId)}`, ...opts });
  }

  /** Reacts to a message. Send an empty emoji string to remove the reaction. */
  reactToMessage(messageId: string, body: ReactToMessageBody, opts?: RequestOptions): Promise<SuccessResponse> {
    return this.core.request({ method: 'PUT', path: `/messages/${enc(messageId)}/reaction`, body, ...opts });
  }

  /** Removes your reaction from a message. */
  removeReaction(messageId: string, opts?: RequestOptions): Promise<SuccessResponse> {
    return this.core.request({ method: 'DELETE', path: `/messages/${enc(messageId)}/reaction`, ...opts });
  }

  /**
   * Stars or unstars a message.
   *
   * Not supported by the service: this always returns 501, which the SDK raises
   * as a `WasenderNotImplementedError`. The underlying engine exposes no way to
   * star a message, and accepting the call would drop the flag silently. The
   * method exists so the operation is reachable and the failure is explicit.
   */
  starMessage(messageId: string, body: StarMessageBody, opts?: RequestOptions): Promise<never> {
    return this.core.request({ method: 'PUT', path: `/messages/${enc(messageId)}/star`, body, ...opts });
  }

  /* ---------------------------------------------------------------------- */
  /* Chats                                                                  */
  /* ---------------------------------------------------------------------- */

  /** Lists chats, one-to-one and group. */
  getChats(params: PagingParams = {}, opts?: RequestOptions): Promise<ChatsResponse> {
    return this.core.request({ method: 'GET', path: '/chats', query: params as QueryParams, ...opts });
  }

  /** Reads one chat. */
  getChat(chatId: string, opts?: RequestOptions): Promise<Chat> {
    return this.core.request({ method: 'GET', path: `/chats/${enc(chatId)}`, ...opts });
  }

  /** Marks a whole chat as read. */
  markChatAsRead(chatId: string, opts?: RequestOptions): Promise<SuccessResponse> {
    return this.core.request({ method: 'POST', path: `/chats/${enc(chatId)}`, ...opts });
  }

  /** Archives, pins, mutes or marks a chat read. */
  updateChat(chatId: string, body: UpdateChatBody, opts?: RequestOptions): Promise<SuccessResponse> {
    return this.core.request({ method: 'PATCH', path: `/chats/${enc(chatId)}`, body, ...opts });
  }

  /** Deletes a chat. */
  deleteChat(chatId: string, opts?: RequestOptions): Promise<SuccessResponse> {
    return this.core.request({ method: 'DELETE', path: `/chats/${enc(chatId)}`, ...opts });
  }

  /* ---------------------------------------------------------------------- */
  /* Contacts                                                               */
  /* ---------------------------------------------------------------------- */

  /** Lists the address book this number can see. */
  getContacts(params: PagingParams = {}, opts?: RequestOptions): Promise<ContactsResponse> {
    return this.core.request({ method: 'GET', path: '/contacts', query: params as QueryParams, ...opts });
  }

  /**
   * Checks whether numbers are on WhatsApp, up to 500 per call.
   *
   * Cheap insurance: sending to numbers that are not on WhatsApp is a strong
   * spam signal and a common cause of restriction. Keep batches modest.
   */
  checkPhones(body: CheckPhonesBody, opts?: RequestOptions): Promise<CheckPhonesResponse> {
    return this.core.request({ method: 'POST', path: '/contacts', body, ...opts });
  }

  /** Reads one contact. */
  getContact(contactId: string, opts?: RequestOptions): Promise<Contact> {
    return this.core.request({ method: 'GET', path: `/contacts/${enc(contactId)}`, ...opts });
  }

  /** Reads a contact's public WhatsApp profile. */
  getContactProfile(contactId: string, opts?: RequestOptions): Promise<Profile> {
    return this.core.request({ method: 'GET', path: `/contacts/${enc(contactId)}/profile`, ...opts });
  }

  /* ---------------------------------------------------------------------- */
  /* Groups                                                                 */
  /* ---------------------------------------------------------------------- */

  /** Lists groups this number belongs to. */
  getGroups(params: PagingParams = {}, opts?: RequestOptions): Promise<GroupsResponse> {
    return this.core.request({ method: 'GET', path: '/groups', query: params as QueryParams, ...opts });
  }

  /** Creates a group with an initial participant list. */
  createGroup(body: CreateGroupBody, opts?: RequestOptions): Promise<Group> {
    return this.core.request({ method: 'POST', path: '/groups', body, ...opts });
  }

  /** Reads one group, including its participants and their ranks. */
  getGroup(groupId: string, opts?: RequestOptions): Promise<Group> {
    return this.core.request({ method: 'GET', path: `/groups/${enc(groupId)}`, ...opts });
  }

  /** Updates a group's subject or description. Needs admin rights. */
  updateGroup(groupId: string, body: UpdateGroupBody, opts?: RequestOptions): Promise<SuccessResponse> {
    return this.core.request({ method: 'PATCH', path: `/groups/${enc(groupId)}`, body, ...opts });
  }

  /** Leaves a group. */
  leaveGroup(groupId: string, opts?: RequestOptions): Promise<SuccessResponse> {
    return this.core.request({ method: 'DELETE', path: `/groups/${enc(groupId)}`, ...opts });
  }

  /**
   * Adds participants.
   *
   * WhatsApp privacy settings let people refuse group adds. Participants who
   * cannot be added directly come back with an invite link to send instead.
   */
  addGroupParticipant(
    groupId: string,
    body: GroupParticipantsBody,
    opts?: RequestOptions,
  ): Promise<AddGroupParticipantResponse> {
    return this.core.request({ method: 'POST', path: `/groups/${enc(groupId)}/participants`, body, ...opts });
  }

  /** Removes participants. Needs admin rights. */
  removeGroupParticipant(
    groupId: string,
    body: GroupParticipantsBody,
    opts?: RequestOptions,
  ): Promise<SuccessResponse> {
    return this.core.request({ method: 'DELETE', path: `/groups/${enc(groupId)}/participants`, body, ...opts });
  }

  /** Promotes participants to admin. */
  promoteGroupAdmins(groupId: string, body: GroupParticipantsBody, opts?: RequestOptions): Promise<SuccessResponse> {
    return this.core.request({ method: 'PATCH', path: `/groups/${enc(groupId)}/admins`, body, ...opts });
  }

  /** Demotes admins back to member. */
  demoteGroupAdmins(groupId: string, body: GroupParticipantsBody, opts?: RequestOptions): Promise<SuccessResponse> {
    return this.core.request({ method: 'DELETE', path: `/groups/${enc(groupId)}/admins`, body, ...opts });
  }

  /**
   * Joins a group with an invite code: the part of an invite link after
   * `chat.whatsapp.com/`.
   */
  joinGroupByCode(inviteCode: string, opts?: RequestOptions): Promise<SuccessResponse> {
    return this.core.request({ method: 'POST', path: `/groups/link/${enc(inviteCode)}`, ...opts });
  }

  /** Reads a group's invite link. Needs admin rights. */
  getGroupInvite(groupId: string, opts?: RequestOptions): Promise<GroupInviteResponse> {
    return this.core.request({ method: 'GET', path: `/groups/${enc(groupId)}/invite`, ...opts });
  }

  /** Revokes the invite link and returns the replacement. */
  revokeGroupInvite(groupId: string, opts?: RequestOptions): Promise<GroupInviteResponse> {
    return this.core.request({ method: 'DELETE', path: `/groups/${enc(groupId)}/invite`, ...opts });
  }

  /* ---------------------------------------------------------------------- */
  /* Media                                                                  */
  /* ---------------------------------------------------------------------- */

  /** Lists files uploaded to this channel. Uploads have an `expires_at`. */
  getMediaFiles(params: PagingParams = {}, opts?: RequestOptions): Promise<MediaFilesResponse> {
    return this.core.request({ method: 'GET', path: '/media', query: params as QueryParams, ...opts });
  }

  /**
   * Uploads a file and returns its `id`.
   *
   * The spec declares multipart/form-data as the only content type for this
   * endpoint, so the SDK always sends multipart. Reusing the returned id across
   * many sends is much cheaper than re-uploading per recipient.
   *
   * ```ts
   * const file = await wa.uploadMedia({ media: bytes, filename: 'menu.pdf', contentType: 'application/pdf' });
   * await wa.sendDocument({ to: '61371989950', media: file.id!, filename: 'menu.pdf' });
   * ```
   */
  uploadMedia(
    input: { media: Blob | ArrayBuffer | ArrayBufferView; filename?: string; contentType?: string } | FormData,
    opts?: RequestOptions,
  ): Promise<MediaFile> {
    const form = input instanceof FormData ? input : buildMediaForm(input);
    return this.core.request({ method: 'POST', path: '/media', form, ...opts });
  }

  /**
   * Downloads a media file.
   *
   * The spec declares `application/octet-stream`, so the result is binary.
   */
  getMedia(mediaId: string, opts?: RequestOptions): Promise<BinaryResult> {
    return this.core.request({ method: 'GET', path: `/media/${enc(mediaId)}`, accept: 'binary', ...opts });
  }

  /** Deletes an uploaded media file. */
  deleteMedia(mediaId: string, opts?: RequestOptions): Promise<SuccessResponse> {
    return this.core.request({ method: 'DELETE', path: `/media/${enc(mediaId)}`, ...opts });
  }

  /* ---------------------------------------------------------------------- */
  /* Presences                                                              */
  /* ---------------------------------------------------------------------- */

  /** Sets this number's own online presence. */
  setMyPresence(body: SetMyPresenceBody, opts?: RequestOptions): Promise<SuccessResponse> {
    return this.core.request({ method: 'PUT', path: '/presences/me', body, ...opts });
  }

  /**
   * Subscribes to a contact's presence.
   *
   * Not supported by the service: this always returns 501, which the SDK raises
   * as a `WasenderNotImplementedError`. Presence updates arrive through
   * webhooks rather than per-contact subscriptions, so there is nothing to
   * subscribe to. The method exists so the operation is reachable.
   */
  subscribeToPresence(entryId: string, opts?: RequestOptions): Promise<never> {
    return this.core.request({ method: 'POST', path: `/presences/${enc(entryId)}`, ...opts });
  }

  /** Shows a typing, recording or paused indicator in a chat. */
  sendPresence(entryId: string, body: SendPresenceBody, opts?: RequestOptions): Promise<SuccessResponse> {
    return this.core.request({ method: 'PUT', path: `/presences/${enc(entryId)}`, body, ...opts });
  }

  /* ---------------------------------------------------------------------- */
  /* Short aliases                                                          */
  /* ---------------------------------------------------------------------- */

  /** Alias for `checkHealth()`. */
  health(params: CheckHealthParams = {}, opts?: RequestOptions): Promise<Health> {
    return this.checkHealth(params, opts);
  }

  /** Alias for `sendMessageText()`. */
  sendText(body: SendTextBody, opts?: RequestOptions): Promise<SentMessage> {
    return this.sendMessageText(body, opts);
  }

  /** Alias for `sendMessageImage()`. */
  sendImage(body: SendMediaBody, opts?: RequestOptions): Promise<SentMessage> {
    return this.sendMessageImage(body, opts);
  }

  /** Alias for `sendMessageVideo()`. */
  sendVideo(body: SendMediaBody, opts?: RequestOptions): Promise<SentMessage> {
    return this.sendMessageVideo(body, opts);
  }

  /** Alias for `sendMessageAudio()`. */
  sendAudio(body: SendMediaBody, opts?: RequestOptions): Promise<SentMessage> {
    return this.sendMessageAudio(body, opts);
  }

  /** Alias for `sendMessageVoice()`. */
  sendVoice(body: SendMediaBody, opts?: RequestOptions): Promise<SentMessage> {
    return this.sendMessageVoice(body, opts);
  }

  /** Alias for `sendMessageDocument()`. */
  sendDocument(body: SendDocumentBody, opts?: RequestOptions): Promise<SentMessage> {
    return this.sendMessageDocument(body, opts);
  }

  /** Alias for `sendMessageSticker()`. */
  sendSticker(body: SendMediaBody, opts?: RequestOptions): Promise<SentMessage> {
    return this.sendMessageSticker(body, opts);
  }

  /** Alias for `sendMessageLocation()`. */
  sendLocation(body: SendLocationBody, opts?: RequestOptions): Promise<SentMessage> {
    return this.sendMessageLocation(body, opts);
  }

  /** Alias for `sendMessageContact()`. */
  sendContact(body: SendContactBody, opts?: RequestOptions): Promise<SentMessage> {
    return this.sendMessageContact(body, opts);
  }

  /** Alias for `sendMessageLinkPreview()`. */
  sendLinkPreview(body: SendLinkPreviewBody, opts?: RequestOptions): Promise<SentMessage> {
    return this.sendMessageLinkPreview(body, opts);
  }

  /** Alias for `sendMessagePoll()`. */
  sendPoll(body: SendPollBody, opts?: RequestOptions): Promise<SentMessage> {
    return this.sendMessagePoll(body, opts);
  }

  /** Alias for `getMessages()`. */
  listMessages(params: GetMessagesParams = {}, opts?: RequestOptions): Promise<MessagesList> {
    return this.getMessages(params, opts);
  }

  /** Alias for `getChats()`. */
  listChats(params: PagingParams = {}, opts?: RequestOptions): Promise<ChatsResponse> {
    return this.getChats(params, opts);
  }

  /** Alias for `getContacts()`. */
  listContacts(params: PagingParams = {}, opts?: RequestOptions): Promise<ContactsResponse> {
    return this.getContacts(params, opts);
  }

  /** Alias for `getGroups()`. */
  listGroups(params: PagingParams = {}, opts?: RequestOptions): Promise<GroupsResponse> {
    return this.getGroups(params, opts);
  }

  /** Alias for `getMediaFiles()`. */
  listMedia(params: PagingParams = {}, opts?: RequestOptions): Promise<MediaFilesResponse> {
    return this.getMediaFiles(params, opts);
  }

  /** Alias for `markMessageAsRead()`. */
  markAsRead(messageId: string, opts?: RequestOptions): Promise<SuccessResponse> {
    return this.markMessageAsRead(messageId, opts);
  }

  /** Reacts with a single emoji. Shorthand for `reactToMessage()`. */
  react(messageId: string, emoji: string, opts?: RequestOptions): Promise<SuccessResponse> {
    return this.reactToMessage(messageId, { emoji }, opts);
  }

  /** Alias for `removeReaction()`. */
  unreact(messageId: string, opts?: RequestOptions): Promise<SuccessResponse> {
    return this.removeReaction(messageId, opts);
  }

  /** Alias for `getMessageStatuses()`. */
  getStatuses(messageId: string, opts?: RequestOptions): Promise<MessageStatusesResponse> {
    return this.getMessageStatuses(messageId, opts);
  }

  /** Shows a typing indicator in a chat. Shorthand for `sendPresence()`. */
  sendTyping(chatId: string, delaySeconds?: number, opts?: RequestOptions): Promise<SuccessResponse> {
    const body: SendPresenceBody = { presence: 'typing' };
    if (delaySeconds !== undefined) body.delay = delaySeconds;
    return this.sendPresence(chatId, body, opts);
  }

  /** Alias for `logoutUser()`. */
  logout(opts?: RequestOptions): Promise<SuccessResponse> {
    return this.logoutUser(opts);
  }

  /* ---------------------------------------------------------------------- */
  /* Internals                                                              */
  /* ---------------------------------------------------------------------- */

  /**
   * Sends a media message, choosing JSON or multipart from the `media` value.
   *
   * The spec accepts both on these endpoints: JSON when `media` is a URL, data
   * URI or uploaded id, multipart when the bytes travel with the request.
   */
  private sendMedia(path: string, body: SendMediaBody, opts?: RequestOptions): Promise<SentMessage> {
    if (!isBinaryLike(body.media)) {
      return this.core.request({ method: 'POST', path, body, ...opts });
    }
    const { media, filename, mime_type: mimeType, ...rest } = body as SendMediaBody & { mime_type?: string };
    const form = new FormData();
    appendMultipartFields(form, rest);
    form.append('media', toBlob(media as Exclude<MediaField, string>, mimeType), filename ?? 'file');
    return this.core.request({ method: 'POST', path, form, ...opts });
  }
}

function buildMediaForm(input: {
  media: Blob | ArrayBuffer | ArrayBufferView;
  filename?: string;
  contentType?: string;
}): FormData {
  const form = new FormData();
  form.append('media', toBlob(input.media, input.contentType), input.filename ?? 'file');
  return form;
}

/** Copies scalar fields onto a FormData, JSON-encoding arrays and objects. */
function appendMultipartFields(form: FormData, fields: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null) continue;
    if (typeof value === 'object') form.append(key, JSON.stringify(value));
    else form.append(key, String(value));
  }
}

/** Forwards the shared transport options, leaving out the credential. */
function passThrough(options: WasenderClientOptions): Partial<ClientCoreOptions> {
  return {
    fetch: options.fetch,
    timeoutMs: options.timeoutMs,
    retry: options.retry,
    maxRetries: options.maxRetries,
    headers: options.headers,
    sleep: options.sleep,
    userAgent: options.userAgent,
  };
}
