import prisma from '../../config/database';
import {
  CreateAutomationDto,
  UpdateAutomationDto,
  AutomationFilterQuery,
} from './automation.types';

export class AutomationService {
  /**
   * List automations for the authenticated user with optional filters.
   */
  async listAutomations(userId: string, filters: AutomationFilterQuery = {}) {
    const whereClause: any = { userId };

    if (filters.channelType) {
      whereClause.channelType = filters.channelType;
    }

    if (filters.whatsAppChannelId) {
      whereClause.whatsAppChannelId = filters.whatsAppChannelId;
    }

    if (filters.status) {
      whereClause.status = filters.status;
    }

    if (filters.triggerType) {
      whereClause.triggerType = filters.triggerType;
    }

    if (filters.search) {
      whereClause.OR = [
        { name: { contains: filters.search, mode: 'insensitive' } },
        { description: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    const automations = await prisma.automation.findMany({
      where: whereClause,
      include: {
        whatsAppChannel: {
          select: {
            id: true,
            phoneNumber: true,
            name: true,
            jid: true,
            status: true,
          },
        },
        steps: {
          orderBy: { order: 'asc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return automations.map((a: any) => {
      const successRate =
        a.totalRuns > 0
          ? Math.round((a.successRuns / a.totalRuns) * 100)
          : 100;

      return {
        ...a,
        successRate: `${successRate}%`,
      };
    });
  }

  /**
   * Get an automation by ID with its execution logs.
   */
  async getAutomationById(userId: string, id: string) {
    const automation = await prisma.automation.findFirst({
      where: { id, userId },
      include: {
        whatsAppChannel: {
          select: {
            id: true,
            phoneNumber: true,
            name: true,
            jid: true,
            status: true,
          },
        },
        steps: {
          orderBy: { order: 'asc' },
        },
        logs: {
          take: 20,
          orderBy: { executedAt: 'desc' },
        },
      },
    });

    if (!automation) {
      throw new Error('AUTOMATION_NOT_FOUND');
    }

    const successRate =
      automation.totalRuns > 0
        ? Math.round((automation.successRuns / automation.totalRuns) * 100)
        : 100;

    return {
      ...automation,
      successRate: `${successRate}%`,
    };
  }

  /**
   * Create a new automation with configured action steps.
   */
  async createAutomation(userId: string, dto: CreateAutomationDto) {
    if (!dto.name || !dto.name.trim()) {
      throw new Error('Automation name is required');
    }

    if (!dto.triggerType) {
      throw new Error('Trigger type is required');
    }

    const channelType = 'WHATSAPP';
    let targetWhatsAppChannelId: string | null = null;

    if (dto.whatsAppChannelId) {
      const waChannel = await prisma.whatsAppChannel.findFirst({
        where: { id: dto.whatsAppChannelId, userId },
      });
      if (!waChannel) {
        throw new Error('WHATSAPP_CHANNEL_NOT_FOUND');
      }
      targetWhatsAppChannelId = waChannel.id;
    }

    return prisma.$transaction(async (tx: any) => {
      const automation = await tx.automation.create({
        data: {
          userId,
          channelType,
          whatsAppChannelId: targetWhatsAppChannelId,
          name: dto.name.trim(),
          description: dto.description?.trim() || null,
          triggerType: dto.triggerType,
          matchType: dto.matchType || 'CONTAINS',
          keywords: dto.keywords || [],
          status: dto.status || 'ACTIVE',
        },
      });

      if (Array.isArray(dto.steps) && dto.steps.length > 0) {
        await tx.automationStep.createMany({
          data: dto.steps.map((step, idx) => ({
            automationId: automation.id,
            order: typeof step.order === 'number' ? step.order : idx,
            stepType: step.stepType,
            content: step.content as any,
          })),
        });
      }

      return tx.automation.findUnique({
        where: { id: automation.id },
        include: {
          whatsAppChannel: {
            select: {
              id: true,
              phoneNumber: true,
              name: true,
              jid: true,
              status: true,
            },
          },
          steps: { orderBy: { order: 'asc' } },
        },
      });
    });
  }

  /**
   * Update an existing automation.
   */
  async updateAutomation(userId: string, id: string, dto: UpdateAutomationDto) {
    const existing = await prisma.automation.findFirst({
      where: { id, userId },
    });

    if (!existing) {
      throw new Error('AUTOMATION_NOT_FOUND');
    }

    const channelType = 'WHATSAPP';
    let targetWhatsAppChannelId = dto.whatsAppChannelId !== undefined ? dto.whatsAppChannelId : (existing as any).whatsAppChannelId;

    if (dto.whatsAppChannelId) {
      const waChannel = await prisma.whatsAppChannel.findFirst({
        where: { id: dto.whatsAppChannelId, userId },
      });
      if (!waChannel) {
        throw new Error('WHATSAPP_CHANNEL_NOT_FOUND');
      }
      targetWhatsAppChannelId = waChannel.id;
    }

    return prisma.$transaction(async (tx: any) => {
      await tx.automation.update({
        where: { id },
        data: {
          channelType,
          name: dto.name !== undefined ? dto.name.trim() : undefined,
          description: dto.description !== undefined ? dto.description.trim() : undefined,
          whatsAppChannelId: targetWhatsAppChannelId,
          triggerType: dto.triggerType !== undefined ? dto.triggerType : undefined,
          matchType: dto.matchType !== undefined ? dto.matchType : undefined,
          keywords: dto.keywords !== undefined ? dto.keywords : undefined,
          status: dto.status !== undefined ? dto.status : undefined,
        },
      });

      // If new steps array provided, replace steps in order
      if (Array.isArray(dto.steps)) {
        await tx.automationStep.deleteMany({ where: { automationId: id } });
        await tx.automationStep.createMany({
          data: dto.steps.map((step, idx) => ({
            automationId: id,
            order: typeof step.order === 'number' ? step.order : idx,
            stepType: step.stepType,
            content: step.content as any,
          })),
        });
      }

      return tx.automation.findUnique({
        where: { id },
        include: {
          whatsAppChannel: {
            select: {
              id: true,
              phoneNumber: true,
              name: true,
              jid: true,
              status: true,
            },
          },
          steps: { orderBy: { order: 'asc' } },
        },
      });
    });
  }

  /**
   * Fast toggle an automation between ACTIVE and PAUSED.
   */
  async toggleAutomation(userId: string, id: string) {
    const automation = await prisma.automation.findFirst({
      where: { id, userId },
    });

    if (!automation) {
      throw new Error('AUTOMATION_NOT_FOUND');
    }

    const nextStatus = automation.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE';

    return prisma.automation.update({
      where: { id },
      data: { status: nextStatus },
      select: {
        id: true,
        name: true,
        status: true,
      },
    });
  }

  /**
   * Delete an automation and its cascaded logs & steps.
   */
  async deleteAutomation(userId: string, id: string) {
    const automation = await prisma.automation.findFirst({
      where: { id, userId },
    });

    if (!automation) {
      throw new Error('AUTOMATION_NOT_FOUND');
    }

    await prisma.automation.delete({
      where: { id },
    });

    return {
      success: true,
      message: 'Automation deleted successfully',
    };
  }

  /**
   * Get paginated logs for an automation.
   */
  async getAutomationLogs(userId: string, id: string, limit: number = 50, offset: number = 0) {
    const automation = await prisma.automation.findFirst({
      where: { id, userId },
    });

    if (!automation) {
      throw new Error('AUTOMATION_NOT_FOUND');
    }

    const [logs, total] = await Promise.all([
      prisma.automationLog.findMany({
        where: { automationId: id },
        take: limit,
        skip: offset,
        orderBy: { executedAt: 'desc' },
      }),
      prisma.automationLog.count({
        where: { automationId: id },
      }),
    ]);

    return {
      logs,
      total,
      limit,
      offset,
    };
  }

  /**
   * Analytics overview for the user's automations dashboard.
   */
  async getAnalyticsOverview(userId: string) {
    const automations = await prisma.automation.findMany({
      where: { userId },
      select: {
        id: true,
        name: true,
        channelType: true,
        triggerType: true,
        status: true,
        totalRuns: true,
        successRuns: true,
        failedRuns: true,
      },
    });

    const totalAutomations = automations.length;
    const activeAutomations = automations.filter((a: any) => a.status === 'ACTIVE').length;
    const pausedAutomations = automations.filter((a: any) => a.status === 'PAUSED').length;
    const whatsAppAutomations = automations.filter((a: any) => a.channelType === 'WHATSAPP').length;

    let totalRuns = 0;
    let totalSuccess = 0;
    let totalFailed = 0;

    for (const a of automations) {
      totalRuns += a.totalRuns;
      totalSuccess += a.successRuns;
      totalFailed += a.failedRuns;
    }

    const overallSuccessRate =
      totalRuns > 0 ? `${Math.round((totalSuccess / totalRuns) * 100)}%` : '100%';

    const topAutomations = [...automations]
      .sort((a, b) => b.totalRuns - a.totalRuns)
      .slice(0, 5);

    return {
      totalAutomations,
      activeAutomations,
      pausedAutomations,
      whatsAppAutomations,
      totalRuns,
      totalSuccess,
      totalFailed,
      overallSuccessRate,
      topAutomations,
    };
  }
}

export default new AutomationService();
