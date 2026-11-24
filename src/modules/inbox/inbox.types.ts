export type MessageType =
  | 'TEXT'
  | 'IMAGE'
  | 'VIDEO'
  | 'AUDIO'
  | 'VOICE'
  | 'FILE'
  | 'DOCUMENT'
  | 'QUICK_REPLY';

export type MessageDirection = 'INBOUND' | 'OUTBOUND';

export type MessageStatus =
  | 'PENDING'
  | 'SENT'
  | 'DELIVERED'
  | 'READ'
  | 'FAILED';

export type SenderAction = 'mark_seen' | 'typing_on' | 'typing_off';

export interface QuickReplyOption {
  title: string;
  payload?: string;
}

export interface SendMessageDto {
  text?: string;
  mediaUrl?: string;
  mediaType?: 'image' | 'video' | 'audio' | 'file';
  replyToMetaMessageId?: string;
  quickReplies?: QuickReplyOption[];
}

export interface SendActionDto {
  action: SenderAction;
}

export interface UpdateConversationDto {
  isArchived?: boolean;
  isPinned?: boolean;
  tags?: string[];
  notes?: string;
}

export interface ConversationFilterQuery {
  channelType?: 'ALL' | 'WHATSAPP';
  channelId?: string;
  status?: 'all' | 'unread' | 'archived';
  search?: string;
  tag?: string;
  limit?: number;
  offset?: number;
}

export interface UploadMediaDto {
  fileBase64: string;
  filename: string;
  mimeType: string;
}

export interface PlatformStats {
  totalConversations: number;
  unreadConversations: number;
  totalMessagesToday: number;
  totalUnreadMessages: number;
}

export interface InboxStatsResponse {
  totalConversations: number;
  unreadConversations: number;
  totalMessagesToday: number;
  totalUnreadMessages: number;
  channels?: {
    whatsApp: PlatformStats;
  };
}
