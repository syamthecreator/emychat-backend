import QRCode from 'qrcode';
import pino from 'pino';
import fs from 'fs';
import path from 'path';
import { Prisma } from '@prisma/client';
import {
  WhatsAppSessionStatus,
  ConnectSessionResponse,
  SessionStatusResponse,
  SendWhatsAppMessageDto,
  SendWhatsAppMessageResponse,
} from './whatsapp.types';
import whatsappAutomationEngine from '../automation/whatsapp.automation.engine';
import prisma from '../../config/database';

interface ActiveSession {
  channelId: string;
  userId: string;
  socket?: any;
  status: WhatsAppSessionStatus;
  qrCodeBase64?: string;
  qrCodeString?: string;
  pairingCode?: string;
  pairingCodeGeneratedAt?: Date;
  pairingPhone?: string;
  qrGeneratedAt?: Date;
  reconnectAttempts: number;
  cleanupTimer?: NodeJS.Timeout;
  recentSentTimestamps: number[];
  lastSentAt?: number;
}

export class WhatsAppService {
  private sessions = new Map<string, ActiveSession>();
  private sessionsRoot = path.join(process.cwd(), 'sessions', 'whatsapp');
  private baileysModule: any = null;
  private persistTimers = new Map<string, NodeJS.Timeout>();

  constructor() {
    if (!fs.existsSync(this.sessionsRoot)) {
      fs.mkdirSync(this.sessionsRoot, { recursive: true });
    }
  }

  private async getBaileys() {
    if (!this.baileysModule) {
      // Dynamic import to satisfy CommonJS module loader without TS1479
      this.baileysModule = await (eval('import("@whiskeysockets/baileys")') as Promise<any>);
    }
    return this.baileysModule;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Persist current session authentication files from disk to PostgreSQL database.
   * Debounced to prevent redundant writes during rapid Baileys handshake cycles.
   */
  private queueSessionPersist(channelId: string): void {
    const existing = this.persistTimers.get(channelId);
    if (existing) clearTimeout(existing);

    this.persistTimers.set(
      channelId,
      setTimeout(() => {
        this.persistSessionToDb(channelId).catch((err) => {
          console.error(`[WhatsApp] Failed to persist session data for ${channelId}:`, err);
        });
        this.persistTimers.delete(channelId);
      }, 800)
    );
  }

  /**
   * Serializes all JSON credential files in the channel session folder into the database.
   */
  async persistSessionToDb(channelId: string): Promise<void> {
    try {
      const sessionDir = path.join(this.sessionsRoot, channelId);
      if (!fs.existsSync(sessionDir)) return;

      const fileNames = fs.readdirSync(sessionDir);
      const data: Record<string, string> = {};

      for (const fileName of fileNames) {
        if (fileName.endsWith('.json')) {
          const content = fs.readFileSync(path.join(sessionDir, fileName), 'utf-8');
          data[fileName] = content;
        }
      }

      if (Object.keys(data).length > 0) {
        await prisma.whatsAppChannel.update({
          where: { id: channelId },
          data: { sessionData: data },
        });
      }
    } catch (err) {
      console.error(`[WhatsApp] Error persisting session for channel ${channelId}:`, err);
    }
  }

  /**
   * Recreates the session authentication directory on disk from the serialized database record.
   */
  restoreSessionFromDb(channelId: string, sessionData: any): boolean {
    try {
      if (!sessionData || typeof sessionData !== 'object') return false;

      const sessionDir = path.join(this.sessionsRoot, channelId);
      if (!fs.existsSync(sessionDir)) {
        fs.mkdirSync(sessionDir, { recursive: true });
      }

      const entries = Object.entries(sessionData);
      if (entries.length === 0) return false;

      for (const [fileName, content] of entries) {
        if (typeof content === 'string') {
          fs.writeFileSync(path.join(sessionDir, fileName), content, 'utf-8');
        }
      }

      console.log(`[WhatsApp] Restored ${entries.length} auth files from DB for channel ${channelId}`);
      return true;
    } catch (err) {
      console.error(`[WhatsApp] Error restoring session for channel ${channelId}:`, err);
      return false;
    }
  }

  /**
   * Automatically restore active WhatsApp sessions on server launch.
   * Restores from PostgreSQL if container disk was wiped (e.g. Render redeploy).
   */
  async restoreActiveSessions(): Promise<void> {
    try {
      const activeChannels = await prisma.whatsAppChannel.findMany({
        where: { status: 'CONNECTED' },
      });

      console.log(`[WhatsApp] Restoring ${activeChannels.length} active sessions...`);

      for (const channel of activeChannels) {
        const sessionDir = path.join(this.sessionsRoot, channel.id);
        const hasLocalFiles = fs.existsSync(sessionDir) && fs.readdirSync(sessionDir).length > 0;

        let canRestore = hasLocalFiles;
        if (!canRestore && channel.sessionData) {
          canRestore = this.restoreSessionFromDb(channel.id, channel.sessionData);
        }

        if (canRestore) {
          this.initSocket(channel.userId, channel.id).catch((err) => {
            console.error(`[WhatsApp] Failed to restore session for channel ${channel.id}:`, err);
          });
        } else {
          await prisma.whatsAppChannel.update({
            where: { id: channel.id },
            data: { status: 'DISCONNECTED' },
          });
        }
      }
    } catch (e) {
      console.error('[WhatsApp] Failed to restore sessions on startup:', e);
    }
  }

  /**
   * List all connected or pending WhatsApp channels for a user.
   */
  async getChannels(userId: string) {
    const channels = await prisma.whatsAppChannel.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });

    return channels.map((c: any) => {
      const session = this.sessions.get(c.id);
      const isSocketActive = !!(session && session.status === 'CONNECTED' && session.socket);
      return {
        id: c.id,
        userId: c.userId,
        phoneNumber: c.phoneNumber,
        jid: c.jid,
        name: c.name,
        profilePic: c.profilePic,
        status: isSocketActive ? 'CONNECTED' : (c.status === 'CONNECTED' ? 'DISCONNECTED' : c.status),
        connectedAt: c.connectedAt,
        createdAt: c.createdAt,
        isSocketActive,
      };
    });
  }

  /**
   * Fetches a contact's real profile picture URL from WhatsApp servers via Baileys socket.
   */
  async fetchContactProfilePic(channelId: string, jid: string): Promise<string | null> {
    const session = this.sessions.get(channelId);
    if (!session?.socket) return null;

    const sock = session.socket;

    // 1. Try high-resolution 'image' directly on the JID
    try {
      const url = await sock.profilePictureUrl(jid, 'image');
      if (url) return url;
    } catch (_) {}

    // 2. Try low-resolution 'preview' on the JID
    try {
      const url = await sock.profilePictureUrl(jid, 'preview');
      if (url) return url;
    } catch (_) {}

    // 3. If JID is an @lid, try reverse-resolving to PN (phone number) JID
    if (jid.endsWith('@lid') && sock.signalRepository?.lidMapping?.getPNForLID) {
      try {
        const pnJid = await sock.signalRepository.lidMapping.getPNForLID(jid);
        if (pnJid) {
          try {
            const url = await sock.profilePictureUrl(pnJid, 'image');
            if (url) return url;
          } catch (_) {}
          try {
            const url = await sock.profilePictureUrl(pnJid, 'preview');
            if (url) return url;
          } catch (_) {}
        }
      } catch (_) {}
    }

    return null;
  }

  /**
   * Syncs profile pictures and resolved phone numbers for all contacts of user's active WhatsApp channels.
   */
  async syncContactsProfilePics(userId: string): Promise<number> {
    const channels = await prisma.whatsAppChannel.findMany({
      where: { userId, status: 'CONNECTED' },
      select: { id: true },
    });

    let updatedCount = 0;
    for (const channel of channels) {
      const contacts = await prisma.whatsAppContact.findMany({
        where: { channelId: channel.id },
      });

      for (const contact of contacts) {
        try {
          const picUrl = await this.fetchContactProfilePic(channel.id, contact.jid);
          const dataToUpdate: any = {};
          if (picUrl && picUrl !== contact.profilePic) {
            dataToUpdate.profilePic = picUrl;
          }

          // If JID is an @lid and current phoneNumber looks like LID digits (15+ chars), attempt to resolve real PN
          if (contact.jid.endsWith('@lid')) {
            const session = this.sessions.get(channel.id);
            if (session?.socket?.signalRepository?.lidMapping?.getPNForLID) {
              const pnJid = await session.socket.signalRepository.lidMapping.getPNForLID(contact.jid);
              if (pnJid) {
                const pn = pnJid.split('@')[0].split(':')[0];
                if (pn && pn !== contact.phoneNumber) {
                  dataToUpdate.phoneNumber = pn;
                }
              }
            }
          }

          if (Object.keys(dataToUpdate).length > 0) {
            await prisma.whatsAppContact.update({
              where: { id: contact.id },
              data: dataToUpdate,
            });
            updatedCount++;
            console.log(`[WhatsApp] Synced contact ${contact.name || contact.phoneNumber}:`, dataToUpdate);
          }
        } catch (err) {
          console.error(`[WhatsApp] Failed to sync contact ${contact.jid}:`, err);
        }
      }
    }
    return updatedCount;
  }

  /**
   * Initialize a new WhatsApp Web QR session or pairing code session.
   */
  async startSession(
    userId: string,
    existingChannelId?: string,
    phoneNumber?: string,
  ): Promise<ConnectSessionResponse> {
    let targetChannelId: string;

    if (existingChannelId) {
      targetChannelId = existingChannelId;
    } else {
      const existing = await prisma.whatsAppChannel.findFirst({
        where: { userId, status: 'CONNECTING' },
      });

      if (existing) {
        targetChannelId = existing.id;
      } else {
        const newChannel = await prisma.whatsAppChannel.create({
          data: {
            userId,
            status: 'CONNECTING',
          },
        });
        targetChannelId = newChannel.id;
      }
    }

    const session = this.sessions.get(targetChannelId);

    // If socket is already connected and active
    if (session?.status === 'CONNECTED' && session.socket) {
      const channel = await prisma.whatsAppChannel.findUnique({
        where: { id: targetChannelId },
      });
      return {
        channelId: targetChannelId,
        status: 'CONNECTED',
        channel: channel
          ? {
            id: channel.id,
            userId: channel.userId,
            phoneNumber: channel.phoneNumber,
            jid: channel.jid,
            name: channel.name,
            profilePic: channel.profilePic,
            status: channel.status,
            connectedAt: channel.connectedAt,
            createdAt: channel.createdAt,
            isSocketActive: true,
          }
          : undefined,
      };
    }

    // If an active pairing code session is already waiting for the same phone number (valid for 10 minutes)
    if (
      phoneNumber &&
      session?.status === 'SCAN_QR' &&
      session.pairingCode &&
      session.pairingPhone === phoneNumber.replace(/[^0-9]/g, '') &&
      session.pairingCodeGeneratedAt &&
      Date.now() - session.pairingCodeGeneratedAt.getTime() < 600000
    ) {
      return {
        channelId: targetChannelId,
        status: 'SCAN_QR',
        pairingCode: session.pairingCode,
        expiresInSeconds: 600,
      };
    }

    // If a session with a valid QR code is already waiting
    if (session?.status === 'SCAN_QR' && session.qrCodeBase64 && !phoneNumber) {
      return {
        channelId: targetChannelId,
        status: 'SCAN_QR',
        qrCodeBase64: session.qrCodeBase64,
        qrCodeString: session.qrCodeString,
        expiresInSeconds: 180,
      };
    }

    // Initialize fresh Baileys socket
    await this.initSocket(userId, targetChannelId, phoneNumber);

    // Wait briefly for handshake & initial QR / pairing code generation
    await this.sleep(1200);

    const updatedSession = this.sessions.get(targetChannelId);
    return {
      channelId: targetChannelId,
      status: updatedSession?.status || 'INITIALIZING',
      qrCodeBase64: updatedSession?.qrCodeBase64,
      qrCodeString: updatedSession?.qrCodeString,
      pairingCode: updatedSession?.pairingCode,
      expiresInSeconds: 180,
    };
  }

  /**
   * Poll current status of a session (used by frontend while waiting for scan).
   */
  async getSessionStatus(userId: string, channelId: string): Promise<SessionStatusResponse> {
    const channel = await prisma.whatsAppChannel.findUnique({
      where: { id: channelId },
    });

    if (!channel || channel.userId !== userId) {
      throw new Error('CHANNEL_NOT_FOUND');
    }

    const session = this.sessions.get(channelId);
    const isSocketActive = !!(session && session.socket && session.status === 'CONNECTED');

    if (channel.status === 'CONNECTED' && isSocketActive) {
      return {
        channelId,
        status: 'CONNECTED',
        channel: {
          id: channel.id,
          userId: channel.userId,
          phoneNumber: channel.phoneNumber,
          jid: channel.jid,
          name: channel.name,
          profilePic: channel.profilePic,
          status: 'CONNECTED',
          connectedAt: channel.connectedAt,
          createdAt: channel.createdAt,
          isSocketActive: true,
        },
      };
    }

    return {
      channelId,
      status: session?.status || (channel.status as WhatsAppSessionStatus) || 'INITIALIZING',
      qrCodeBase64: session?.qrCodeBase64,
      pairingCode: session?.pairingCode,
    };
  }

  /**
   * Gracefully disconnect and delete a WhatsApp channel.
   * Anti-ban safeguard: Clean logout prevents dangling ghost sessions on Meta servers.
   */
  async disconnectChannel(userId: string, channelId: string): Promise<void> {
    const channel = await prisma.whatsAppChannel.findUnique({
      where: { id: channelId },
    });

    if (!channel || channel.userId !== userId) {
      throw new Error('CHANNEL_NOT_FOUND');
    }

    const session = this.sessions.get(channelId);
    if (session?.cleanupTimer) {
      clearTimeout(session.cleanupTimer);
    }

    const persistTimer = this.persistTimers.get(channelId);
    if (persistTimer) {
      clearTimeout(persistTimer);
      this.persistTimers.delete(channelId);
    }

    if (session?.socket) {
      try {
        await session.socket.logout();
      } catch (_) {
        try {
          session.socket.end(new Error('User disconnected'));
        } catch (_) { }
      }
    }

    this.sessions.delete(channelId);

    // Delete session files from disk safely
    const sessionDir = path.join(this.sessionsRoot, channelId);
    if (fs.existsSync(sessionDir)) {
      fs.rmSync(sessionDir, { recursive: true, force: true });
    }

    // Delete channel from database
    await prisma.whatsAppChannel.delete({
      where: { id: channelId },
    });

    console.log(`[WhatsApp] Channel ${channelId} disconnected and cleaned up.`);
  }

  /**
   * Send an outbound WhatsApp text or media message with full Anti-Ban protections:
   * 1. JID pre-flight validation on WhatsApp (`sock.onWhatsApp`).
   * 2. Outbound rate limiting (max 20 msgs / min per channel).
   * 3. Inter-message cooldown delay (minimum 1.5s).
   * 4. Realistic human presence simulation (composing typing indicator).
   */
  async sendMessage(
    userId: string,
    channelId: string,
    dto: SendWhatsAppMessageDto,
  ): Promise<SendWhatsAppMessageResponse> {
    const channel = await prisma.whatsAppChannel.findUnique({
      where: { id: channelId },
    });

    if (!channel || channel.userId !== userId) {
      throw new Error('CHANNEL_NOT_FOUND');
    }

    const session = this.sessions.get(channelId);
    if (!session || session.status !== 'CONNECTED' || !session.socket) {
      throw new Error('WHATSAPP_NOT_CONNECTED');
    }

    const sock = session.socket;

    // --- Anti-Ban Safeguard: Outbound Rate Limiting ---
    const now = Date.now();
    session.recentSentTimestamps = (session.recentSentTimestamps || []).filter(
      (ts) => now - ts < 60000,
    );
    if (session.recentSentTimestamps.length >= 20) {
      throw new Error('RATE_LIMIT_EXCEEDED: Maximum 20 messages per minute permitted');
    }

    // --- Anti-Ban Safeguard: Inter-message Cooldown ---
    if (session.lastSentAt) {
      const elapsed = now - session.lastSentAt;
      if (elapsed < 1500) {
        await this.sleep(1500 - elapsed);
      }
    }

    // --- Format & Clean Recipient Number / JID ---
    let resolvedJid: string;
    const isLid = dto.to.includes('@lid');
    const isUserJid = dto.to.includes('@s.whatsapp.net');

    if (isLid || isUserJid) {
      resolvedJid = dto.to;
    } else {
      const cleanNumber = dto.to.replace(/[^0-9]/g, '');
      if (!cleanNumber || cleanNumber.length < 7) {
        throw new Error('INVALID_PHONE_NUMBER');
      }
      resolvedJid = `${cleanNumber}@s.whatsapp.net`;

      // --- Anti-Ban Safeguard: Pre-flight onWhatsApp Check for raw phone numbers ---
      try {
        const [onWa] = await sock.onWhatsApp(resolvedJid);
        if (onWa && onWa.exists === false) {
          throw new Error('NUMBER_NOT_REGISTERED_ON_WHATSAPP');
        }
        if (onWa?.jid) {
          resolvedJid = onWa.jid;
        }
      } catch (e: any) {
        if (e.message === 'NUMBER_NOT_REGISTERED_ON_WHATSAPP') {
          throw e;
        }
        // If network transient or privacy restriction, continue with resolvedJid
      }
    }

    // --- Anti-Ban Safeguard: Humanized Typing Indicator ---
    try {
      await sock.sendPresenceUpdate('composing', resolvedJid);
      // Realistic randomized typing delay (1000ms - 1800ms)
      await this.sleep(1000 + Math.floor(Math.random() * 800));
    } catch (_) { }

    // --- Dispatch Message ---
    let sentResult: any;

    if (dto.sections && dto.sections.length > 0) {
      // 1. Native Interactive List Menu (Bottom Sheet Popup)
      try {
        const baileys = await this.getBaileys();
        const listButtons = [
          {
            name: 'single_select',
            buttonParamsJson: JSON.stringify({
              title: dto.buttonText || 'Select an option',
              sections: dto.sections.map((sec) => ({
                title: sec.title || 'Options',
                rows: sec.rows.map((row) => ({
                  id: row.rowId,
                  title: row.title,
                  description: row.description || '',
                })),
              })),
            }),
          },
        ];

        const interactiveListMessage = {
          viewOnceMessage: {
            message: {
              interactiveMessage: {
                header: dto.title
                  ? { title: dto.title, hasMediaAttachment: false }
                  : undefined,
                body: { text: dto.text || 'Please select an option below:' },
                footer: dto.footer ? { text: dto.footer } : undefined,
                nativeFlowMessage: {
                  buttons: listButtons,
                },
              },
            },
          },
        };

        const waMsg = baileys.generateWAMessageFromContent(
          resolvedJid,
          interactiveListMessage,
          { userJid: sock.user?.id || resolvedJid },
        );
        await sock.relayMessage(resolvedJid, waMsg.message, {
          messageId: waMsg.key.id,
        });
        sentResult = waMsg;
      } catch (listErr) {
        console.warn('[WhatsApp] Native list relay failed, falling back to formatted list:', listErr);
        // Fallback: Clean formatted numbered list
        let fallbackText = dto.title ? `*${dto.title}*\n\n` : '';
        fallbackText += `${dto.text || 'Please select an option:'}\n\n`;
        dto.sections.forEach((sec) => {
          if (sec.title) fallbackText += `*${sec.title}*\n`;
          sec.rows.forEach((row, idx) => {
            fallbackText += `${idx + 1}️⃣ *${row.title}*${row.description ? ` - ${row.description}` : ''}\n`;
          });
          fallbackText += '\n';
        });
        if (dto.footer) fallbackText += `_${dto.footer}_`;
        sentResult = await sock.sendMessage(resolvedJid, { text: fallbackText.trim() });
      }
    } else if (dto.buttons && dto.buttons.length > 0) {
      // 2. Native Quick Reply Buttons
      try {
        const baileys = await this.getBaileys();
        const quickButtons = dto.buttons.map((btn) => ({
          name: 'quick_reply',
          buttonParamsJson: JSON.stringify({
            display_text: btn.buttonText,
            id: btn.buttonId,
          }),
        }));

        const interactiveButtonMessage = {
          viewOnceMessage: {
            message: {
              interactiveMessage: {
                header: dto.title
                  ? { title: dto.title, hasMediaAttachment: false }
                  : undefined,
                body: { text: dto.text || 'Please choose an option:' },
                footer: dto.footer ? { text: dto.footer } : undefined,
                nativeFlowMessage: {
                  buttons: quickButtons,
                },
              },
            },
          },
        };

        const waMsg = baileys.generateWAMessageFromContent(
          resolvedJid,
          interactiveButtonMessage,
          { userJid: sock.user?.id || resolvedJid },
        );
        await sock.relayMessage(resolvedJid, waMsg.message, {
          messageId: waMsg.key.id,
        });
        sentResult = waMsg;
      } catch (btnErr) {
        console.warn('[WhatsApp] Native buttons relay failed, falling back to formatted text:', btnErr);
        let fallbackText = dto.title ? `*${dto.title}*\n\n` : '';
        fallbackText += `${dto.text || 'Please choose an option:'}\n\n`;
        dto.buttons.forEach((btn, idx) => {
          fallbackText += `${idx + 1}️⃣ ${btn.buttonText}\n`;
        });
        if (dto.footer) fallbackText += `\n_${dto.footer}_`;
        sentResult = await sock.sendMessage(resolvedJid, { text: fallbackText.trim() });
      }
    } else if (dto.mediaUrl) {
      // 3. Media Dispatch (PDF / Images / Video / Audio)
      const mediaType = dto.mediaType || 'image';
      const messagePayload: any = { caption: dto.caption || dto.text || undefined };

      if (mediaType === 'image') {
        messagePayload.image = { url: dto.mediaUrl };
      } else if (mediaType === 'video') {
        messagePayload.video = { url: dto.mediaUrl };
      } else if (mediaType === 'audio') {
        messagePayload.audio = { url: dto.mediaUrl };
        messagePayload.mimetype = 'audio/mp4';
      } else {
        messagePayload.document = { url: dto.mediaUrl };
        messagePayload.mimetype = dto.mimetype || 'application/pdf';
        messagePayload.fileName = dto.fileName || 'Brochure.pdf';
      }

      sentResult = await sock.sendMessage(resolvedJid, messagePayload);
    } else {
      // 4. Standard Text Message
      if (!dto.text || !dto.text.trim()) {
        throw new Error('MESSAGE_TEXT_REQUIRED');
      }
      sentResult = await sock.sendMessage(resolvedJid, { text: dto.text });
    }

    // --- Clear Typing Indicator & Update Trackers ---
    try {
      await sock.sendPresenceUpdate('paused', resolvedJid);
    } catch (_) { }

    session.recentSentTimestamps.push(Date.now());
    session.lastSentAt = Date.now();

    const returnNumber = resolvedJid.split('@')[0].replace(/[^0-9]/g, '');
    return {
      success: true,
      messageId: sentResult?.key?.id,
      to: returnNumber,
      sentAt: new Date(),
    };
  }

  /**
   * Send a presence update (composing / paused) to a recipient JID via Baileys socket.
   */
  async sendPresence(
    channelId: string,
    toJid: string,
    presence: 'composing' | 'paused',
  ): Promise<void> {
    const session = this.sessions.get(channelId);
    if (session?.socket && session.status === 'CONNECTED') {
      try {
        await session.socket.sendPresenceUpdate(presence, toJid);
      } catch (_) {}
    }
  }

  /**
   * Mark WhatsApp messages as read (send read receipt) via Baileys socket.
   */
  async markMessagesRead(
    channelId: string,
    keys: Array<{ remoteJid: string; id: string }>,
  ): Promise<void> {
    const session = this.sessions.get(channelId);
    if (session?.socket && session.status === 'CONNECTED' && keys.length > 0) {
      try {
        await session.socket.readMessages(keys);
      } catch (_) {}
    }
  }

  /**
   * Initialize a Baileys WhatsApp Web multi-device socket.
   */
  private async initSocket(
    userId: string,
    channelId: string,
    phoneNumber?: string,
  ): Promise<void> {
    const sessionDir = path.join(this.sessionsRoot, channelId);
    if (!fs.existsSync(sessionDir)) {
      fs.mkdirSync(sessionDir, { recursive: true });
    }

    // Check if session directory is empty and restore from DB if available
    const isDirEmpty = fs.readdirSync(sessionDir).length === 0;
    if (isDirEmpty) {
      try {
        const channelRecord = await prisma.whatsAppChannel.findUnique({
          where: { id: channelId },
          select: { sessionData: true },
        });
        if (channelRecord?.sessionData) {
          this.restoreSessionFromDb(channelId, channelRecord.sessionData);
        }
      } catch (_) { }
    }

    // Terminate any previous socket instance for this channel before creating a new one
    const oldSession = this.sessions.get(channelId);
    if (oldSession?.socket) {
      try {
        oldSession.socket.end(new Error('Session re-initialized'));
      } catch (_) { }
    }
    if (oldSession?.cleanupTimer) {
      clearTimeout(oldSession.cleanupTimer);
    }

    // If requesting pairing code fresh, clear any stale un-paired QR credentials to prevent handshake collision
    if (phoneNumber && !oldSession?.pairingCode && fs.existsSync(sessionDir)) {
      try {
        fs.rmSync(sessionDir, { recursive: true, force: true });
        fs.mkdirSync(sessionDir, { recursive: true });
      } catch (_) { }
    }

    const baileys = await this.getBaileys();
    const makeWASocket = baileys.default || baileys;
    const { useMultiFileAuthState, fetchLatestBaileysVersion, Browsers, DisconnectReason } = baileys;

    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
    const versionInfo = await fetchLatestBaileysVersion().catch(() => ({
      version: [2, 3000, 1015901307] as [number, number, number],
    }));
    const version = versionInfo.version;

    const cleanPhone = phoneNumber ? phoneNumber.replace(/[^0-9]/g, '') : oldSession?.pairingPhone;

    const activeSession: ActiveSession = {
      channelId,
      userId,
      status: 'INITIALIZING',
      reconnectAttempts: oldSession?.reconnectAttempts || 0,
      recentSentTimestamps: [],
      pairingCode: oldSession?.pairingCode,
      pairingCodeGeneratedAt: oldSession?.pairingCodeGeneratedAt,
      pairingPhone: cleanPhone,
    };
    this.sessions.set(channelId, activeSession);

    // --- Official Anti-Ban Configuration ---
    // 1. Identifies as official Chrome on macOS (exact browser tuple Meta expects for WhatsApp Web)
    // 2. syncFullHistory: false (avoids triggering Meta's bulk scraper alarms)
    // 3. Keepalive and natural query timeouts
    const sock = makeWASocket({
      version,
      auth: state,
      logger: pino({ level: 'silent' }),
      browser: Browsers.macOS('Chrome'),
      printQRInTerminal: false,
      connectTimeoutMs: 60000,
      defaultQueryTimeoutMs: 60000,
      keepAliveIntervalMs: 25000,
      emitOwnEvents: true,
      generateHighQualityLinkPreview: true,
      syncFullHistory: false,
    });

    activeSession.socket = sock;

    // --- Safety Auto-Cleanup Timer ---
    // If QR code or pairing is unconsumed, terminate socket to free resources (10 min for pairing, 3 min for QR)
    const timeoutMs = cleanPhone ? 600000 : 180000;
    activeSession.cleanupTimer = setTimeout(() => {
      if (activeSession.status === 'SCAN_QR' || activeSession.status === 'INITIALIZING') {
        console.log(`[WhatsApp] Cleaning up unconsumed session for channel ${channelId}`);
        try {
          sock.end(new Error('Session setup timed out'));
        } catch (_) { }
        activeSession.status = 'DISCONNECTED';
        activeSession.qrCodeBase64 = undefined;
        activeSession.pairingCode = undefined;
      }
    }, timeoutMs);

    // --- Credentials Updates ---
    sock.ev.on('creds.update', async () => {
      await saveCreds();
      this.queueSessionPersist(channelId);
    });

    // --- Pairing Code Support ---
    // If phone number provided and not yet registered, request official 8-digit pairing code
    if (!state.creds?.registered && cleanPhone) {
      const isExistingCodeValid =
        activeSession.pairingCode &&
        activeSession.pairingCodeGeneratedAt &&
        Date.now() - activeSession.pairingCodeGeneratedAt.getTime() < 600000;

      if (isExistingCodeValid) {
        console.log(`[WhatsApp] Preserving existing pairing code for +${cleanPhone}: ${activeSession.pairingCode}`);
        activeSession.status = 'SCAN_QR';
      } else {
        setTimeout(async () => {
          try {
            const pairingCode = await sock.requestPairingCode(cleanPhone);
            activeSession.status = 'SCAN_QR';
            activeSession.pairingCode = pairingCode;
            activeSession.pairingCodeGeneratedAt = new Date();
            activeSession.pairingPhone = cleanPhone;
            console.log(`[WhatsApp] Pairing code generated for +${cleanPhone}: ${pairingCode}`);
          } catch (pairErr) {
            console.error('[WhatsApp] Pairing code generation failed:', pairErr);
          }
        }, 1500);
      }
    }

    // --- Inbound Message Handling with Anti-Ban Protections ---
    sock.ev.on('messages.upsert', async ({ messages, type }: any) => {
      if (type !== 'notify' || !Array.isArray(messages)) return;

      for (const msg of messages) {
        // Anti-ban filter 1: Ignore messages sent by self
        if (msg.key?.fromMe) continue;

        const remoteJid = msg.key?.remoteJid;
        // Anti-ban filter 2: Ignore broadcast status updates
        if (!remoteJid || remoteJid === 'status@broadcast') continue;

        // Anti-ban filter 3: Ignore group chats for direct messaging channels
        if (remoteJid.endsWith('@g.us')) continue;

        // Anti-ban filter 4: Send natural humanized read receipt with 1.5s delay
        setTimeout(async () => {
          try {
            await sock.readMessages([msg.key]);
          } catch (_) { }
        }, 1500);

        let text =
          msg.message?.conversation ||
          msg.message?.extendedTextMessage?.text ||
          msg.message?.imageMessage?.caption ||
          msg.message?.videoMessage?.caption ||
          msg.message?.documentMessage?.caption ||
          '';

        // Extract button and interactive list selection responses
        if (!text || !text.trim()) {
          if (msg.message?.buttonsResponseMessage?.selectedButtonId) {
            text = msg.message.buttonsResponseMessage.selectedButtonId;
          } else if (msg.message?.buttonsResponseMessage?.selectedDisplayText) {
            text = msg.message.buttonsResponseMessage.selectedDisplayText;
          } else if (msg.message?.templateButtonReplyMessage?.selectedId) {
            text = msg.message.templateButtonReplyMessage.selectedId;
          } else if (msg.message?.templateButtonReplyMessage?.selectedDisplayText) {
            text = msg.message.templateButtonReplyMessage.selectedDisplayText;
          } else if (msg.message?.listResponseMessage?.singleSelectReply?.selectedRowId) {
            text = msg.message.listResponseMessage.singleSelectReply.selectedRowId;
          } else if (msg.message?.listResponseMessage?.title) {
            text = msg.message.listResponseMessage.title;
          } else if (msg.message?.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson) {
            try {
              const parsed = JSON.parse(
                msg.message.interactiveResponseMessage.nativeFlowResponseMessage.paramsJson,
              );
              text = parsed.id || parsed.title || parsed.display_text || '';
            } catch (_) {}
          }
        }

        console.log(`[WhatsApp] Inbound message on channel ${channelId} from ${remoteJid}: "${text.slice(0, 40)}"`);

        // Detect media type if present
        let mediaType: 'image' | 'video' | 'audio' | 'document' | undefined;
        if (msg.message?.imageMessage) mediaType = 'image';
        else if (msg.message?.videoMessage) mediaType = 'video';
        else if (msg.message?.audioMessage) mediaType = 'audio';
        else if (msg.message?.documentMessage) mediaType = 'document';

        // Fetch contact profile picture and resolve phone number asynchronously
        let profilePic: string | undefined;
        let resolvedPhone: string | undefined;

        try {
          profilePic = (await sock.profilePictureUrl(remoteJid, 'image')) || undefined;
        } catch (_) {
          try {
            profilePic = (await sock.profilePictureUrl(remoteJid, 'preview')) || undefined;
          } catch (_) {}
        }

        if (remoteJid.endsWith('@lid') && sock.signalRepository?.lidMapping?.getPNForLID) {
          try {
            const pnJid = await sock.signalRepository.lidMapping.getPNForLID(remoteJid);
            if (pnJid) {
              resolvedPhone = pnJid.split('@')[0].split(':')[0];
              if (!profilePic) {
                try {
                  profilePic = (await sock.profilePictureUrl(pnJid, 'image')) || undefined;
                } catch (_) {
                  try {
                    profilePic = (await sock.profilePictureUrl(pnJid, 'preview')) || undefined;
                  } catch (_) {}
                }
              }
            }
          } catch (_) {}
        }

        // Dispatch to WhatsApp Automation Engine (runs asynchronously without blocking socket loop)
        whatsappAutomationEngine.processInboundMessage({
          channelId,
          userId,
          senderJid: remoteJid,
          text,
          messageId: msg.key?.id,
          pushName: msg.pushName || '',
          mediaType,
          profilePic,
          resolvedPhone,
        }).catch((err) => {
          console.error(`[WhatsApp] Failed to process automation for message ${msg.key?.id}:`, err);
        });
      }
    });

    // --- Connection Updates (QR code, Connected, Disconnected) ---
    sock.ev.on('connection.update', async (update: any) => {
      const { connection, lastDisconnect, qr } = update;

      // New QR Code emitted by Baileys
      if (qr) {
        try {
          const qrCodeBase64 = await QRCode.toDataURL(qr, {
            margin: 2,
            scale: 8,
            color: {
              dark: '#000000',
              light: '#ffffff',
            },
          });
          activeSession.status = 'SCAN_QR';
          activeSession.qrCodeBase64 = qrCodeBase64;
          activeSession.qrCodeString = qr;
          activeSession.qrGeneratedAt = new Date();
        } catch (qrErr) {
          console.error('[WhatsApp] QR generation failed:', qrErr);
        }
      }

      // Connection opened successfully!
      if (connection === 'open') {
        activeSession.status = 'CONNECTED';
        activeSession.qrCodeBase64 = undefined;
        activeSession.qrCodeString = undefined;
        activeSession.pairingCode = undefined;
        activeSession.reconnectAttempts = 0;

        if (activeSession.cleanupTimer) {
          clearTimeout(activeSession.cleanupTimer);
          activeSession.cleanupTimer = undefined;
        }

        const rawJid = sock.user?.id || '';
        const phoneNumber = rawJid.split(':')[0] || rawJid.split('@')[0];
        const jid = `${phoneNumber}@s.whatsapp.net`;
        const name = sock.user?.name || `WhatsApp +${phoneNumber.slice(-4)}`;

        let profilePic: string | null = null;
        try {
          profilePic = (await sock.profilePictureUrl(jid, 'image')) || null;
        } catch (_) { }

        // Save connected channel state in database
        await prisma.whatsAppChannel.update({
          where: { id: channelId },
          data: {
            phoneNumber,
            jid,
            name,
            profilePic,
            status: 'CONNECTED',
            connectedAt: new Date(),
          },
        });

        // Anti-ban rule: Simulate natural active presence upon connection
        await sock.sendPresenceUpdate('available').catch(() => { });

        // Immediately persist authenticated credentials to database for container persistence
        await this.persistSessionToDb(channelId);

        console.log(`[WhatsApp] Channel ${channelId} connected successfully for +${phoneNumber}`);
      }

      // Connection closed
      if (connection === 'close') {
        const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;
        const isLoggedOut = statusCode === DisconnectReason.loggedOut || statusCode === 401 || statusCode === 403;

        console.log(`[WhatsApp] Channel ${channelId} closed. Status: ${statusCode}, LoggedOut: ${isLoggedOut}`);

        if (isLoggedOut) {
          // Anti-ban Rule: NEVER retry connecting when logged out / unauthorized.
          // Wipe local session directory immediately.
          activeSession.status = 'DISCONNECTED';
          activeSession.qrCodeBase64 = undefined;
          activeSession.pairingCode = undefined;
          activeSession.socket = undefined;

          if (fs.existsSync(sessionDir)) {
            fs.rmSync(sessionDir, { recursive: true, force: true });
          }

          await prisma.whatsAppChannel.update({
            where: { id: channelId },
            data: { status: 'DISCONNECTED', sessionData: Prisma.DbNull },
          }).catch(() => { });
        } else {
          // Transient network drop: Reconnect with bounded exponential backoff and jitter (max 5 tries)
          if (activeSession.reconnectAttempts < 5) {
            activeSession.reconnectAttempts++;
            const backoffMs =
              Math.min(activeSession.reconnectAttempts * 3000, 15000) +
              Math.floor(Math.random() * 1000);
            console.log(`[WhatsApp] Reconnecting channel ${channelId} in ${backoffMs}ms (attempt ${activeSession.reconnectAttempts}/5)...`);
            setTimeout(() => {
              this.initSocket(userId, channelId, cleanPhone).catch(() => { });
            }, backoffMs);
          } else {
            console.log(`[WhatsApp] Channel ${channelId} exceeded maximum reconnect attempts. Stopping.`);
            activeSession.status = 'FAILED';
            await prisma.whatsAppChannel.update({
              where: { id: channelId },
              data: { status: 'DISCONNECTED' },
            }).catch(() => { });
          }
        }
      }
    });
  }
}

export default new WhatsAppService();
