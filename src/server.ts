
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables before initializing services.
dotenv.config();

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import prisma from './config/database';

import authRoutes from './modules/auth/auth.routes';
import automationRoutes from './modules/automation/automation.routes';
import inboxRoutes from './modules/inbox/inbox.routes';
import whatsappRoutes from './modules/whatsapp/whatsapp.routes';
import whatsAppService from './modules/whatsapp/whatsapp.service';
import emyRoutes from './modules/emy/emy.routes';

const app = express();

const PORT = process.env.PORT || 5001;

app.use(
    helmet({
        crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
    }),
);

app.use(cors({
    origin: (origin, callback) => {
        // Allow requests with no origin (like mobile apps, curl)
        if (!origin) return callback(null, true);

        // Allow any localhost port for Flutter Web development
        if (/^http:\/\/localhost:\d+$/.test(origin) || /^http:\/\/127\.0\.0\.1:\d+$/.test(origin)) {
            return callback(null, true);
        }

        const allowedOrigins = [
            'https://emychat-project.web.app',
            'https://emychat-project.firebaseapp.com',
            process.env.FRONTEND_URL,
        ].filter(Boolean);

        if (allowedOrigins.includes(origin)) {
            return callback(null, true);
        }

        return callback(null, false);
    },
    credentials: true,
}));

app.use(
    express.json({
        verify: (req, _res, buf) => {
            (
                req as express.Request & { rawBody?: Buffer }
            ).rawBody = Buffer.from(buf);
        },
    }),
);

// Static uploads directory for media attachments (audio voice notes, images, videos)
app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));

// API routes
app.use('/api/v1/auth', authRoutes);

app.use('/api/v1/automations', automationRoutes);

app.use('/api/v1/inbox', inboxRoutes);

app.use('/api/v1/whatsapp', whatsappRoutes);

app.use('/api/v1/emy', emyRoutes);

// Root endpoint
app.get('/', (_req, res) => {
    res.json({
        success: true,
        message: 'EmyChat API is running',
    });
});

// Server health
app.get('/api/v1/health', (_req, res) => {
    res.status(200).json({
        success: true,
        message: 'Server is healthy',
        timestamp: new Date().toISOString(),
    });
});

// Database health
app.get('/api/v1/health/database', async (_req, res) => {
    try {
        await prisma.$queryRaw`SELECT 1`;

        res.status(200).json({
            success: true,
            message: 'Database connection is healthy',
        });
    } catch (error) {
        console.error('Database health check failed:', error);

        res.status(503).json({
            success: false,
            message: 'Database connection failed',
        });
    }
});

// Global JSON error handler
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('Unhandled server error:', err);
    res.status(err.status || 500).json({
        success: false,
        message: err.message || 'Internal server error',
    });
});

// Start server after registering middleware and routes.
app.listen(Number(PORT), '0.0.0.0', () => {
    console.log(`EmyChat API running on port ${PORT}`);
    whatsAppService.restoreActiveSessions().catch((err) => {
        console.error('Failed to restore active WhatsApp sessions:', err);
    });
});
