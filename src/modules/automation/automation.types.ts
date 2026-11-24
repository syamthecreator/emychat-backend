export type ChannelType = 'WHATSAPP';

export type TriggerType =
  | 'DM_KEYWORD'
  | 'WELCOME_MESSAGE'
  | 'FALLBACK_DEFAULT';

export type MatchType = 'EXACT' | 'CONTAINS' | 'STARTS_WITH' | 'ALL';

export type StepType =
  | 'SEND_DM'
  | 'SEND_MESSAGE'
  | 'SEND_MEDIA'
  | 'QUICK_REPLIES'
  | 'DELAY'
  | 'ADD_TAG';

export type AutomationStatus = 'ACTIVE' | 'PAUSED' | 'DRAFT';

export interface QuickReplyButton {
  title: string;
  payload?: string;
}

export interface StepContent {
  text?: string;
  buttons?: QuickReplyButton[];
  delaySeconds?: number;
  tag?: string;
  mediaUrl?: string;
  mediaType?: 'image' | 'video' | 'audio' | 'document';
  caption?: string;
}

export interface AutomationStepInput {
  order: number;
  stepType: StepType;
  content: StepContent;
}

export interface CreateAutomationDto {
  channelType?: ChannelType;
  whatsAppChannelId?: string; // WhatsApp Channel ID
  name: string;
  description?: string;
  triggerType: TriggerType;
  matchType?: MatchType;
  keywords?: string[];
  status?: AutomationStatus;
  steps: AutomationStepInput[];
}

export interface UpdateAutomationDto {
  channelType?: ChannelType;
  whatsAppChannelId?: string | null;
  name?: string;
  description?: string;
  triggerType?: TriggerType;
  matchType?: MatchType;
  keywords?: string[];
  status?: AutomationStatus;
  steps?: AutomationStepInput[];
}

export interface AutomationFilterQuery {
  channelType?: ChannelType;
  whatsAppChannelId?: string;
  status?: AutomationStatus;
  triggerType?: TriggerType;
  search?: string;
}
