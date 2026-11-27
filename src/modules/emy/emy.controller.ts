import { Response } from 'express';
import { z } from 'zod';
import { AuthenticatedRequest } from '../auth/auth.types';
import { emyAiService } from './emy.ai.service';
import { emyDocumentService } from './emy.document.service';

const chatSchema = z.object({
    message: z.string().min(1, 'Message is required').max(4000, 'Message is too long'),
    history: z
        .array(
            z.object({
                role: z.enum(['user', 'assistant']),
                content: z.string(),
            }),
        )
        .optional(),
});

export class EmyController {
    async chat(req: AuthenticatedRequest, res: Response) {
        try {
            const parsed = chatSchema.safeParse(req.body);
            if (!parsed.success) {
                return res.status(400).json({
                    success: false,
                    message: parsed.error.issues[0]?.message || 'Invalid chat payload',
                });
            }

            const result = await emyAiService.chat({
                userId: req.userId,
                message: parsed.data.message,
                guestHistory: parsed.data.history,
            });

            return res.status(200).json({
                success: true,
                data: result,
            });
        } catch (error: any) {
            console.error('Emy chat error:', error);
            return res.status(500).json({
                success: false,
                message: error?.message || 'Failed to generate response from Emy',
            });
        }
    }

    async getHistory(req: AuthenticatedRequest, res: Response) {
        try {
            if (!req.userId) {
                return res.status(401).json({ success: false, message: 'Authentication required' });
            }
            const messages = await emyAiService.getHistory(req.userId);
            return res.status(200).json({
                success: true,
                data: messages,
            });
        } catch (error: any) {
            console.error('Emy getHistory error:', error);
            return res.status(500).json({
                success: false,
                message: error?.message || 'Failed to load chat history',
            });
        }
    }

    async clearHistory(req: AuthenticatedRequest, res: Response) {
        try {
            if (!req.userId) {
                return res.status(401).json({ success: false, message: 'Authentication required' });
            }
            await emyAiService.clearHistory(req.userId);
            return res.status(200).json({
                success: true,
                message: 'Chat history cleared',
            });
        } catch (error: any) {
            console.error('Emy clearHistory error:', error);
            return res.status(500).json({
                success: false,
                message: error?.message || 'Failed to clear chat history',
            });
        }
    }

    async listDocuments(req: AuthenticatedRequest, res: Response) {
        try {
            if (!req.userId) {
                return res.status(401).json({ success: false, message: 'Authentication required' });
            }
            const documents = await emyDocumentService.listDocuments(req.userId);
            return res.status(200).json({
                success: true,
                data: documents,
            });
        } catch (error: any) {
            console.error('Emy listDocuments error:', error);
            return res.status(500).json({
                success: false,
                message: error?.message || 'Failed to load documents',
            });
        }
    }

    async uploadDocument(req: AuthenticatedRequest, res: Response) {
        try {
            if (!req.userId) {
                return res.status(401).json({ success: false, message: 'Authentication required' });
            }
            const file = req.file;
            if (!file) {
                return res.status(400).json({
                    success: false,
                    message: 'Please attach a document file (PDF, DOCX, TXT, or MD).',
                });
            }

            const document = await emyDocumentService.uploadDocument(req.userId, file);
            return res.status(201).json({
                success: true,
                message: 'Document uploaded and processed successfully',
                data: document,
            });
        } catch (error: any) {
            console.error('Emy uploadDocument error:', error);
            return res.status(400).json({
                success: false,
                message: error?.message || 'Failed to process uploaded document',
            });
        }
    }

    async deleteDocument(req: AuthenticatedRequest, res: Response) {
        try {
            if (!req.userId) {
                return res.status(401).json({ success: false, message: 'Authentication required' });
            }
            const documentId = String(req.params.id || '');
            if (!documentId) {
                return res.status(400).json({ success: false, message: 'Document ID is required' });
            }

            const deleted = await emyDocumentService.deleteDocument(req.userId, documentId);
            if (!deleted) {
                return res.status(404).json({
                    success: false,
                    message: 'Document not found',
                });
            }

            return res.status(200).json({
                success: true,
                message: 'Document deleted',
            });
        } catch (error: any) {
            console.error('Emy deleteDocument error:', error);
            return res.status(500).json({
                success: false,
                message: error?.message || 'Failed to delete document',
            });
        }
    }
}

export const emyController = new EmyController();
