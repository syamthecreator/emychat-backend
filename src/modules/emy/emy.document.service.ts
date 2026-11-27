import path from 'path';
import mammoth from 'mammoth';
import prisma from '../../config/database';
import { createGenAIClient } from './emy.genai';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require('pdf-parse') as (buffer: Buffer) => Promise<{ text: string }>;

const MAX_CHUNK_CHARS = 900;
const CHUNK_OVERLAP_CHARS = 150;
const EMBEDDING_MODEL = process.env.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-001';

export interface RetrievedChunk {
    id: string;
    documentId: string;
    fileName: string;
    content: string;
    score: number;
}

export async function extractTextFromBuffer(
    buffer: Buffer,
    fileName: string,
    mimeType: string,
): Promise<string> {
    const ext = path.extname(fileName).toLowerCase();

    if (ext === '.pdf' || mimeType === 'application/pdf') {
        const parsed = await pdfParse(buffer);
        return (parsed.text || '').trim();
    }

    if (
        ext === '.docx' ||
        mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ) {
        const result = await mammoth.extractRawText({ buffer });
        return (result.value || '').trim();
    }

    if (
        ext === '.txt' ||
        ext === '.md' ||
        ext === '.csv' ||
        ext === '.json' ||
        mimeType.startsWith('text/')
    ) {
        return buffer.toString('utf8').trim();
    }

    throw new Error('Unsupported file format. Please upload PDF, DOCX, TXT, MD, or CSV files.');
}

export function chunkText(rawText: string): string[] {
    const normalized = rawText
        .replace(/\r\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .replace(/[ \t]{2,}/g, ' ')
        .trim();

    if (!normalized) return [];

    const chunks: string[] = [];
    let start = 0;

    while (start < normalized.length) {
        let end = Math.min(start + MAX_CHUNK_CHARS, normalized.length);

        if (end < normalized.length) {
            const lastParagraph = normalized.lastIndexOf('\n\n', end);
            const lastSentence = normalized.lastIndexOf('. ', end);
            const lastSpace = normalized.lastIndexOf(' ', end);

            if (lastParagraph > start + MAX_CHUNK_CHARS * 0.45) {
                end = lastParagraph + 2;
            } else if (lastSentence > start + MAX_CHUNK_CHARS * 0.45) {
                end = lastSentence + 2;
            } else if (lastSpace > start + MAX_CHUNK_CHARS * 0.45) {
                end = lastSpace + 1;
            }
        }

        const piece = normalized.slice(start, end).trim();
        if (piece.length > 0) {
            chunks.push(piece);
        }

        if (end >= normalized.length) break;
        start = Math.max(end - CHUNK_OVERLAP_CHARS, start + 1);
    }

    return chunks;
}

export async function generateEmbedding(text: string): Promise<number[] | null> {
    const ai = await createGenAIClient();
    if (!ai) return null;

    try {
        const response = await ai.models.embedContent({
            model: EMBEDDING_MODEL,
            contents: text,
        });

        const values = response.embeddings?.[0]?.values;
        if (Array.isArray(values) && values.length > 0) {
            return values;
        }
        return null;
    } catch (error) {
        console.warn('Embedding generation failed, falling back to keyword search:', error);
        return null;
    }
}

function cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length || a.length === 0) return 0;
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom === 0 ? 0 : dot / denom;
}

function keywordOverlapScore(query: string, content: string): number {
    const stopWords = new Set([
        'the', 'is', 'at', 'which', 'on', 'a', 'an', 'and', 'or', 'of', 'to', 'in',
        'for', 'with', 'about', 'what', 'how', 'when', 'where', 'who', 'why', 'can',
        'do', 'does', 'my', 'our', 'your', 'this', 'that', 'are', 'was', 'were',
    ]);

    const tokenize = (s: string) =>
        s
            .toLowerCase()
            .replace(/[^a-z0-9\s]/g, ' ')
            .split(/\s+/)
            .filter((t) => t.length > 1 && !stopWords.has(t));

    const queryTokens = Array.from(new Set(tokenize(query)));
    if (queryTokens.length === 0) return 0;

    const lowerContent = content.toLowerCase();
    let matches = 0;
    for (const token of queryTokens) {
        if (lowerContent.includes(token)) {
            matches += 1;
        }
    }
    return matches / queryTokens.length;
}

export class EmyDocumentService {
    async uploadDocument(
        userId: string,
        file: { originalname: string; mimetype: string; size: number; buffer: Buffer },
    ) {
        const extractedText = await extractTextFromBuffer(
            file.buffer,
            file.originalname,
            file.mimetype,
        );

        if (!extractedText || extractedText.length < 10) {
            throw new Error(
                'No readable text could be extracted from this document. If it is a scanned PDF, please upload a text-based PDF, DOCX, or TXT file.',
            );
        }

        const chunks = chunkText(extractedText);
        if (chunks.length === 0) {
            throw new Error('Document content is empty after processing.');
        }

        const doc = await prisma.userDocument.create({
            data: {
                userId,
                fileName: file.originalname,
                mimeType: file.mimetype || 'application/octet-stream',
                fileSize: file.size,
                status: 'PROCESSING',
                chunkCount: chunks.length,
            },
        });

        try {
            const chunkRows = [];
            for (let i = 0; i < chunks.length; i++) {
                const content = chunks[i];
                const embedding = await generateEmbedding(content);
                chunkRows.push({
                    documentId: doc.id,
                    userId,
                    chunkIndex: i,
                    content,
                    embedding: embedding ? (embedding as unknown as object) : undefined,
                });
            }

            await prisma.documentChunk.createMany({
                data: chunkRows,
            });

            return await prisma.userDocument.update({
                where: { id: doc.id },
                data: {
                    status: 'READY',
                    chunkCount: chunkRows.length,
                },
                select: {
                    id: true,
                    fileName: true,
                    mimeType: true,
                    fileSize: true,
                    status: true,
                    chunkCount: true,
                    createdAt: true,
                },
            });
        } catch (error: any) {
            await prisma.userDocument.update({
                where: { id: doc.id },
                data: {
                    status: 'FAILED',
                    errorMessage: error?.message || 'Failed to process document chunks',
                },
            });
            throw error;
        }
    }

    async listDocuments(userId: string) {
        return prisma.userDocument.findMany({
            where: { userId },
            orderBy: { createdAt: 'desc' },
            select: {
                id: true,
                fileName: true,
                mimeType: true,
                fileSize: true,
                status: true,
                chunkCount: true,
                errorMessage: true,
                createdAt: true,
            },
        });
    }

    async deleteDocument(userId: string, documentId: string) {
        const existing = await prisma.userDocument.findFirst({
            where: { id: documentId, userId },
        });
        if (!existing) {
            return false;
        }
        await prisma.userDocument.delete({
            where: { id: existing.id },
        });
        return true;
    }

    async hasDocuments(userId: string): Promise<boolean> {
        const count = await prisma.userDocument.count({
            where: { userId, status: 'READY' },
        });
        return count > 0;
    }

    async searchUserChunks(
        userId: string,
        query: string,
        topK = 5,
    ): Promise<RetrievedChunk[]> {
        const chunks = await prisma.documentChunk.findMany({
            where: {
                userId,
                document: { status: 'READY' },
            },
            include: {
                document: {
                    select: { fileName: true },
                },
            },
        });

        if (chunks.length === 0) return [];

        const queryEmbedding = await generateEmbedding(query);

        const scored: RetrievedChunk[] = chunks.map((chunk) => {
            const kwScore = keywordOverlapScore(query, chunk.content);
            let vecScore = 0;

            if (queryEmbedding && Array.isArray(chunk.embedding)) {
                vecScore = cosineSimilarity(
                    queryEmbedding,
                    chunk.embedding as unknown as number[],
                );
            }

            const combinedScore = queryEmbedding && Array.isArray(chunk.embedding)
                ? vecScore * 0.75 + kwScore * 0.25
                : kwScore;

            return {
                id: chunk.id,
                documentId: chunk.documentId,
                fileName: chunk.document.fileName,
                content: chunk.content,
                score: combinedScore,
            };
        });

        scored.sort((a, b) => b.score - a.score);

        // Return topK chunks that have meaningful relevance
        const relevant = scored.filter((c) => c.score > 0.12).slice(0, topK);
        if (relevant.length > 0) return relevant;

        // If user has documents and asked a broad summary question ("what is in my docs?"),
        // return top 3 chunks as fallback context if score > 0 or if query references documents.
        if (/\b(doc|document|file|pdf|company|policy|upload|summary|summarize)\b/i.test(query)) {
            return scored.slice(0, Math.min(3, scored.length));
        }

        return [];
    }
}

export const emyDocumentService = new EmyDocumentService();
