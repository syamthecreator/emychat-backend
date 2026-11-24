import { Response } from 'express';
import { AuthenticatedRequest } from '../auth/auth.types';
import automationService from './automation.service';
import {
  CreateAutomationDto,
  UpdateAutomationDto,
  AutomationFilterQuery,
} from './automation.types';

export class AutomationController {
  async list(req: AuthenticatedRequest, res: Response) {
    try {
      const filters: AutomationFilterQuery = {
        channelType: req.query.channelType as any,
        whatsAppChannelId: req.query.whatsAppChannelId as string,
        status: req.query.status as any,
        triggerType: req.query.triggerType as any,
        search: req.query.search as string,
      };

      const automations = await automationService.listAutomations(req.userId!, filters);

      return res.status(200).json({
        success: true,
        data: {
          automations,
          count: automations.length,
        },
      });
    } catch (error) {
      console.error('List automations error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to retrieve automations',
      });
    }
  }

  async getById(req: AuthenticatedRequest, res: Response) {
    try {
      const automation = await automationService.getAutomationById(
        req.userId!,
        req.params.id as string,
      );

      return res.status(200).json({
        success: true,
        data: {
          automation,
        },
      });
    } catch (error) {
      if (error instanceof Error && error.message === 'AUTOMATION_NOT_FOUND') {
        return res.status(404).json({
          success: false,
          message: 'Automation not found',
        });
      }

      console.error('Get automation error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to retrieve automation',
      });
    }
  }

  async create(req: AuthenticatedRequest, res: Response) {
    try {
      const dto = req.body as CreateAutomationDto;
      const automation = await automationService.createAutomation(req.userId!, dto);

      return res.status(201).json({
        success: true,
        message: 'Automation created successfully',
        data: {
          automation,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create automation';
      const statusCode =
        message === 'WHATSAPP_CHANNEL_NOT_FOUND'
          ? 404
          : 400;

      return res.status(statusCode).json({
        success: false,
        message,
      });
    }
  }

  async update(req: AuthenticatedRequest, res: Response) {
    try {
      const dto = req.body as UpdateAutomationDto;
      const automation = await automationService.updateAutomation(
        req.userId!,
        req.params.id as string,
        dto,
      );

      return res.status(200).json({
        success: true,
        message: 'Automation updated successfully',
        data: {
          automation,
        },
      });
    } catch (error) {
      if (error instanceof Error && error.message === 'AUTOMATION_NOT_FOUND') {
        return res.status(404).json({
          success: false,
          message: 'Automation not found',
        });
      }

      const message = error instanceof Error ? error.message : 'Failed to update automation';
      return res.status(400).json({
        success: false,
        message,
      });
    }
  }

  async toggle(req: AuthenticatedRequest, res: Response) {
    try {
      const result = await automationService.toggleAutomation(
        req.userId!,
        req.params.id as string,
      );

      return res.status(200).json({
        success: true,
        message: `Automation ${result.status.toLowerCase()} successfully`,
        data: result,
      });
    } catch (error) {
      if (error instanceof Error && error.message === 'AUTOMATION_NOT_FOUND') {
        return res.status(404).json({
          success: false,
          message: 'Automation not found',
        });
      }

      return res.status(500).json({
        success: false,
        message: 'Failed to toggle automation status',
      });
    }
  }

  async delete(req: AuthenticatedRequest, res: Response) {
    try {
      const result = await automationService.deleteAutomation(
        req.userId!,
        req.params.id as string,
      );

      return res.status(200).json(result);
    } catch (error) {
      if (error instanceof Error && error.message === 'AUTOMATION_NOT_FOUND') {
        return res.status(404).json({
          success: false,
          message: 'Automation not found',
        });
      }

      return res.status(500).json({
        success: false,
        message: 'Failed to delete automation',
      });
    }
  }

  async getLogs(req: AuthenticatedRequest, res: Response) {
    try {
      const limit = parseInt(req.query.limit as string, 10) || 50;
      const offset = parseInt(req.query.offset as string, 10) || 0;

      const result = await automationService.getAutomationLogs(
        req.userId!,
        req.params.id as string,
        limit,
        offset,
      );

      return res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      if (error instanceof Error && error.message === 'AUTOMATION_NOT_FOUND') {
        return res.status(404).json({
          success: false,
          message: 'Automation not found',
        });
      }

      return res.status(500).json({
        success: false,
        message: 'Failed to retrieve automation execution logs',
      });
    }
  }

  async getAnalytics(req: AuthenticatedRequest, res: Response) {
    try {
      const overview = await automationService.getAnalyticsOverview(req.userId!);

      return res.status(200).json({
        success: true,
        data: overview,
      });
    } catch (error) {
      console.error('Analytics overview error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to retrieve automation analytics',
      });
    }
  }
}

export default new AutomationController();
