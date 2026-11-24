import { Router } from 'express';
import inboxController from './inbox.controller';
import { authenticate } from '../../middleware/auth.middleware';

const router = Router();

// All inbox endpoints require user authentication
router.use(authenticate);

// Inbox statistics & media upload
router.get('/stats', (req, res) => inboxController.getStats(req, res));
router.post('/upload', (req, res) => inboxController.upload(req, res));

// Conversations
router.get('/conversations', (req, res) => inboxController.list(req, res));
router.get('/conversations/:contactId', (req, res) =>
  inboxController.getById(req, res),
);
router.patch('/conversations/:contactId', (req, res) =>
  inboxController.updateConversation(req, res),
);

// Messages
router.get('/conversations/:contactId/messages', (req, res) =>
  inboxController.getMessages(req, res),
);
router.post('/conversations/:contactId/messages', (req, res) =>
  inboxController.sendMessage(req, res),
);

// Sender actions (mark_seen, typing_on, typing_off)
router.post('/conversations/:contactId/action', (req, res) =>
  inboxController.sendAction(req, res),
);

export default router;

