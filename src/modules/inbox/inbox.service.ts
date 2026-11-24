import prisma from '../../config/database';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import whatsAppService from '../whatsapp/whatsapp.service';
import {
  SendMessageDto,
  SenderAction,
  UpdateConversationDto,
  ConversationFilterQuery,
  UploadMediaDto,
  InboxStatsResponse,
} from './inbox.types';

export class InboxService {
  /**
   * List all conversations across WhatsApp for the authenticated user's channels.
   */
  async listConversations(userId: string, filters: ConversationFilterQuery = {}) {
    // 1. Fetch user's WhatsApp channels
    const waChannels = await prisma.whatsAppChannel.findMany({
      where: { userId },
      select: { id: true, phoneNumber: true, name: true, jid: true },
    });

    const waChannelIds = waChannels.map((c) => c.id);

    // Filter by specific channelId if provided
    let targetWaChannelIds = waChannelIds;

    if (filters.channelId) {
      if (waChannelIds.includes(filters.channelId)) {
        targetWaChannelIds = [filters.channelId];
      } else {
        return { conversations: [], count: 0, limit: filters.limit || 50, offset: filters.offset || 0 };
      }
    }

    // 2. Build Prisma query filters for WhatsApp contacts
    let waConversations: any[] = [];
    let waCount = 0;

    if (targetWaChannelIds.length > 0) {
      const waWhere: any = {
        channelId: { in: targetWaChannelIds },
      };

      if (filters.status === 'unread') {
        waWhere.unreadCount = { gt: 0 };
      } else if (filters.status === 'archived') {
        waWhere.isArchived = true;
      } else if (filters.status !== 'all') {
        waWhere.isArchived = false;
      }

      if (filters.tag) {
        waWhere.tags = { has: filters.tag };
      }

      if (filters.search && filters.search.trim()) {
        const q = filters.search.trim();
        waWhere.OR = [
          { name: { contains: q, mode: 'insensitive' } },
          { phoneNumber: { contains: q, mode: 'insensitive' } },
          { lastMessageText: { contains: q, mode: 'insensitive' } },
        ];
      }

      const limit = Math.min(Math.max(filters.limit || 50, 1), 100);
      const offset = Math.max(filters.offset || 0, 0);

      const [contacts, count] = await Promise.all([
        prisma.whatsAppContact.findMany({
          where: waWhere,
          orderBy: [{ isPinned: 'desc' }, { lastMessageAt: 'desc' }],
          take: limit,
          skip: offset,
          include: {
            channel: {
              select: {
                id: true,
                name: true,
                phoneNumber: true,
                jid: true,
              },
            },
            _count: {
              select: { messages: true },
            },
          },
        }),
        prisma.whatsAppContact.count({ where: waWhere }),
      ]);

      waConversations = contacts.map((c: any) => ({
        ...c,
        channelType: 'WHATSAPP',
        username: c.phoneNumber || c.jid.split('@')[0],
        channel: {
          id: c.channel.id,
          type: 'WHATSAPP',
          name: c.channel.name,
          username: c.channel.phoneNumber,
          phoneNumber: c.channel.phoneNumber,
          jid: c.channel.jid,
        },
      }));
      waCount = count;

      // Lazy-refresh profile pictures if missing
      for (const c of contacts) {
        if (!c.profilePic && c.channelId && c.jid) {
          whatsAppService.fetchContactProfilePic(c.channelId, c.jid).then(async (url) => {
            if (url) {
              await prisma.whatsAppContact.update({
                where: { id: c.id },
                data: { profilePic: url },
              }).catch(() => {});
            }
          }).catch(() => {});
        }
      }
    }

    return {
      conversations: waConversations,
      count: waCount,
      limit: filters.limit || 50,
      offset: filters.offset || 0,
    };
  }

  /**
   * Get single conversation details by contact ID for WhatsApp.
   */
  async getConversation(userId: string, contactId: string) {
    const waContact = await prisma.whatsAppContact.findUnique({
      where: { id: contactId },
      include: {
        channel: {
          select: {
            id: true,
            userId: true,
            name: true,
            phoneNumber: true,
            jid: true,
          },
        },
        _count: {
          select: { messages: true },
        },
      },
    });

    if (waContact) {
      if (waContact.channel.userId !== userId) {
        throw new Error('CONVERSATION_NOT_FOUND');
      }
      return {
        ...waContact,
        channelType: 'WHATSAPP' as const,
        username: waContact.phoneNumber || waContact.jid.split('@')[0],
        channel: {
          id: waContact.channel.id,
          type: 'WHATSAPP',
          name: waContact.channel.name,
          username: waContact.channel.phoneNumber,
          phoneNumber: waContact.channel.phoneNumber,
          jid: waContact.channel.jid,
        },
      };
    }

    throw new Error('CONVERSATION_NOT_FOUND');
  }

  /**
   * Get message history for a specific conversation on WhatsApp.
   */
  async getMessages(
    userId: string,
    contactId: string,
    limit: number = 50,
    before?: string,
  ) {
    // Verify ownership and get channel type
    const conversation = await this.getConversation(userId, contactId);
    const safeLimit = Math.min(Math.max(limit, 1), 100);

    const where: any = { contactId };
    if (before) {
      const beforeDate = new Date(before);
      if (!isNaN(beforeDate.getTime())) {
        where.sentAt = { lt: beforeDate };
      }
    }

    // --- WHATSAPP MESSAGES ---
    const messages = await prisma.whatsAppMessage.findMany({
      where,
      orderBy: { sentAt: 'asc' },
      take: safeLimit,
    });

    // Reset unreadCount and mark inbound messages as read
    const unreadInbounds = messages.filter(
      (m: any) => m.direction === 'INBOUND' && (!m.readAt || m.status !== 'READ'),
    );

    await Promise.all([
      prisma.whatsAppContact.update({
        where: { id: contactId },
        data: { unreadCount: 0 },
      }).catch(() => {}),
      unreadInbounds.length > 0
        ? prisma.whatsAppMessage.updateMany({
            where: {
              id: { in: unreadInbounds.map((m: any) => m.id) },
            },
            data: {
              readAt: new Date(),
              status: 'READ',
            },
          }).catch(() => {})
        : Promise.resolve(),
    ]);

    // Send read receipts to WhatsApp socket if active
    if (unreadInbounds.length > 0 && conversation.channelId && conversation.jid) {
      const keys = unreadInbounds
        .filter((m: any) => m.waMessageId)
        .map((m: any) => ({ remoteJid: conversation.jid, id: m.waMessageId }));

      whatsAppService.markMessagesRead(conversation.channelId, keys).catch(() => {});
    }

    return messages.map((m: any) => ({
      ...m,
      channelType: 'WHATSAPP',
      metaMessageId: m.waMessageId,
    }));
  }

  /**
   * Send an outbound WhatsApp message.
   */
  async sendMessage(userId: string, contactId: string, dto: SendMessageDto) {
    if (!dto.text && !dto.mediaUrl) {
      throw new Error('MESSAGE_CONTENT_REQUIRED');
    }

    const conversation = await this.getConversation(userId, contactId);

    const displayText = dto.text || (dto.mediaType ? `[${dto.mediaType.toUpperCase()}]` : '[Attachment]');
    const computedMessageType = (dto.mediaType || 'TEXT').toUpperCase();
    const waMediaType =
      dto.mediaType === 'file'
        ? 'document'
        : (dto.mediaType as 'image' | 'video' | 'audio' | 'document' | undefined);

    const sendResult = await whatsAppService.sendMessage(userId, conversation.channelId, {
      to: conversation.jid,
      text: dto.text,
      mediaUrl: dto.mediaUrl,
      mediaType: waMediaType,
      caption: dto.text,
    });

    // Save message to database
    const savedMessage = await prisma.whatsAppMessage.create({
      data: {
        channelId: conversation.channelId,
        contactId: conversation.id,
        direction: 'OUTBOUND',
        messageType: computedMessageType,
        text: displayText,
        mediaUrl: dto.mediaUrl || null,
        mediaType: dto.mediaType || null,
        status: 'DELIVERED',
        waMessageId: sendResult.messageId || null,
        sentAt: new Date(),
      },
    });

    // Update WhatsApp contact metadata
    await prisma.whatsAppContact.update({
      where: { id: conversation.id },
      data: {
        lastMessageText: displayText,
        lastMessageType: computedMessageType,
        lastMessageAt: new Date(),
        lastInteractionAt: new Date(),
      },
    });

    return {
      ...savedMessage,
      channelType: 'WHATSAPP',
      metaMessageId: savedMessage.waMessageId,
    };
  }

  /**
   * Send a sender action (mark_seen, typing_on, typing_off) for WhatsApp.
   */
  async sendAction(userId: string, contactId: string, action: SenderAction) {
    const conversation = await this.getConversation(userId, contactId);

    if (action === 'typing_on') {
      await whatsAppService.sendPresence(conversation.channelId, conversation.jid, 'composing');
    } else if (action === 'typing_off') {
      await whatsAppService.sendPresence(conversation.channelId, conversation.jid, 'paused');
    } else if (action === 'mark_seen') {
      await Promise.all([
        prisma.whatsAppContact.update({
          where: { id: conversation.id },
          data: { unreadCount: 0 },
        }),
        prisma.whatsAppMessage.updateMany({
          where: {
            contactId: conversation.id,
            direction: 'INBOUND',
            readAt: null,
          },
          data: {
            readAt: new Date(),
            status: 'READ',
          },
        }),
      ]);
    }
    return { success: true, action };
  }

  /**
   * Update conversation status (archive, pin, CRM tags, notes) for WhatsApp.
   */
  async updateConversation(
    userId: string,
    contactId: string,
    dto: UpdateConversationDto,
  ) {
    await this.getConversation(userId, contactId);

    const data: any = {};
    if (typeof dto.isArchived === 'boolean') data.isArchived = dto.isArchived;
    if (typeof dto.isPinned === 'boolean') data.isPinned = dto.isPinned;
    if (Array.isArray(dto.tags)) data.tags = dto.tags;
    if (typeof dto.notes === 'string') data.notes = dto.notes;

    const updated = await prisma.whatsAppContact.update({
      where: { id: contactId },
      data,
    });
    return { ...updated, channelType: 'WHATSAPP' };
  }

  /**
   * Get inbox statistical overview for WhatsApp channels.
   */
  async getStats(
    userId: string,
    channelId?: string,
    _channelType?: string,
  ): Promise<InboxStatsResponse> {
    const waChannels = await prisma.whatsAppChannel.findMany({
      where: { userId },
      select: { id: true },
    });

    const waChannelIds = waChannels.map((c) => c.id);
    let targetWaChannelIds = waChannelIds;

    if (channelId && waChannelIds.includes(channelId)) {
      targetWaChannelIds = [channelId];
    }

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    let waTotalConvs = 0;
    let waUnreadConvs = 0;
    let waUnreadMsgs = 0;
    let waMsgsToday = 0;

    if (targetWaChannelIds.length > 0) {
      const [total, unreadC, unreadM, today] = await Promise.all([
        prisma.whatsAppContact.count({
          where: { channelId: { in: targetWaChannelIds }, isArchived: false },
        }),
        prisma.whatsAppContact.count({
          where: { channelId: { in: targetWaChannelIds }, unreadCount: { gt: 0 }, isArchived: false },
        }),
        prisma.whatsAppContact.aggregate({
          where: { channelId: { in: targetWaChannelIds }, isArchived: false },
          _sum: { unreadCount: true },
        }),
        prisma.whatsAppMessage.count({
          where: { channelId: { in: targetWaChannelIds }, sentAt: { gte: todayStart } },
        }),
      ]);

      waTotalConvs = total;
      waUnreadConvs = unreadC;
      waUnreadMsgs = unreadM._sum.unreadCount || 0;
      waMsgsToday = today;
    }

    return {
      totalConversations: waTotalConvs,
      unreadConversations: waUnreadConvs,
      totalMessagesToday: waMsgsToday,
      totalUnreadMessages: waUnreadMsgs,
      channels: {
        whatsApp: {
          totalConversations: waTotalConvs,
          unreadConversations: waUnreadConvs,
          totalMessagesToday: waMsgsToday,
          totalUnreadMessages: waUnreadMsgs,
        },
      },
    };
  }

  /**
   * Save an uploaded attachment to disk and return accessible public URL.
   */
  async saveUploadedMedia(dto: UploadMediaDto, baseUrl: string) {
    if (!dto.fileBase64 || !dto.filename) {
      throw new Error('FILE_PAYLOAD_REQUIRED');
    }

    const uploadsDir = path.join(process.cwd(), 'uploads');
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }

    const ext = path.extname(dto.filename) || '.bin';
    const randomHex = crypto.randomBytes(8).toString('hex');
    const filename = `${Date.now()}_${randomHex}${ext}`;
    const filePath = path.join(uploadsDir, filename);

    let mediaType: 'image' | 'video' | 'audio' | 'file' = 'file';
    if (dto.mimeType.startsWith('image/')) mediaType = 'image';
    else if (dto.mimeType.startsWith('video/')) mediaType = 'video';
    else if (dto.mimeType.startsWith('audio/')) mediaType = 'audio';

    // Clean base64 header if present (e.g. "data:image/jpeg;base64,...")
    const cleanBase64 = dto.fileBase64.replace(/^data:[^;]+;base64,/, '');
    const buffer = Buffer.from(cleanBase64, 'base64');

    fs.writeFileSync(filePath, buffer);

    const hostUrl = process.env.PUBLIC_BACKEND_URL ||
      (baseUrl.includes('localhost') ? 'https://emychat-backend.onrender.com' : baseUrl.replace(/\/api\/v1\/?$/, ''));
    const publicUrl = `${hostUrl}/uploads/${filename}`;

    return {
      url: publicUrl,
      filename,
      mimeType: dto.mimeType,
      mediaType,
    };
  }
}

export default new InboxService();
