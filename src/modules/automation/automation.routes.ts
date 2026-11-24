import { Router } from 'express';
import automationController from './automation.controller';
import { authenticate } from '../../middleware/auth.middleware';

const router = Router();

// All automation endpoints require user authentication
router.use(authenticate);

// Analytics
router.get('/analytics/overview', (req, res) =>
  automationController.getAnalytics(req, res),
);

// CRUD
router.get('/', (req, res) => automationController.list(req, res));
router.post('/', (req, res) => automationController.create(req, res));
router.get('/:id', (req, res) => automationController.getById(req, res));
router.put('/:id', (req, res) => automationController.update(req, res));
router.patch('/:id/toggle', (req, res) =>
  automationController.toggle(req, res),
);
router.delete('/:id', (req, res) => automationController.delete(req, res));

// Execution Logs
router.get('/:id/logs', (req, res) => automationController.getLogs(req, res));

export default router;

