import { Request, Response } from 'express';
import authService from './auth.service';
import {
    registerSchema,
    loginSchema,
    refreshTokenSchema,
    logoutSchema,
    forgotPasswordSchema,
    verifyOtpSchema,
    resetPasswordSchema,
    verifyEmailOtpSchema,
    resendVerificationOtpSchema,
    googleAuthSchema,
} from './auth.validation';
import { AuthenticatedRequest } from './auth.types';

export class AuthController {
    async register(req: Request, res: Response) {
        try {
            const validation = registerSchema.safeParse(req.body);

            if (!validation.success) {
                return res.status(400).json({
                    success: false,
                    message: 'Validation failed',
                    errors: validation.error.issues.map((issue) => ({
                        field: issue.path.join('.'),
                        message: issue.message,
                    })),
                });
            }

            const result = await authService.register(validation.data);

            return res.status(201).json({
                success: true,
                message: 'Account created successfully',
                data: result,
            });
        } catch (error) {
            if (
                error instanceof Error &&
                error.message === 'EMAIL_ALREADY_EXISTS'
            ) {
                return res.status(409).json({
                    success: false,
                    message: 'An account with this email already exists',
                });
            }

            console.error('Registration error:', error);

            return res.status(500).json({
                success: false,
                message: 'Something went wrong while creating your account',
            });
        }
    }

    async login(req: Request, res: Response) {
        try {
            const validation = loginSchema.safeParse(req.body);

            if (!validation.success) {
                return res.status(400).json({
                    success: false,
                    message: 'Validation failed',
                    errors: validation.error.issues.map((issue) => ({
                        field: issue.path.join('.'),
                        message: issue.message,
                    })),
                });
            }

            const result = await authService.login(validation.data);

            return res.status(200).json({
                success: true,
                message: 'Login successful',
                data: result,
            });
        } catch (error) {
            if (
                error instanceof Error &&
                error.message === 'INVALID_CREDENTIALS'
            ) {
                return res.status(401).json({
                    success: false,
                    message: 'Invalid email or password',
                });
            }

            if (
                error instanceof Error &&
                error.message === 'ACCOUNT_INACTIVE'
            ) {
                return res.status(403).json({
                    success: false,
                    message: 'Your account is not active',
                });
            }

            console.error('Login error:', error);

            return res.status(500).json({
                success: false,
                message: 'Something went wrong while logging in',
            });
        }
    }

    async refresh(req: Request, res: Response) {
        try {
            const validation = refreshTokenSchema.safeParse(req.body);

            if (!validation.success) {
                return res.status(400).json({
                    success: false,
                    message: 'Validation failed',
                    errors: validation.error.issues.map((issue) => ({
                        field: issue.path.join('.'),
                        message: issue.message,
                    })),
                });
            }

            const result = await authService.refresh(validation.data);

            return res.status(200).json({
                success: true,
                message: 'Token refreshed successfully',
                data: result,
            });
        } catch (error) {
            if (
                error instanceof Error &&
                error.message === 'INVALID_REFRESH_TOKEN'
            ) {
                return res.status(401).json({
                    success: false,
                    message: 'Invalid or expired refresh token',
                });
            }

            if (
                error instanceof Error &&
                error.message === 'ACCOUNT_INACTIVE'
            ) {
                return res.status(403).json({
                    success: false,
                    message: 'Your account is not active',
                });
            }

            console.error('Refresh token error:', error);

            return res.status(500).json({
                success: false,
                message: 'Something went wrong while refreshing the token',
            });
        }
    }

    async logout(req: Request, res: Response) {
        try {
            const refreshToken = req.body?.refreshToken;
            const userId = (req as AuthenticatedRequest).userId;

            await authService.logout(refreshToken, userId);

            return res.status(200).json({
                success: true,
                message: 'Logout successful',
            });
        } catch (error) {
            console.error('Logout error:', error);

            return res.status(500).json({
                success: false,
                message: 'Something went wrong while logging out',
            });
        }
    }

    async forgotPassword(req: Request, res: Response) {
        try {
            const validation = forgotPasswordSchema.safeParse(req.body);

            if (!validation.success) {
                return res.status(400).json({
                    success: false,
                    message: 'Validation failed',
                    errors: validation.error.issues.map((issue) => ({
                        field: issue.path.join('.'),
                        message: issue.message,
                    })),
                });
            }

            const result = await authService.forgotPassword(validation.data.email);

            return res.status(200).json({
                success: true,
                message: result.message,
            });
        } catch (error) {
            if (
                error instanceof Error &&
                error.message === 'ACCOUNT_INACTIVE'
            ) {
                return res.status(403).json({
                    success: false,
                    message: 'Your account is not active',
                });
            }

            console.error('Forgot password error:', error);

            return res.status(500).json({
                success: false,
                message: 'Something went wrong while processing your request',
            });
        }
    }

    async verifyOtp(req: Request, res: Response) {
        try {
            const validation = verifyOtpSchema.safeParse(req.body);

            if (!validation.success) {
                return res.status(400).json({
                    success: false,
                    message: 'Validation failed',
                    errors: validation.error.issues.map((issue) => ({
                        field: issue.path.join('.'),
                        message: issue.message,
                    })),
                });
            }

            await authService.verifyOtp(validation.data.email, validation.data.otp);

            return res.status(200).json({
                success: true,
                message: 'Verification code verified successfully',
            });
        } catch (error) {
            if (
                error instanceof Error &&
                error.message === 'INVALID_OR_EXPIRED_OTP'
            ) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid or expired verification code',
                });
            }

            console.error('Verify OTP error:', error);

            return res.status(500).json({
                success: false,
                message: 'Something went wrong while verifying code',
            });
        }
    }

    async resetPassword(req: Request, res: Response) {
        try {
            const validation = resetPasswordSchema.safeParse(req.body);

            if (!validation.success) {
                return res.status(400).json({
                    success: false,
                    message: 'Validation failed',
                    errors: validation.error.issues.map((issue) => ({
                        field: issue.path.join('.'),
                        message: issue.message,
                    })),
                });
            }

            await authService.resetPassword(validation.data);

            return res.status(200).json({
                success: true,
                message: 'Password has been reset successfully. Please sign in.',
            });
        } catch (error) {
            if (
                error instanceof Error &&
                error.message === 'INVALID_OR_EXPIRED_OTP'
            ) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid or expired verification code',
                });
            }

            console.error('Reset password error:', error);

            return res.status(500).json({
                success: false,
                message: 'Something went wrong while resetting your password',
            });
        }
    }

    async verifyEmailOtp(req: Request, res: Response) {
        try {
            const validation = verifyEmailOtpSchema.safeParse(req.body);

            if (!validation.success) {
                return res.status(400).json({
                    success: false,
                    message: 'Validation failed',
                    errors: validation.error.issues.map((issue) => ({
                        field: issue.path.join('.'),
                        message: issue.message,
                    })),
                });
            }

            const result = await authService.verifyEmailOtp(validation.data);

            return res.status(200).json({
                success: true,
                message: 'Email verified successfully! Welcome to EmyChat.',
                data: result,
            });
        } catch (error) {
            if (
                error instanceof Error &&
                error.message === 'INVALID_OR_EXPIRED_OTP'
            ) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid or expired verification code',
                });
            }

            if (
                error instanceof Error &&
                error.message === 'EMAIL_ALREADY_VERIFIED'
            ) {
                return res.status(400).json({
                    success: false,
                    message: 'This email is already verified. Please sign in.',
                });
            }

            console.error('Verify email OTP error:', error);

            return res.status(500).json({
                success: false,
                message: 'Something went wrong while verifying email',
            });
        }
    }

    async resendVerificationOtp(req: Request, res: Response) {
        try {
            const validation = resendVerificationOtpSchema.safeParse(req.body);

            if (!validation.success) {
                return res.status(400).json({
                    success: false,
                    message: 'Validation failed',
                    errors: validation.error.issues.map((issue) => ({
                        field: issue.path.join('.'),
                        message: issue.message,
                    })),
                });
            }

            const result = await authService.resendVerificationOtp(validation.data.email);

            return res.status(200).json({
                success: true,
                message: result.message,
            });
        } catch (error) {
            console.error('Resend verification OTP error:', error);

            return res.status(500).json({
                success: false,
                message: 'Something went wrong while resending verification code',
            });
        }
    }

    async google(req: Request, res: Response) {
        try {
            const validation = googleAuthSchema.safeParse(req.body);

            if (!validation.success) {
                return res.status(400).json({
                    success: false,
                    message: 'Validation failed',
                    errors: validation.error.issues.map((issue) => ({
                        field: issue.path.join('.'),
                        message: issue.message,
                    })),
                });
            }

            const result = await authService.googleAuth(validation.data);

            return res.status(200).json({
                success: true,
                message: 'Google authentication successful',
                data: result,
            });
        } catch (error) {
            console.error('Google auth error:', error);

            return res.status(401).json({
                success: false,
                message: error instanceof Error ? error.message : 'Google authentication failed',
            });
        }
    }

    async me(req: AuthenticatedRequest, res: Response) {
        try {
            const user = await authService.getProfile(req.userId!);

            return res.status(200).json({
                success: true,
                data: { user },
            });
        } catch (error) {
            console.error('Profile error:', error);

            return res.status(500).json({
                success: false,
                message: 'Unable to retrieve user profile',
            });
        }
    }

}

export default new AuthController();