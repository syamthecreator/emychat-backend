import prisma from '../../config/database';

let initialized = false;

/**
 * Ensures Emy tables exist in PostgreSQL (safe & idempotent over PgBouncer/pooler connections).
 */
export async function ensureEmyTables(): Promise<void> {
    if (initialized) return;

    try {
        await prisma.$executeRawUnsafe(`
            CREATE TABLE IF NOT EXISTS "user_documents" (
                "id" TEXT NOT NULL,
                "userId" TEXT NOT NULL,
                "fileName" TEXT NOT NULL,
                "mimeType" TEXT NOT NULL,
                "fileSize" INTEGER NOT NULL,
                "status" TEXT NOT NULL DEFAULT 'READY',
                "chunkCount" INTEGER NOT NULL DEFAULT 0,
                "errorMessage" TEXT,
                "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT "user_documents_pkey" PRIMARY KEY ("id")
            );
        `);

        await prisma.$executeRawUnsafe(`
            CREATE TABLE IF NOT EXISTS "document_chunks" (
                "id" TEXT NOT NULL,
                "documentId" TEXT NOT NULL,
                "userId" TEXT NOT NULL,
                "chunkIndex" INTEGER NOT NULL,
                "content" TEXT NOT NULL,
                "embedding" JSONB,
                "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT "document_chunks_pkey" PRIMARY KEY ("id")
            );
        `);

        await prisma.$executeRawUnsafe(`
            CREATE TABLE IF NOT EXISTS "emy_chat_messages" (
                "id" TEXT NOT NULL,
                "userId" TEXT NOT NULL,
                "role" TEXT NOT NULL,
                "content" TEXT NOT NULL,
                "sources" JSONB,
                "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT "emy_chat_messages_pkey" PRIMARY KEY ("id")
            );
        `);

        await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "user_documents_userId_idx" ON "user_documents"("userId");`);
        await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "document_chunks_userId_idx" ON "document_chunks"("userId");`);
        await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "document_chunks_documentId_idx" ON "document_chunks"("documentId");`);
        await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "emy_chat_messages_userId_createdAt_idx" ON "emy_chat_messages"("userId", "createdAt");`);

        await prisma.$executeRawUnsafe(`
            DO $$ BEGIN
                ALTER TABLE "user_documents" ADD CONSTRAINT "user_documents_userId_fkey"
                    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
            EXCEPTION WHEN duplicate_object THEN NULL;
            END $$;
        `);

        await prisma.$executeRawUnsafe(`
            DO $$ BEGIN
                ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_documentId_fkey"
                    FOREIGN KEY ("documentId") REFERENCES "user_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
            EXCEPTION WHEN duplicate_object THEN NULL;
            END $$;
        `);

        await prisma.$executeRawUnsafe(`
            DO $$ BEGIN
                ALTER TABLE "emy_chat_messages" ADD CONSTRAINT "emy_chat_messages_userId_fkey"
                    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
            EXCEPTION WHEN duplicate_object THEN NULL;
            END $$;
        `);

        initialized = true;
        console.log('Emy database tables verified.');
    } catch (error) {
        console.error('Failed to ensure Emy database tables:', error);
    }
}
