import crypto from 'crypto';
import bcrypt from 'bcrypt';
import prisma from '../../config/database';
import {
    RegisterInput,
    LoginInput,
    RefreshTokenInput,
    ResetPasswordInput,
    VerifyEmailOtpInput,
} from './auth.validation';
import {
    generateAccessToken,
    generateRefreshToken,
    hashToken,
} from '../../utils/token.utils';
import {
    sendEmailVerificationOtp,
    sendPasswordResetOtp,
} from '../../utils/email.utils';

export class AuthService {
    async register(data: RegisterInput) {
        const existingUser = await prisma.user.findUnique({
            where: {
                email: data.email,
            },
        });

        const hashedPassword = await bcrypt.hash(data.password, 12);
        let user: { id: string; name: string; email: string; status: string };

        if (existingUser) {
            if (existingUser.status === 'ACTIVE') {
                throw new Error('EMAIL_ALREADY_EXISTS');
            }
            // User was previously registered but not yet verified.
            user = await prisma.user.update({
                where: { id: existingUser.id },
                data: {
                    name: data.name,
                    password: hashedPassword,
                },
                select: {
                    id: true,
                    name: true,
                    email: true,
                    status: true,
                },
            });
        } else {
            user = await prisma.user.create({
                data: {
                    name: data.name,
                    email: data.email,
                    password: hashedPassword,
                    status: 'INACTIVE',
                },
                select: {
                    id: true,
                    name: true,
                    email: true,
                    status: true,
                },
            });
        }

        // Generate 4-digit verification OTP
        const otp = Math.floor(1000 + Math.random() * 9000).toString();
        const tokenHash = hashToken(otp);
        const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 mins

        await prisma.emailVerificationToken.deleteMany({
            where: { userId: user.id },
        });

        await prisma.emailVerificationToken.create({
            data: {
                userId: user.id,
                tokenHash,
                expiresAt,
            },
        });

        // Dispatch OTP via email service
        await sendEmailVerificationOtp(user.email, otp);

        return {
            requiresVerification: true,
            email: user.email,
            message: 'Verification code sent to your email. Please enter the code to activate your account.',
        };
    }

    async verifyEmailOtp(data: VerifyEmailOtpInput) {
        const user = await prisma.user.findUnique({
            where: { email: data.email },
        });

        if (!user) {
            throw new Error('USER_NOT_FOUND');
        }

        if (user.status === 'ACTIVE') {
            throw new Error('EMAIL_ALREADY_VERIFIED');
        }

        const tokenHash = hashToken(data.otp);

        const verificationToken = await prisma.emailVerificationToken.findFirst({
            where: {
                userId: user.id,
                tokenHash,
                usedAt: null,
                expiresAt: {
                    gt: new Date(),
                },
            },
        });

        if (!verificationToken) {
            throw new Error('INVALID_OR_EXPIRED_OTP');
        }

        await prisma.$transaction([
            prisma.user.update({
                where: { id: user.id },
                data: { status: 'ACTIVE' },
            }),
            prisma.emailVerificationToken.update({
                where: { id: verificationToken.id },
                data: { usedAt: new Date() },
            }),
        ]);

        const accessToken = generateAccessToken(user.id);
        const refreshToken = generateRefreshToken();
        const refreshTokenHash = hashToken(refreshToken);

        const refreshTokenExpiresInDays = 30;
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + refreshTokenExpiresInDays);

        await prisma.session.create({
            data: {
                userId: user.id,
                refreshTokenHash,
                expiresAt,
            },
        });

        return {
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                status: 'ACTIVE',
            },
            accessToken,
            refreshToken,
            tokenType: 'Bearer',
            expiresIn: 900,
        };
    }

    async resendVerificationOtp(email: string) {
        const user = await prisma.user.findUnique({
            where: { email },
        });

        if (!user || user.status === 'ACTIVE') {
            return {
                message: 'If an unverified account exists with this email, a new verification code has been sent.',
            };
        }

        const otp = Math.floor(1000 + Math.random() * 9000).toString();
        const tokenHash = hashToken(otp);
        const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

        await prisma.emailVerificationToken.deleteMany({
            where: { userId: user.id },
        });

        await prisma.emailVerificationToken.create({
            data: {
                userId: user.id,
                tokenHash,
                expiresAt,
            },
        });

        await sendEmailVerificationOtp(user.email, otp);

        return {
            message: 'A new verification code has been sent to your email.',
        };
    }

    async login(data: LoginInput) {
        const user = await prisma.user.findUnique({
            where: {
                email: data.email,
            },
        });

        if (!user) {
            throw new Error('INVALID_CREDENTIALS');
        }

        const passwordMatches = await bcrypt.compare(
            data.password,
            user.password,
        );

        if (!passwordMatches) {
            throw new Error('INVALID_CREDENTIALS');
        }

        if (user.status !== 'ACTIVE') {
            throw new Error('ACCOUNT_INACTIVE');
        }

        const accessToken = generateAccessToken(user.id);
        const refreshToken = generateRefreshToken();
        const refreshTokenHash = hashToken(refreshToken);

        const refreshTokenExpiresInDays = 30;

        const expiresAt = new Date();
        expiresAt.setDate(
            expiresAt.getDate() + refreshTokenExpiresInDays,
        );

        await prisma.session.create({
            data: {
                userId: user.id,
                refreshTokenHash,
                expiresAt,
            },
        });

        return {
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                status: user.status,
            },
            accessToken,
            refreshToken,
            tokenType: 'Bearer',
            expiresIn: 900,
        };
    }

    async refresh(data: RefreshTokenInput) {
        const oldTokenHash = hashToken(data.refreshToken);

        const session = await prisma.session.findUnique({
            where: {
                refreshTokenHash: oldTokenHash,
            },
            include: {
                user: true,
            },
        });

        if (
            !session ||
            session.revokedAt ||
            session.expiresAt <= new Date()
        ) {
            throw new Error('INVALID_REFRESH_TOKEN');
        }

        if (session.user.status !== 'ACTIVE') {
            throw new Error('ACCOUNT_INACTIVE');
        }

        const newAccessToken = generateAccessToken(session.userId);
        const newRefreshToken = generateRefreshToken();
        const newRefreshTokenHash = hashToken(newRefreshToken);

        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 30);

        // Atomically rotate the refresh token.
        const updated = await prisma.session.updateMany({
            where: {
                id: session.id,
                refreshTokenHash: oldTokenHash,
                revokedAt: null,
                expiresAt: {
                    gt: new Date(),
                },
            },
            data: {
                refreshTokenHash: newRefreshTokenHash,
                expiresAt,
            },
        });

        if (updated.count !== 1) {
            throw new Error('INVALID_REFRESH_TOKEN');
        }

        return {
            accessToken: newAccessToken,
            refreshToken: newRefreshToken,
            tokenType: 'Bearer',
            expiresIn: 900,
        };
    }

    async logout(refreshToken?: string, userId?: string) {
        if (refreshToken) {
            const refreshTokenHash = hashToken(refreshToken);
            await prisma.session.updateMany({
                where: {
                    refreshTokenHash,
                    revokedAt: null,
                },
                data: {
                    revokedAt: new Date(),
                },
            });
        } else if (userId) {
            await prisma.session.updateMany({
                where: {
                    userId,
                    revokedAt: null,
                },
                data: {
                    revokedAt: new Date(),
                },
            });
        }

        return true;
    }

    async forgotPassword(email: string) {
        const user = await prisma.user.findUnique({
            where: { email },
        });

        if (!user) {
            return {
                message: 'If an account exists with this email, a verification code has been sent.',
            };
        }

        if (user.status !== 'ACTIVE') {
            throw new Error('ACCOUNT_INACTIVE');
        }

        // Generate 4-digit numeric verification OTP matching frontend UI
        const otp = Math.floor(1000 + Math.random() * 9000).toString();
        const tokenHash = hashToken(otp);

        const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 mins

        await prisma.passwordResetToken.deleteMany({
            where: { userId: user.id },
        });

        await prisma.passwordResetToken.create({
            data: {
                userId: user.id,
                tokenHash,
                expiresAt,
            },
        });

        console.log(`[PASSWORD_RESET_OTP] Email: ${email}, OTP: ${otp}`);
        await sendPasswordResetOtp(email, otp);

        return {
            message: 'Verification code sent to your email.',
        };
    }

    async verifyOtp(email: string, otp: string) {
        const user = await prisma.user.findUnique({
            where: { email },
        });

        if (!user) {
            throw new Error('INVALID_OR_EXPIRED_OTP');
        }

        const tokenHash = hashToken(otp);

        const resetToken = await prisma.passwordResetToken.findFirst({
            where: {
                userId: user.id,
                tokenHash,
                usedAt: null,
                expiresAt: {
                    gt: new Date(),
                },
            },
        });

        if (!resetToken) {
            throw new Error('INVALID_OR_EXPIRED_OTP');
        }

        return { valid: true };
    }

    async resetPassword(data: ResetPasswordInput) {
        const user = await prisma.user.findUnique({
            where: { email: data.email },
        });

        if (!user) {
            throw new Error('INVALID_OR_EXPIRED_OTP');
        }

        const tokenHash = hashToken(data.otp);

        const resetToken = await prisma.passwordResetToken.findFirst({
            where: {
                userId: user.id,
                tokenHash,
                usedAt: null,
                expiresAt: {
                    gt: new Date(),
                },
            },
        });

        if (!resetToken) {
            throw new Error('INVALID_OR_EXPIRED_OTP');
        }

        const hashedPassword = await bcrypt.hash(data.password, 12);

        await prisma.$transaction([
            prisma.user.update({
                where: { id: user.id },
                data: { password: hashedPassword },
            }),
            prisma.passwordResetToken.update({
                where: { id: resetToken.id },
                data: { usedAt: new Date() },
            }),
            prisma.session.updateMany({
                where: { userId: user.id, revokedAt: null },
                data: { revokedAt: new Date() },
            }),
        ]);

        return true;
    }

    async getProfile(userId: string) {
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: {
                id: true,
                name: true,
                email: true,
                status: true,
                createdAt: true,
            },
        });

        if (!user || user.status !== 'ACTIVE') {
            throw new Error('USER_NOT_FOUND');
        }

        return user;
    }
}

export default new AuthService();


