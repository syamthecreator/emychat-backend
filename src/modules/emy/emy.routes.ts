import { NextFunction, Response, Router } from 'express';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import { authenticate } from '../../middleware/auth.middleware';
import { AuthenticatedRequest } from '../auth/auth.types';
import { emyController } from './emy.controller';

const router = Router();

const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 10 * 1024 * 1024, // 10 MB max per document
    },
});

/**
 * Populates req.userId when a valid Bearer token is present,
 * while still allowing unauthenticated visitors to ask platform questions.
 */
const optionalAuthenticate = (
    req: AuthenticatedRequest,
    _res: Response,
    next: NextFunction,
) => {
    try {
        const authorization = req.headers.authorization;
        if (authorization?.startsWith('Bearer ')) {
            const token = authorization.slice(7).trim();
            const secret = process.env.JWT_ACCESS_SECRET;
            if (secret && token) {
                const decoded = jwt.verify(token, secret, { algorithms: ['HS256'] });
                if (typeof decoded !== 'string' && typeof decoded.sub === 'string' && decoded.sub) {
                    req.userId = decoded.sub;
                }
            }
        }
    } catch {
        // Ignore invalid/expired token for optional auth; req.userId remains undefined
    }
    next();
};

// Chat endpoints
router.post('/chat', optionalAuthenticate, (req, res) => emyController.chat(req, res));
router.get('/history', authenticate, (req, res) => emyController.getHistory(req, res));
router.delete('/history', authenticate, (req, res) => emyController.clearHistory(req, res));

// User-isolated company document endpoints
router.get('/documents', authenticate, (req, res) => emyController.listDocuments(req, res));
router.post('/documents', authenticate, upload.single('file'), (req, res) =>
    emyController.uploadDocument(req, res),
);
router.delete('/documents/:id', authenticate, (req, res) =>
    emyController.deleteDocument(req, res),
);

export default router;
