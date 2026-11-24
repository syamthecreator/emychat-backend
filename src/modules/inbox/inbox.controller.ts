import { Response } from 'express';
import { AuthenticatedRequest } from '../auth/auth.types';
import inboxService from './inbox.service';
import {
  SendMessageDto,
  SendActionDto,
  UpdateConversationDto,
  ConversationFilterQuery,
  UploadMediaDto,
} from './inbox.types';

export class InboxController {
  async list(req: AuthenticatedRequest, res: Response) {
    try {
      const filters: ConversationFilterQuery = {
        channelType: req.query.channelType as any,
        channelId: req.query.channelId as string,
        status: req.query.status as any,
        search: req.query.search as string,
        tag: req.query.tag as string,
        limit: req.query.limit ? parseInt(req.query.limit as string, 10) : 50,
        offset: req.query.offset ? parseInt(req.query.offset as string, 10) : 0,
      };

      const result = await inboxService.listConversations(req.userId!, filters);

      return res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      console.error('List conversations error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to retrieve conversations',
      });
    }
  }

  async getById(req: AuthenticatedRequest, res: Response) {
    try {
      const conversation = await inboxService.getConversation(
        req.userId!,
        req.params.contactId as string,
      );

      return res.status(200).json({
        success: true,
        data: {
          conversation,
        },
      });
    } catch (error) {
      if (error instanceof Error && error.message === 'CONVERSATION_NOT_FOUND') {
        return res.status(404).json({
          success: false,
          message: 'Conversation not found',
        });
      }

      console.error('Get conversation error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to retrieve conversation details',
      });
    }
  }

  async getMessages(req: AuthenticatedRequest, res: Response) {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;
      const before = req.query.before as string;

      const messages = await inboxService.getMessages(
        req.userId!,
        req.params.contactId as string,
        limit,
        before,
      );

      return res.status(200).json({
        success: true,
        data: {
          messages,
          count: messages.length,
        },
      });
    } catch (error) {
      if (error instanceof Error && error.message === 'CONVERSATION_NOT_FOUND') {
        return res.status(404).json({
          success: false,
          message: 'Conversation not found',
        });
      }

      console.error('Get messages error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to retrieve conversation messages',
      });
    }
  }

  async sendMessage(req: AuthenticatedRequest, res: Response) {
    try {
      const dto = req.body as SendMessageDto;
      const message = await inboxService.sendMessage(
        req.userId!,
        req.params.contactId as string,
        dto,
      );

      return res.status(201).json({
        success: true,
        message: 'Message sent successfully',
        data: {
          message,
        },
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to send message';
      const statusCode =
        message === 'CONVERSATION_NOT_FOUND'
          ? 404
          : message === 'MESSAGE_CONTENT_REQUIRED'
          ? 400
          : 500;

      return res.status(statusCode).json({
        success: false,
        message,
      });
    }
  }

  async sendAction(req: AuthenticatedRequest, res: Response) {
    try {
      const { action } = req.body as SendActionDto;
      if (!action || !['mark_seen', 'typing_on', 'typing_off'].includes(action)) {
        return res.status(400).json({
          success: false,
          message: 'Valid action (mark_seen, typing_on, typing_off) is required',
        });
      }

      const result = await inboxService.sendAction(
        req.userId!,
        req.params.contactId as string,
        action,
      );

      return res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      if (error instanceof Error && error.message === 'CONVERSATION_NOT_FOUND') {
        return res.status(404).json({
          success: false,
          message: 'Conversation not found',
        });
      }

      return res.status(500).json({
        success: false,
        message: 'Failed to send sender action',
      });
    }
  }

  async updateConversation(req: AuthenticatedRequest, res: Response) {
    try {
      const dto = req.body as UpdateConversationDto;
      const conversation = await inboxService.updateConversation(
        req.userId!,
        req.params.contactId as string,
        dto,
      );

      return res.status(200).json({
        success: true,
        message: 'Conversation updated successfully',
        data: {
          conversation,
        },
      });
    } catch (error) {
      if (error instanceof Error && error.message === 'CONVERSATION_NOT_FOUND') {
        return res.status(404).json({
          success: false,
          message: 'Conversation not found',
        });
      }

      return res.status(500).json({
        success: false,
        message: 'Failed to update conversation',
      });
    }
  }

  async getStats(req: AuthenticatedRequest, res: Response) {
    try {
      const channelId = req.query.channelId as string;
      const channelType = req.query.channelType as any;
      const stats = await inboxService.getStats(req.userId!, channelId, channelType);

      return res.status(200).json({
        success: true,
        data: stats,
      });
    } catch (error) {
      console.error('Get inbox stats error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to retrieve inbox stats',
      });
    }
  }

  async upload(req: AuthenticatedRequest, res: Response) {
    try {
      const dto = req.body as UploadMediaDto;
      const protocol = req.protocol || 'https';
      const host = req.get('host') || 'localhost:5001';
      const baseUrl = `${protocol}://${host}`;

      const uploaded = await inboxService.saveUploadedMedia(dto, baseUrl);

      return res.status(201).json({
        success: true,
        message: 'Media uploaded successfully',
        data: uploaded,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to upload media';
      return res.status(400).json({
        success: false,
        message,
      });
    }
  }
}

export default new InboxController();

