export type WhatsAppSessionStatus =
  | 'INITIALIZING'
  | 'SCAN_QR'
  | 'CONNECTED'
  | 'DISCONNECTED'
  | 'FAILED';

export interface WhatsAppChannelResponse {
  id: string;
  userId: string;
  phoneNumber: string | null;
  jid: string | null;
  name: string | null;
  profilePic: string | null;
  status: string;
  connectedAt: Date | null;
  createdAt: Date;
  isSocketActive?: boolean;
}

export interface ConnectSessionResponse {
  channelId: string;
  status: WhatsAppSessionStatus;
  qrCodeBase64?: string;
  qrCodeString?: string;
  pairingCode?: string;
  expiresInSeconds?: number;
  channel?: WhatsAppChannelResponse;
}

export interface SessionStatusResponse {
  channelId: string;
  status: WhatsAppSessionStatus;
  qrCodeBase64?: string;
  pairingCode?: string;
  channel?: WhatsAppChannelResponse;
  message?: string;
}

export interface WhatsAppListItem {
  title: string;
  rowId: string;
  description?: string;
}

export interface WhatsAppListSection {
  title: string;
  rows: WhatsAppListItem[];
}

export interface WhatsAppButton {
  buttonId: string;
  buttonText: string;
}

export interface SendWhatsAppMessageDto {
  to: string; // Phone number with country code, e.g. "919876543210" or "919876543210@s.whatsapp.net"
  text?: string;
  mediaUrl?: string;
  mediaType?: 'image' | 'video' | 'audio' | 'document';
  caption?: string;
  fileName?: string;
  mimetype?: string;

  // Interactive UI elements
  title?: string;
  footer?: string;
  buttonText?: string; // Text on the list trigger button (e.g. "Select" or "Choose an option")
  sections?: WhatsAppListSection[]; // For interactive native list bottom sheet
  buttons?: WhatsAppButton[]; // For quick reply buttons
}

export interface SendWhatsAppMessageResponse {
  success: boolean;
  messageId?: string;
  to: string;
  sentAt: Date;
}
