import { Response, Router } from 'express';
import { z } from 'zod';
import prisma from '../../config/database';
import { authenticate } from '../../middleware/auth.middleware';
import { AuthenticatedRequest } from '../auth/auth.types';

const router = Router();

let tableEnsured = false;

export async function ensureWorkspaceTable(): Promise<void> {
    if (tableEnsured) return;
    try {
        await prisma.$executeRawUnsafe(`
            CREATE TABLE IF NOT EXISTS "workspaces" (
                "id" TEXT NOT NULL,
                "ownerId" TEXT NOT NULL,
                "name" TEXT NOT NULL,
                "businessName" TEXT NOT NULL,
                "businessCategory" TEXT,
                "slug" TEXT NOT NULL,
                "timezone" TEXT NOT NULL DEFAULT 'UTC',
                "country" TEXT NOT NULL DEFAULT 'United States',
                "userRole" TEXT NOT NULL DEFAULT 'OWNER',
                "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT "workspaces_pkey" PRIMARY KEY ("id")
            );
        `);
        await prisma.$executeRawUnsafe(
            `CREATE UNIQUE INDEX IF NOT EXISTS "workspaces_slug_key" ON "workspaces"("slug");`,
        );
        await prisma.$executeRawUnsafe(
            `CREATE INDEX IF NOT EXISTS "workspaces_ownerId_idx" ON "workspaces"("ownerId");`,
        );
        await prisma.$executeRawUnsafe(`
            DO $$ BEGIN
                ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_ownerId_fkey"
                    FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
            EXCEPTION WHEN duplicate_object THEN NULL;
            END $$;
        `);
        tableEnsured = true;
        console.log('Workspace database table verified.');
    } catch (error) {
        console.error('Failed to ensure workspaces table:', error);
    }
}

const createWorkspaceSchema = z.object({
    name: z.string().trim().min(1, 'Workspace name is required').max(120),
    businessName: z.string().trim().min(1, 'Business name is required').max(160),
    businessCategory: z.string().trim().max(120).optional().nullable(),
    slug: z.string().trim().max(120).optional().nullable(),
    timezone: z.string().trim().max(80).optional(),
    country: z.string().trim().max(80).optional(),
});

router.get('/me', authenticate, async (req: AuthenticatedRequest, res: Response) => {
    try {
        if (!req.userId) {
            return res.status(401).json({ success: false, message: 'Authentication required' });
        }
        await ensureWorkspaceTable();
        const workspaces = await prisma.workspace.findMany({
            where: { ownerId: req.userId },
            orderBy: { createdAt: 'asc' },
        });
        return res.status(200).json({
            success: true,
            data: workspaces,
        });
    } catch (error: any) {
        console.error('Get workspaces error:', error);
        return res.status(500).json({
            success: false,
            message: error?.message || 'Failed to load workspaces',
        });
    }
});

router.post('/', authenticate, async (req: AuthenticatedRequest, res: Response) => {
    try {
        if (!req.userId) {
            return res.status(401).json({ success: false, message: 'Authentication required' });
        }
        const parsed = createWorkspaceSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({
                success: false,
                message: parsed.error.issues[0]?.message || 'Invalid workspace payload',
            });
        }

        await ensureWorkspaceTable();

        const baseSlug = (parsed.data.slug || parsed.data.name)
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '') || 'workspace';

        const existingSlug = await prisma.workspace.findUnique({
            where: { slug: baseSlug },
            select: { id: true },
        });
        const uniqueSlug = existingSlug
            ? `${baseSlug}-${Date.now().toString(36)}`
            : baseSlug;

        const created = await prisma.workspace.create({
            data: {
                ownerId: req.userId,
                name: parsed.data.name,
                businessName: parsed.data.businessName,
                businessCategory: parsed.data.businessCategory || null,
                slug: uniqueSlug,
                timezone: parsed.data.timezone || 'UTC',
                country: parsed.data.country || 'United States',
            },
        });

        return res.status(201).json({
            success: true,
            data: created,
        });
    } catch (error: any) {
        console.error('Create workspace error:', error);
        return res.status(500).json({
            success: false,
            message: error?.message || 'Failed to create workspace',
        });
    }
});

export default router;
