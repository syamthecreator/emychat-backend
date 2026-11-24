import { Router } from 'express';
import whatsAppController from './whatsapp.controller';
import { authenticate } from '../../middleware/auth.middleware';

const router = Router();

// All WhatsApp channel endpoints require authentication
router.use(authenticate);

// List channels
router.get('/channels', (req, res) => whatsAppController.getChannels(req, res));

// Connect (generate/retrieve QR code or pairing code)
router.post('/connect', (req, res) => whatsAppController.connect(req, res));

// Status poll for pending QR scan or connected channel
router.get('/status/:channelId', (req, res) => whatsAppController.getStatus(req, res));

// Disconnect / Logout (DELETE method)
router.delete('/channels/:channelId', (req, res) => whatsAppController.disconnect(req, res));

// Disconnect / Logout (POST alias)
router.post('/channels/:channelId/disconnect', (req, res) => whatsAppController.disconnect(req, res));

// Send message (Outbound text & media with Anti-Ban safeguards)
router.post('/channels/:channelId/send-message', (req, res) => whatsAppController.sendMessage(req, res));

// Sync contact profile pictures across active WhatsApp channels
router.post('/sync-avatars', (req, res) => whatsAppController.syncAvatars(req, res));

export default router;
