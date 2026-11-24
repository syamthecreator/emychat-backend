import { Request, Response } from 'express';
import whatsAppService from './whatsapp.service';
import { SendWhatsAppMessageDto } from './whatsapp.types';

export class WhatsAppController {
  /**
   * GET /api/v1/whatsapp/channels
   * List all WhatsApp channels for the authenticated user.
   */
  async getChannels(req: Request, res: Response) {
    try {
      const userId = (req as any).userId || (req as any).user?.id;
      if (!userId) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }

      const channels = await whatsAppService.getChannels(userId);
      return res.json({
        success: true,
        data: { channels },
      });
    } catch (e: any) {
      console.error('[WhatsAppController] getChannels error:', e);
      return res.status(500).json({
        success: false,
        message: e.message || 'Failed to fetch WhatsApp channels',
      });
    }
  }

  /**
   * POST /api/v1/whatsapp/connect
   * Initialize a new WhatsApp Web QR session or pairing code session.
   */
  async connect(req: Request, res: Response) {
    try {
      const userId = (req as any).userId || (req as any).user?.id;
      if (!userId) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }

      const channelId = typeof req.body?.channelId === 'string' ? req.body.channelId : undefined;
      const phoneNumber = typeof req.body?.phoneNumber === 'string' ? req.body.phoneNumber : undefined;

      const sessionResponse = await whatsAppService.startSession(userId, channelId, phoneNumber);

      return res.json({
        success: true,
        data: sessionResponse,
      });
    } catch (e: any) {
      console.error('[WhatsAppController] connect error:', e);
      return res.status(500).json({
        success: false,
        message: e.message || 'Failed to initialize WhatsApp session',
      });
    }
  }

  /**
   * GET /api/v1/whatsapp/status/:channelId
   * Poll connection status of a WhatsApp session.
   */
  async getStatus(req: Request, res: Response) {
    try {
      const userId = (req as any).userId || (req as any).user?.id;
      if (!userId) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }

      const rawChannelId = req.params.channelId;
      const channelId = Array.isArray(rawChannelId) ? rawChannelId[0] : rawChannelId;

      if (!channelId) {
        return res.status(400).json({ success: false, message: 'Channel ID required' });
      }

      const statusResponse = await whatsAppService.getSessionStatus(userId, channelId);
      return res.json({
        success: true,
        data: statusResponse,
      });
    } catch (e: any) {
      console.error('[WhatsAppController] getStatus error:', e);
      return res.status(e.message === 'CHANNEL_NOT_FOUND' ? 404 : 500).json({
        success: false,
        message: e.message || 'Failed to check WhatsApp status',
      });
    }
  }

  /**
   * DELETE /api/v1/whatsapp/channels/:channelId
   * Log out and disconnect a WhatsApp channel.
   */
  async disconnect(req: Request, res: Response) {
    try {
      const userId = (req as any).userId || (req as any).user?.id;
      if (!userId) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }

      const rawChannelId = req.params.channelId;
      const channelId = Array.isArray(rawChannelId) ? rawChannelId[0] : rawChannelId;

      if (!channelId) {
        return res.status(400).json({ success: false, message: 'Channel ID required' });
      }

      await whatsAppService.disconnectChannel(userId, channelId);
      return res.json({
        success: true,
        message: 'WhatsApp channel disconnected successfully',
      });
    } catch (e: any) {
      console.error('[WhatsAppController] disconnect error:', e);
      return res.status(e.message === 'CHANNEL_NOT_FOUND' ? 404 : 500).json({
        success: false,
        message: e.message || 'Failed to disconnect WhatsApp channel',
      });
    }
  }

  /**
   * POST /api/v1/whatsapp/channels/:channelId/send-message
   * Send an outbound message with anti-ban rate limiting and presence simulation.
   */
  async sendMessage(req: Request, res: Response) {
    try {
      const userId = (req as any).userId || (req as any).user?.id;
      if (!userId) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }

      const rawChannelId = req.params.channelId;
      const channelId = Array.isArray(rawChannelId) ? rawChannelId[0] : rawChannelId;

      if (!channelId) {
        return res.status(400).json({ success: false, message: 'Channel ID required' });
      }

      const dto: SendWhatsAppMessageDto = {
        to: req.body.to,
        text: req.body.text,
        mediaUrl: req.body.mediaUrl,
        mediaType: req.body.mediaType,
        caption: req.body.caption,
      };

      if (!dto.to) {
        return res.status(400).json({ success: false, message: 'Recipient phone number (to) is required' });
      }

      const sendResult = await whatsAppService.sendMessage(userId, channelId, dto);
      return res.json({
        success: true,
        data: sendResult,
      });
    } catch (e: any) {
      console.error('[WhatsAppController] sendMessage error:', e);
      const isNotFound = e.message === 'CHANNEL_NOT_FOUND' || e.message === 'WHATSAPP_NOT_CONNECTED';
      const isClientError =
        e.message?.startsWith('RATE_LIMIT_EXCEEDED') ||
        e.message === 'NUMBER_NOT_REGISTERED_ON_WHATSAPP' ||
        e.message === 'INVALID_PHONE_NUMBER';

      return res.status(isNotFound ? 404 : isClientError ? 400 : 500).json({
        success: false,
        message: e.message || 'Failed to send WhatsApp message',
      });
    }
  }

  /**
   * POST /api/v1/whatsapp/sync-avatars
   * Trigger on-demand sync of profile pictures for all contacts of user's active WhatsApp channels.
   */
  async syncAvatars(req: Request, res: Response) {
    try {
      const userId = (req as any).userId || (req as any).user?.id;
      if (!userId) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }

      const count = await whatsAppService.syncContactsProfilePics(userId);
      return res.json({
        success: true,
        message: `Synced profile pictures for ${count} contacts`,
        data: { updatedCount: count },
      });
    } catch (e: any) {
      console.error('[WhatsAppController] syncAvatars error:', e);
      return res.status(500).json({
        success: false,
        message: e.message || 'Failed to sync WhatsApp contact avatars',
      });
    }
  }
}

export default new WhatsAppController();
