/**
 * Request and response types derived from the wasender.dev OpenAPI 3.1 spec.
 *
 * Where the spec pins a value down (enums, required fields) the type is precise.
 * Where it leaves room, or where the API may grow a field, interfaces carry an
 * index signature so new fields do not break compilation.
 */

/* -------------------------------------------------------------------------- */
/* Shared primitives                                                          */
/* -------------------------------------------------------------------------- */

/** Region a channel's session runs in, as reported by `GET /health`. */
export type Region = 'sg' | 'us-east' | 'us-west' | 'eu';

/** Region a channel can be created in, per `POST /channels`. */
export type CreatableRegion = 'sg';

export type ChannelStatus =
  | 'pending'
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'hibernated'
  | 'suspended'
  | 'logged_out';

export type MessageType =
  | 'text'
  | 'image'
  | 'video'
  | 'gif'
  | 'audio'
  | 'voice'
  | 'document'
  | 'sticker'
  | 'link_preview'
  | 'location'
  | 'live_location'
  | 'contact'
  | 'contact_list'
  | 'poll'
  | 'interactive'
  | 'system'
  | 'order'
  | 'action';

export type MessageStatus = 'pending' | 'sent' | 'delivered' | 'read' | 'played' | 'failed';

export type MessageSource = 'api' | 'web' | 'mobile' | 'desktop';

export type ChatType = 'contact' | 'group' | 'newsletter' | 'broadcast';

export type GroupRank = 'member' | 'admin' | 'creator';

export type WebhookEventType =
  | 'messages'
  | 'statuses'
  | 'chats'
  | 'contacts'
  | 'groups'
  | 'calls'
  | 'users';

export type WebhookMethod = 'post' | 'put' | 'patch' | 'delete';

export type MediaKind = 'image' | 'video' | 'audio' | 'voice' | 'document' | 'sticker';

/** `{"success": true}`, returned by the action endpoints. */
export interface SuccessResponse {
  success?: boolean;
  [key: string]: unknown;
}

/** Shared `count`/`offset` paging parameters. */
export interface PagingParams {
  /** How many records to return (1 to 500, default 100). */
  count?: number;
  /** How many records to skip (default 0). */
  offset?: number;
}

/* -------------------------------------------------------------------------- */
/* Entities                                                                   */
/* -------------------------------------------------------------------------- */

export interface ApiError {
  code: number;
  message: string;
  details?: string;
  href?: string;
  support?: string;
  [key: string]: unknown;
}

export interface Health {
  status?: { text?: ChannelStatus; code?: number; [key: string]: unknown };
  user?: { id?: string; name?: string; [key: string]: unknown };
  region?: Region;
  version?: string;
  [key: string]: unknown;
}

export interface SettingsWebhookEvent {
  type?: WebhookEventType;
  method?: WebhookMethod;
  [key: string]: unknown;
}

export interface SettingsWebhook {
  url: string;
  events?: SettingsWebhookEvent[];
  /** `body` posts the event as the request body, `method` encodes it in the HTTP method. */
  mode?: 'body' | 'method';
  [key: string]: unknown;
}

export interface Settings {
  webhooks?: SettingsWebhook[];
  callback_persist?: boolean;
  media?: { auto_download?: MediaKind[]; [key: string]: unknown };
  offline_mode?: boolean;
  full_history?: boolean;
  /** Per-channel outbound proxy, for example `http://user:pass@host:port`. */
  proxy?: string;
  [key: string]: unknown;
}

export interface Profile {
  id?: string;
  name?: string;
  pushname?: string;
  /** The "about" line. */
  status?: string;
  icon?: string;
  icon_full?: string;
  [key: string]: unknown;
}

export interface MessageMedia {
  id?: string;
  mime_type?: string;
  file_size?: number;
  file_name?: string;
  sha256?: string;
  /** Short lived signed download URL. */
  link?: string;
  caption?: string;
  width?: number;
  height?: number;
  seconds?: number;
  /** Base64 thumbnail. */
  preview?: string;
  [key: string]: unknown;
}

export interface MessageLocation {
  latitude?: number;
  longitude?: number;
  name?: string;
  address?: string;
  [key: string]: unknown;
}

export interface MessageContext {
  quoted_id?: string;
  quoted_author?: string;
  mentions?: string[];
  [key: string]: unknown;
}

export interface MessageReaction {
  emoji?: string;
  from?: string;
  timestamp?: number;
  [key: string]: unknown;
}

export interface Message {
  id: string;
  type: MessageType;
  subtype?: string;
  chat_id: string;
  chat_name?: string;
  /** WhatsApp id of the sender. */
  from?: string;
  phone?: string;
  from_me: boolean;
  /** Sender's WhatsApp display name. */
  from_name?: string;
  source?: MessageSource;
  /** Unix seconds. */
  timestamp: number;
  status?: MessageStatus;
  text?: { body?: string; [key: string]: unknown };
  image?: MessageMedia;
  video?: MessageMedia;
  audio?: MessageMedia;
  voice?: MessageMedia;
  document?: MessageMedia;
  sticker?: MessageMedia;
  location?: MessageLocation;
  context?: MessageContext;
  reactions?: MessageReaction[];
  starred?: boolean;
  [key: string]: unknown;
}

/**
 * Response to every send endpoint.
 *
 * `sent: true` means WhatsApp accepted the message, not that it was delivered.
 * Confirm delivery with `statuses` webhook events or `getMessageStatuses()`.
 */
export interface SentMessage {
  sent: boolean;
  message?: Message;
  [key: string]: unknown;
}

export interface MessagesList {
  messages?: Message[];
  count?: number;
  total?: number;
  offset?: number;
  [key: string]: unknown;
}

export interface MessageDeliveryStatus {
  id: string;
  code: number;
  status: MessageStatus;
  recipient_id?: string;
  timestamp: number;
  errors?: ApiError[];
  [key: string]: unknown;
}

export interface MessageStatusesResponse {
  statuses?: MessageDeliveryStatus[];
  [key: string]: unknown;
}

export interface Chat {
  id?: string;
  name?: string;
  type?: ChatType;
  timestamp?: number;
  unread?: number;
  archived?: boolean;
  pinned?: boolean;
  mute_until?: number;
  labels?: string[];
  last_message?: Message;
  [key: string]: unknown;
}

export interface ChatsResponse {
  chats?: Chat[];
  count?: number;
  total?: number;
  offset?: number;
  [key: string]: unknown;
}

export interface Contact {
  id?: string;
  /** WhatsApp's linked-device identifier. */
  lid?: string;
  name?: string;
  pushname?: string;
  phone?: string;
  is_business?: boolean;
  is_blocked?: boolean;
  profile_pic?: string;
  [key: string]: unknown;
}

export interface ContactsResponse {
  contacts?: Contact[];
  count?: number;
  total?: number;
  offset?: number;
  [key: string]: unknown;
}

export interface CheckedPhone {
  input?: string;
  status?: 'valid' | 'invalid' | 'processing';
  wa_id?: string;
  [key: string]: unknown;
}

export interface CheckPhonesResponse {
  contacts?: CheckedPhone[];
  [key: string]: unknown;
}

export interface GroupParticipant {
  id?: string;
  rank?: GroupRank;
  [key: string]: unknown;
}

export interface Group {
  id?: string;
  name?: string;
  description?: string;
  owner?: string;
  created_at?: number;
  participants?: GroupParticipant[];
  invite_code?: string;
  size?: number;
  [key: string]: unknown;
}

export interface GroupsResponse {
  groups?: Group[];
  count?: number;
  total?: number;
  [key: string]: unknown;
}

export interface AddedGroupParticipant {
  id?: string;
  status?: string;
  /** Present when WhatsApp privacy settings blocked a direct add. */
  invite_link?: string;
  [key: string]: unknown;
}

export interface AddGroupParticipantResponse {
  participants?: AddedGroupParticipant[];
  [key: string]: unknown;
}

export interface GroupInviteResponse {
  invite_code?: string;
  invite_link?: string;
  [key: string]: unknown;
}

export interface MediaFile {
  id?: string;
  name?: string;
  mime_type?: string;
  size?: number;
  sha256?: string;
  link?: string;
  created_at?: number;
  expires_at?: number;
  [key: string]: unknown;
}

export interface MediaFilesResponse {
  media?: MediaFile[];
  total?: number;
  [key: string]: unknown;
}

/* -------------------------------------------------------------------------- */
/* Send request bodies                                                        */
/* -------------------------------------------------------------------------- */

/** Fields shared by every send endpoint. */
export interface SendBase {
  /**
   * Recipient: a phone number in international format without a leading `+`
   * (`61371989950`), or a full chat id (`61371989950@s.whatsapp.net`, or
   * `1234567890@g.us` for a group).
   */
  to: string;
  /** Id of the message this one replies to. */
  quoted?: string;
  /** Id of a message to edit instead of sending a new one. */
  edit?: string;
  /** Numbers to @-mention. They must also appear in the body as `@number`. */
  mentions?: string[];
  /** Deliver as view-once (media only). */
  view_once?: boolean;
  [key: string]: unknown;
}

export interface SendTextBody extends SendBase {
  body: string;
  /** Seconds of typing indicator before sending (0 to 60). */
  typing_time?: number;
  /** Suppress the link preview WhatsApp would otherwise generate. */
  no_link_preview?: boolean;
  /** Request the full-width preview card. */
  wide_link_preview?: boolean;
}

/** A file to upload inline, instead of referencing one by URL or id. */
export type MediaUpload = Blob | ArrayBuffer | ArrayBufferView;

export interface SendMediaBody extends SendBase {
  /**
   * One of: a URL the service fetches, a base64 data URI, the `id` of a file
   * previously uploaded with `uploadMedia()`, or binary content to upload with
   * this request (which switches the request to multipart/form-data).
   */
  media: string | MediaUpload;
  caption?: string;
  mime_type?: string;
  /** Filename to use for the multipart part. Ignored for string media. */
  filename?: string;
}

export interface SendDocumentBody extends SendMediaBody {
  /** Name shown to the recipient. Defaults to the source filename. */
  filename?: string;
}

export interface SendLocationBody extends SendBase {
  latitude: number;
  longitude: number;
  /** Place name. */
  name?: string;
  address?: string;
}

export interface SendContactBody extends SendBase {
  name: string;
  /** vCard 3.0 payload. */
  vcard: string;
}

export interface SendLinkPreviewBody extends SendBase {
  /** Text containing the URL. */
  body: string;
  title?: string;
  description?: string;
  /** Thumbnail URL or base64 image. */
  preview?: string;
}

export interface SendPollBody extends SendBase {
  /** The question. */
  title: string;
  /** 2 to 12 options. */
  options: string[];
  /** How many options a voter may pick (default 1). */
  count?: number;
}

export interface EditMessageBody {
  body: string;
  [key: string]: unknown;
}

export interface ReactToMessageBody {
  /** A single emoji. An empty string removes your reaction. */
  emoji?: string;
  [key: string]: unknown;
}

export interface StarMessageBody {
  star: boolean;
  [key: string]: unknown;
}

export interface UpdateProfileBody {
  /** Display name. */
  name?: string;
  /** The "about" line. */
  status?: string;
  /** Base64 image, or a URL to fetch one from. */
  profile_pic?: string;
  [key: string]: unknown;
}

export interface UpdateChatBody {
  archive?: boolean;
  pin?: boolean;
  read?: boolean;
  /** Unix seconds. `0` unmutes, `-1` mutes indefinitely. */
  mute_until?: number;
  [key: string]: unknown;
}

export interface CheckPhonesBody {
  /** Up to 500 numbers per call. Keep batches modest. */
  contacts: string[];
  blocking?: 'no_wait' | 'wait';
  [key: string]: unknown;
}

export interface CreateGroupBody {
  /** Group name. */
  subject: string;
  participants: string[];
  [key: string]: unknown;
}

export interface UpdateGroupBody {
  subject?: string;
  description?: string;
  [key: string]: unknown;
}

export interface GroupParticipantsBody {
  participants: string[];
  [key: string]: unknown;
}

export interface SetMyPresenceBody {
  presence: 'online' | 'offline';
  [key: string]: unknown;
}

export interface SendPresenceBody {
  presence: 'typing' | 'recording' | 'paused';
  /** Seconds to keep the indicator up (0 to 60). */
  delay?: number;
  [key: string]: unknown;
}

/* -------------------------------------------------------------------------- */
/* Query parameter bags                                                       */
/* -------------------------------------------------------------------------- */

export interface CheckHealthParams {
  /** Wake a hibernated channel and wait for it to reconnect before answering. */
  wakeup?: boolean;
}

export interface GetLoginQrParams {
  /** Defaults to true on this endpoint. */
  wakeup?: boolean;
  /** Image edge length in pixels (100 to 1000, default 300). */
  size?: number;
}

export interface GetMessagesParams extends PagingParams {
  /**
   * Restrict to one conversation. Accepts `12025550143`,
   * `12025550143@s.whatsapp.net`, or a group's `...@g.us`.
   */
  chat_id?: string;
  /** Only messages at or after this Unix timestamp (seconds). */
  time_from?: number;
  /** Only messages at or before this Unix timestamp (seconds). */
  time_to?: number;
  /** Exclude system and protocol messages. */
  normal_types?: boolean;
}

export interface GetMessagesByChatIdParams extends PagingParams {
  time_from?: number;
  time_to?: number;
}

/* -------------------------------------------------------------------------- */
/* Provisioning                                                               */
/* -------------------------------------------------------------------------- */

/** A WhatsApp number as the provisioning API sees it. */
export interface ManagedChannel {
  /** Use this in the provisioning paths. */
  id?: string;
  name?: string;
  /** Null until the number is linked. WhatsApp reports it on connect. */
  phoneNumber?: string | null;
  status?: ChannelStatus;
  region?: string;
  billable?: boolean;
  /** Enough to identify which token this is, never the whole token. */
  tokenPrefix?: string;
  createdAt?: string;
  connectedAt?: string | null;
  [key: string]: unknown;
}

export interface ListChannelsResponse {
  channels?: ManagedChannel[];
  [key: string]: unknown;
}

export interface CreateChannelBody {
  /** A label for your own reference. Not visible to anyone messaged. */
  name?: string;
  /** Where the session runs. Locked once the number connects. */
  region?: CreatableRegion;
  [key: string]: unknown;
}

export interface CreateChannelResponse {
  channel?: ManagedChannel;
  /** The channel token. Shown once, so store it in the same handler. */
  token?: string;
  [key: string]: unknown;
}

export interface GetChannelResponse {
  channel?: ManagedChannel;
  [key: string]: unknown;
}

export interface RenameChannelBody {
  /** Up to 60 characters. */
  name: string;
  [key: string]: unknown;
}

export interface RenameChannelResponse {
  name?: string;
  [key: string]: unknown;
}

export interface RotateChannelTokenResponse {
  /** The replacement token. Shown once. */
  token?: string;
  prefix?: string;
  [key: string]: unknown;
}

export interface ChannelWebhook {
  url?: string | null;
  /**
   * HMAC-SHA256 signing secret. Verify `x-wasender-signature` against the raw
   * request body: re-serialising parsed JSON changes the bytes and the
   * signature will not match.
   */
  secret?: string | null;
  events?: string[];
  active?: boolean;
  failureCount?: number;
  lastSuccessAt?: string | null;
  lastFailureAt?: string | null;
  [key: string]: unknown;
}

export interface ChannelWebhookResponse {
  webhook?: ChannelWebhook;
  [key: string]: unknown;
}

export interface SetChannelWebhookBody {
  /** Pass `null` to remove the webhook. */
  url?: string | null;
  events?: string[];
  [key: string]: unknown;
}

/* -------------------------------------------------------------------------- */
/* Webhook payloads                                                           */
/* -------------------------------------------------------------------------- */

/**
 * An inbound webhook payload.
 *
 * The docs describe the message objects carried by `messages` events but do not
 * pin the envelope down, and they advise branching on the fields you actually
 * see rather than on any example. The type is therefore deliberately loose:
 * the known arrays are typed, everything else is left open.
 */
export interface WebhookPayload {
  event?: string;
  /** Present on `messages` events. */
  messages?: Message[];
  /** Present on `statuses` events (delivery and read receipts). */
  statuses?: MessageDeliveryStatus[];
  chats?: Chat[];
  contacts?: Contact[];
  groups?: Group[];
  channel_id?: string;
  [key: string]: unknown;
}
