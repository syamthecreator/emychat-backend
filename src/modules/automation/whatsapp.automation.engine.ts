import prisma from '../../config/database';
import whatsAppService from '../whatsapp/whatsapp.service';
import { StepContent, MatchType } from './automation.types';
import { WhatsAppListSection, WhatsAppButton } from '../whatsapp/whatsapp.types';

export interface InboundWhatsAppMessageEvent {
  channelId: string;
  userId: string;
  senderJid: string;
  text: string;
  messageId: string;
  pushName?: string;
  mediaUrl?: string;
  mediaType?: 'image' | 'video' | 'audio' | 'document';
  profilePic?: string;
  resolvedPhone?: string;
}

export interface LeadCaptureQuestion {
  key: string;
  prompt: string;
}

export interface LeadCaptureSession {
  contactId?: string;
  channelId: string;
  userId: string;
  senderJid: string;
  stepIndex: number;
  questions: LeadCaptureQuestion[];
  collected: Record<string, string>;
  createdAt: number;
}

export class WhatsAppAutomationEngine {
  private recentSenderTimestamps = new Map<string, number>();
  private leadSessions = new Map<string, LeadCaptureSession>();

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Main entrypoint: Process an incoming WhatsApp message received via Baileys socket.
   */
  async processInboundMessage(event: InboundWhatsAppMessageEvent): Promise<void> {
    const { channelId, userId, senderJid, text, messageId, pushName, mediaUrl, mediaType, profilePic, resolvedPhone } = event;

    if (!senderJid || !messageId) {
      return;
    }

    // --- Deduplication Safeguard ---
    const alreadyProcessed = await prisma.processedWebhookEvent.findUnique({
      where: { id: messageId },
    });
    if (alreadyProcessed) {
      return;
    }

    // Mark as processed immediately to prevent duplicate runs
    await prisma.processedWebhookEvent.create({
      data: { id: messageId },
    }).catch(() => {});

    // --- Flood Protection: Don't trigger back-to-back automations within 3s for the same sender ---
    const now = Date.now();
    const lastSenderTime = this.recentSenderTimestamps.get(senderJid) || 0;
    if (now - lastSenderTime < 3000) {
      console.log(`[WhatsApp Automation] Skipping message from ${senderJid} (cooldown active)`);
      return;
    }
    this.recentSenderTimestamps.set(senderJid, now);

    // --- Extract Phone Number ---
    const rawNumber = resolvedPhone || senderJid.replace(/[^0-9]/g, '');
    const displayText = text || (mediaType ? `[${mediaType.toUpperCase()}]` : '');

    // --- Upsert WhatsApp Contact ---
    let contact: any = null;
    try {
      contact = await prisma.whatsAppContact.upsert({
        where: {
          channelId_jid: {
            channelId,
            jid: senderJid,
          },
        },
        update: {
          name: pushName || undefined,
          phoneNumber: resolvedPhone || undefined,
          profilePic: profilePic || undefined,
          lastMessageText: displayText,
          lastMessageType: mediaType ? mediaType.toUpperCase() : 'TEXT',
          lastMessageAt: new Date(),
          lastInteractionAt: new Date(),
          unreadCount: { increment: 1 },
        },
        create: {
          channelId,
          jid: senderJid,
          phoneNumber: rawNumber,
          name: pushName || null,
          profilePic: profilePic || null,
          lastMessageText: displayText,
          lastMessageType: mediaType ? mediaType.toUpperCase() : 'TEXT',
          lastMessageAt: new Date(),
          lastInteractionAt: new Date(),
          unreadCount: 1,
        },
      });

      // Record inbound message
      await prisma.whatsAppMessage.create({
        data: {
          channelId,
          contactId: contact.id,
          direction: 'INBOUND',
          messageType: mediaType ? mediaType.toUpperCase() : 'TEXT',
          text: text || null,
          mediaUrl: mediaUrl || null,
          mediaType: mediaType || null,
          waMessageId: messageId,
          status: 'DELIVERED',
        },
      });
    } catch (contactErr) {
      console.error('[WhatsApp Automation] Failed to upsert contact/message:', contactErr);
    }

    // --- Conversational Lead Capture State Machine Check ---
    const sessionKey = `${channelId}:${senderJid}`;
    const activeLeadSession = this.leadSessions.get(sessionKey);

    if (activeLeadSession && text && text.trim()) {
      const lower = text.trim().toLowerCase();
      // Allow cancellation / escape hatch
      if (lower === 'cancel' || lower === 'stop' || lower === 'menu') {
        this.leadSessions.delete(sessionKey);
        await whatsAppService.sendMessage(userId, channelId, {
          to: senderJid,
          text: 'Demo booking cancelled. Send "hi" anytime to view the menu.',
        });
        return;
      }

      await this.handleLeadCaptureTurn(
        activeLeadSession,
        text.trim(),
        userId,
        channelId,
        senderJid,
        contact,
      );
      return;
    }

    // --- Check if this is the first interaction from this contact ---
    let isFirstMessage = false;
    if (contact) {
      const messageCount = await prisma.whatsAppMessage.count({
        where: { contactId: contact.id, direction: 'INBOUND' },
      });
      isFirstMessage = messageCount <= 1;
    }

    // --- Find Active WhatsApp Automations for this Channel or User Workspace ---
    const automations = await prisma.automation.findMany({
      where: {
        status: 'ACTIVE',
        channelType: 'WHATSAPP',
        OR: [
          { whatsAppChannelId: channelId },
          { whatsAppChannelId: null, userId },
        ],
      },
      include: {
        steps: {
          orderBy: { order: 'asc' },
        },
      },
    });

    let matchedAutomation: any = null;

    if (automations && automations.length > 0) {
      // 1. Check DM_KEYWORD triggers
      if (text && text.trim()) {
        matchedAutomation = automations.find((a: any) => {
          if (a.triggerType !== 'DM_KEYWORD') return false;
          return this.isKeywordMatch(text, a.keywords, a.matchType);
        });
      }

      // 2. Check WELCOME_MESSAGE trigger (if first contact)
      if (!matchedAutomation && isFirstMessage) {
        matchedAutomation = automations.find((a: any) => a.triggerType === 'WELCOME_MESSAGE');
      }

      // 3. Check FALLBACK_DEFAULT trigger (if configured and no other match)
      if (!matchedAutomation && text && text.trim()) {
        matchedAutomation = automations.find((a: any) => a.triggerType === 'FALLBACK_DEFAULT');
      }
    }

    // --- Execute Matched Database Automation ---
    if (matchedAutomation) {
      console.log(`[WhatsApp Automation] Matched automation "${matchedAutomation.name}" (${matchedAutomation.triggerType}) for +${rawNumber}`);
      await this.executeWhatsAppAutomation(
        matchedAutomation,
        userId,
        channelId,
        rawNumber,
        senderJid,
        contact?.id,
        pushName,
        { text, messageId, trigger: matchedAutomation.triggerType },
      );
      return;
    }

    // --- Built-in Fallback Funnel (Matching Mighty Chat Video Flow) ---
    if (text && text.trim()) {
      const normalized = text.trim().toUpperCase();

      // Flow 1: Book Demo Trigger
      if (
        normalized === 'BOOK_DEMO' ||
        normalized === 'BOOK A DEMO' ||
        normalized === 'DEMO'
      ) {
        await this.startLeadCaptureSession(channelId, senderJid, userId, contact);
        return;
      }

      // Flow 2: Download Brochure Trigger
      if (
        normalized === 'DOWNLOAD_BROCHURE' ||
        normalized === 'BROCHURE' ||
        normalized === 'DOWNLOAD'
      ) {
        await this.sendBrochureDelivery(userId, channelId, senderJid);
        return;
      }

      // Flow 3: Talk to an Agent Trigger
      if (
        normalized === 'TALK_TO_AGENT' ||
        normalized === 'AGENT' ||
        normalized === 'SUPPORT'
      ) {
        await this.sendAgentSelectionMenu(userId, channelId, senderJid);
        return;
      }

      // Flow 4: Agent Selection Handover (e.g. AGENT_BINDU)
      if (normalized.startsWith('AGENT_')) {
        await this.handleAgentSelection(userId, channelId, senderJid, contact, normalized);
        return;
      }

      // Flow 5: Default Auto Welcome & Interactive Menu
      const greetingKeywords = ['HI', 'HELLO', 'HEY', 'START', 'MENU', 'INFO', 'EMYCHAT'];
      if (isFirstMessage || greetingKeywords.includes(normalized)) {
        await this.sendAutoWelcomeAndMenu(userId, channelId, senderJid, contact);
        return;
      }
    }
  }

  /**
   * Execute steps sequentially with strict Anti-Ban safeguards.
   */
  private async executeWhatsAppAutomation(
    automation: any,
    userId: string,
    channelId: string,
    phoneNumber: string,
    senderJid: string,
    contactId?: string,
    contactName?: string,
    eventData?: any,
  ): Promise<void> {
    try {
      for (const step of automation.steps) {
        const content = (step.content || {}) as StepContent;

        // Step 1: Delay
        if (step.stepType === 'DELAY') {
          const delaySeconds = Math.min(Math.max(content.delaySeconds || 2, 1), 30);
          console.log(`[WhatsApp Automation] Executing DELAY (${delaySeconds}s)...`);
          await this.sleep(delaySeconds * 1000);
        }

        // Step 2: Send DM / Text Message
        else if (step.stepType === 'SEND_DM' || step.stepType === 'SEND_MESSAGE') {
          if (content.text) {
            const personalizedText = this.interpolateVariables(content.text, contactName);
            const sendResult = await whatsAppService.sendMessage(userId, channelId, {
              to: senderJid,
              text: personalizedText,
            });

            if (sendResult.messageId) {
              await prisma.processedWebhookEvent.create({
                data: { id: sendResult.messageId },
              }).catch(() => {});
            }

            if (contactId) {
              await prisma.whatsAppMessage.create({
                data: {
                  channelId,
                  contactId,
                  direction: 'OUTBOUND',
                  messageType: 'TEXT',
                  text: personalizedText,
                  waMessageId: sendResult.messageId || null,
                  status: 'DELIVERED',
                },
              }).catch(() => {});

              await prisma.whatsAppContact.update({
                where: { id: contactId },
                data: {
                  lastMessageText: personalizedText,
                  lastMessageType: 'TEXT',
                  lastMessageAt: new Date(),
                  lastInteractionAt: new Date(),
                },
              }).catch(() => {});
            }
          }
        }

        // Step 3: Send Media (Image, Video, Audio, Document / PDF)
        else if (step.stepType === 'SEND_MEDIA') {
          if (content.mediaUrl) {
            const caption = content.caption
              ? this.interpolateVariables(content.caption, contactName)
              : undefined;

            const sendResult = await whatsAppService.sendMessage(userId, channelId, {
              to: senderJid,
              mediaUrl: content.mediaUrl,
              mediaType: content.mediaType || 'image',
              fileName: (content as any).fileName || (content.mediaType === 'document' ? 'Brochure.pdf' : undefined),
              mimetype: (content as any).mimetype || (content.mediaType === 'document' ? 'application/pdf' : undefined),
              caption,
            });

            if (sendResult.messageId) {
              await prisma.processedWebhookEvent.create({
                data: { id: sendResult.messageId },
              }).catch(() => {});
            }

            if (contactId) {
              await prisma.whatsAppMessage.create({
                data: {
                  channelId,
                  contactId,
                  direction: 'OUTBOUND',
                  messageType: (content.mediaType || 'image').toUpperCase(),
                  text: caption || null,
                  mediaUrl: content.mediaUrl,
                  mediaType: content.mediaType || 'image',
                  waMessageId: sendResult.messageId || null,
                  status: 'DELIVERED',
                },
              }).catch(() => {});
            }
          }
        }

        // Step 4: Quick Replies / Native Interactive Menus
        else if (step.stepType === 'QUICK_REPLIES') {
          if (content.text) {
            const personalizedText = this.interpolateVariables(content.text, contactName);
            const rawSections = (content as any).sections as WhatsAppListSection[] | undefined;
            const rawButtons = content.buttons;

            let sendResult: any;

            if (rawSections && rawSections.length > 0) {
              // Interactive List Bottom Sheet Menu
              sendResult = await whatsAppService.sendMessage(userId, channelId, {
                to: senderJid,
                title: (content as any).title || undefined,
                text: personalizedText,
                footer: (content as any).footer || undefined,
                buttonText: (content as any).buttonText || 'Select',
                sections: rawSections,
              });
            } else if (rawButtons && rawButtons.length > 0) {
              if (rawButtons.length <= 3) {
                // Interactive Quick Reply Buttons
                sendResult = await whatsAppService.sendMessage(userId, channelId, {
                  to: senderJid,
                  title: (content as any).title || undefined,
                  text: personalizedText,
                  footer: (content as any).footer || undefined,
                  buttons: rawButtons.map((b) => ({
                    buttonId: b.payload || b.title,
                    buttonText: b.title,
                  })),
                });
              } else {
                // More than 3 options: convert to interactive list menu
                sendResult = await whatsAppService.sendMessage(userId, channelId, {
                  to: senderJid,
                  title: (content as any).title || undefined,
                  text: personalizedText,
                  footer: (content as any).footer || undefined,
                  buttonText: (content as any).buttonText || 'Select an option',
                  sections: [
                    {
                      title: 'Options',
                      rows: rawButtons.map((b) => ({
                        rowId: b.payload || b.title,
                        title: b.title,
                        description: (b as any).description || '',
                      })),
                    },
                  ],
                });
              }
            } else {
              // Standard text dispatch
              sendResult = await whatsAppService.sendMessage(userId, channelId, {
                to: senderJid,
                text: personalizedText,
              });
            }

            if (sendResult?.messageId) {
              await prisma.processedWebhookEvent.create({
                data: { id: sendResult.messageId },
              }).catch(() => {});
            }

            if (contactId) {
              await prisma.whatsAppMessage.create({
                data: {
                  channelId,
                  contactId,
                  direction: 'OUTBOUND',
                  messageType: 'QUICK_REPLY',
                  text: personalizedText,
                  waMessageId: sendResult?.messageId || null,
                  status: 'DELIVERED',
                },
              }).catch(() => {});
            }
          }
        }

        // Step 5: Add Tag to Contact
        else if (step.stepType === 'ADD_TAG' && content.tag && contactId) {
          try {
            const currentContact = await prisma.whatsAppContact.findUnique({
              where: { id: contactId },
              select: { tags: true },
            });
            if (currentContact && !currentContact.tags.includes(content.tag)) {
              await prisma.whatsAppContact.update({
                where: { id: contactId },
                data: {
                  tags: [...currentContact.tags, content.tag],
                },
              });
            }
          } catch (tagErr) {
            console.error('[WhatsApp Automation] Failed to add tag to contact:', tagErr);
          }
        }
      }

      // Record Success Log & Increment Automation Run Stats
      await prisma.$transaction([
        prisma.automationLog.create({
          data: {
            automationId: automation.id,
            contactId: senderJid || phoneNumber,
            channelType: 'WHATSAPP',
            eventData,
            status: 'SUCCESS',
          },
        }),
        prisma.automation.update({
          where: { id: automation.id },
          data: {
            totalRuns: { increment: 1 },
            successRuns: { increment: 1 },
          },
        }),
      ]);

      console.log(`[WhatsApp Automation] Successfully executed "${automation.name}" for +${phoneNumber}`);
    } catch (error) {
      console.error(`[WhatsApp Automation] Failed to execute "${automation.name}":`, error);
      const errMsg = error instanceof Error ? error.message : String(error);

      // Record Failure Log & Increment Failed Stats
      await prisma.$transaction([
        prisma.automationLog.create({
          data: {
            automationId: automation.id,
            contactId: senderJid || phoneNumber,
            channelType: 'WHATSAPP',
            eventData,
            status: 'FAILED',
            errorMessage: errMsg,
          },
        }),
        prisma.automation.update({
          where: { id: automation.id },
          data: {
            totalRuns: { increment: 1 },
            failedRuns: { increment: 1 },
          },
        }),
      ]).catch(() => {});
    }
  }

  /**
   * Variable interpolation (e.g. {{name}} -> Contact Name).
   */
  private interpolateVariables(text: string, contactName?: string): string {
    const name = contactName || 'there';
    return text.replace(/\{\{name\}\}/gi, name).replace(/\{name\}/gi, name);
  }

  /**
   * Robust keyword matching algorithm.
   */
  private isKeywordMatch(
    incomingText: string,
    keywords: string[],
    matchType: MatchType = 'CONTAINS',
  ): boolean {
    if (!keywords || keywords.length === 0) {
      return false;
    }

    const text = incomingText.trim().toLowerCase();
    const cleanKeywords = keywords.map((k) => k.trim().toLowerCase()).filter(Boolean);

    if (cleanKeywords.length === 0) {
      return false;
    }

    switch (matchType) {
      case 'EXACT':
        return cleanKeywords.some((k) => text === k);

      case 'STARTS_WITH':
        return cleanKeywords.some((k) => text.startsWith(k));

      case 'ALL':
        return cleanKeywords.every((k) => text.includes(k));

      case 'CONTAINS':
      default:
        return cleanKeywords.some((k) => text.includes(k));
    }
  }

  /**
   * Step 1 & 2: Send Auto Welcome greeting with Native Interactive List Menu.
   */
  private async sendAutoWelcomeAndMenu(
    userId: string,
    channelId: string,
    senderJid: string,
    contact: any,
  ): Promise<void> {
    const pushName = contact?.name ? ` ${contact.name}` : '';
    await whatsAppService.sendMessage(userId, channelId, {
      to: senderJid,
      title: 'Mighty Chat',
      text: `Welcome${pushName}!\n\n🎯 Personalized Broadcasts & Campaigns\n🔄 Follow-Up Automation & Cart Recovery\n👥 Shared Team Inbox with Analytics\n\nHow can we help your business today?`,
      footer: 'Tap an item to select it',
      buttonText: 'Select',
      sections: [
        {
          title: 'Available Options',
          rows: [
            {
              rowId: 'BOOK_DEMO',
              title: '📅 Book a Demo',
              description: 'See Mighty Chat in action, live!',
            },
            {
              rowId: 'DOWNLOAD_BROCHURE',
              title: '📄 Download Brochure',
              description: 'Get a detailed overview of features.',
            },
            {
              rowId: 'TALK_TO_AGENT',
              title: '🗣️ Talk to an Agent',
              description: "Have questions? We're here to help.",
            },
          ],
        },
      ],
    });
  }

  /**
   * Step 3: Start interactive conversational Lead Capture session (Name -> Company -> Date/Time).
   */
  private async startLeadCaptureSession(
    channelId: string,
    senderJid: string,
    userId: string,
    contact: any,
  ): Promise<void> {
    const sessionKey = `${channelId}:${senderJid}`;
    const session: LeadCaptureSession = {
      contactId: contact?.id,
      channelId,
      userId,
      senderJid,
      stepIndex: 0,
      questions: [
        { key: 'name', prompt: '1️⃣ Your Full Name' },
        { key: 'company', prompt: '2️⃣ Company Name' },
        { key: 'preferredDateTime', prompt: '3️⃣ Preferred Date & Time for the Demo' },
      ],
      collected: {},
      createdAt: Date.now(),
    };

    this.leadSessions.set(sessionKey, session);

    // Prompt first question
    await whatsAppService.sendMessage(userId, channelId, {
      to: senderJid,
      text: session.questions[0].prompt,
    });
  }

  /**
   * Handle turn-by-turn question answering in the Lead Capture state machine.
   */
  private async handleLeadCaptureTurn(
    session: LeadCaptureSession,
    userReply: string,
    userId: string,
    channelId: string,
    senderJid: string,
    contact: any,
  ): Promise<void> {
    const currentQuestion = session.questions[session.stepIndex];
    if (currentQuestion) {
      session.collected[currentQuestion.key] = userReply;
    }

    session.stepIndex += 1;

    // Check if more questions remain
    if (session.stepIndex < session.questions.length) {
      const nextQuestion = session.questions[session.stepIndex];
      await whatsAppService.sendMessage(userId, channelId, {
        to: senderJid,
        text: nextQuestion.prompt,
      });
      return;
    }

    // All questions completed!
    const sessionKey = `${channelId}:${senderJid}`;
    this.leadSessions.delete(sessionKey);

    const leadName = session.collected.name || contact?.name || 'Customer';
    const company = session.collected.company || 'N/A';
    const demoTime = session.collected.preferredDateTime || 'Pending confirmation';

    // Persist lead details to Contact record
    if (contact?.id) {
      const existingNotes = contact.notes ? `${contact.notes}\n\n` : '';
      const newNote = `[Demo Booked - ${new Date().toLocaleDateString()}]\nName: ${leadName}\nCompany: ${company}\nPreferred Slot: ${demoTime}`;

      const existingTags = contact.tags || [];
      const newTags = Array.from(new Set([...existingTags, 'lead', 'demo_booked']));

      await prisma.whatsAppContact.update({
        where: { id: contact.id },
        data: {
          name: leadName,
          notes: `${existingNotes}${newNote}`.trim(),
          tags: newTags,
        },
      }).catch((err) => console.error('[WhatsApp Automation] Failed to update lead contact record:', err));
    }

    // Step 4 of 6: Send Details Received Confirmation
    await whatsAppService.sendMessage(userId, channelId, {
      to: senderJid,
      text: `✅ Thank you for the details provided!\n👉 Our team will connect with you to confirm the demo slot.`,
    });

    await this.sleep(1500);

    // Step 5 & 6 Follow-up: Offer Agent walkthrough or Brochure
    await whatsAppService.sendMessage(userId, channelId, {
      to: senderJid,
      text: `🤝 Would you like to speak with one of our product specialists for more details or a personalized walkthrough?`,
      buttons: [
        { buttonId: 'TALK_TO_AGENT', buttonText: 'Yes' },
        { buttonId: 'DOWNLOAD_BROCHURE', buttonText: 'Download Brochure' },
      ],
    });
  }

  /**
   * Step 5: Deliver downloadable PDF Brochure with rich caption.
   */
  private async sendBrochureDelivery(userId: string, channelId: string, senderJid: string): Promise<void> {
    await whatsAppService.sendMessage(userId, channelId, {
      to: senderJid,
      mediaUrl: 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf',
      mediaType: 'document',
      fileName: 'MightyChat_Features.pdf',
      caption: `📄 Here's your Mighty Chat Brochure!\n\nGet a complete overview of our features, benefits, and how Mighty Chat can supercharge your WhatsApp engagement.`,
    });
  }

  /**
   * Step 6: Send Agent Selection Interactive List Menu.
   */
  private async sendAgentSelectionMenu(userId: string, channelId: string, senderJid: string): Promise<void> {
    await whatsAppService.sendMessage(userId, channelId, {
      to: senderJid,
      title: 'Mighty Chat',
      text: `🗣️ Great! Connecting you to a product specialist now...\n\nPlease select your agent by preference:`,
      buttonText: 'Agents Below:',
      sections: [
        {
          title: 'Available Specialists',
          rows: [
            {
              rowId: 'AGENT_BINDU',
              title: 'Bindu',
              description: 'English / Malayalam / Hindi / Tamil',
            },
            {
              rowId: 'AGENT_RAHUL',
              title: 'Rahul',
              description: 'English / Hindi / Kannada',
            },
            {
              rowId: 'AGENT_SARAH',
              title: 'Sarah',
              description: 'English / Arabic / French',
            },
          ],
        },
      ],
    });
  }

  /**
   * Step 6 Handover: Assign chosen agent to Contact in Shared Inbox.
   */
  private async handleAgentSelection(
    userId: string,
    channelId: string,
    senderJid: string,
    contact: any,
    agentCode: string,
  ): Promise<void> {
    const rawName = agentCode.replace('AGENT_', '');
    const agentName = rawName.charAt(0).toUpperCase() + rawName.slice(1).toLowerCase();

    if (contact?.id) {
      const existingTags = contact.tags || [];
      const updatedTags = Array.from(new Set([...existingTags, `agent:${agentName.toLowerCase()}`]));
      await prisma.whatsAppContact.update({
        where: { id: contact.id },
        data: { tags: updatedTags },
      }).catch(() => {});
    }

    await whatsAppService.sendMessage(userId, channelId, {
      to: senderJid,
      text: `✅ Connected with ${agentName}!\n\nOur product specialist has been notified and will assist you shortly in this chat.`,
    });
  }
}

export default new WhatsAppAutomationEngine();
