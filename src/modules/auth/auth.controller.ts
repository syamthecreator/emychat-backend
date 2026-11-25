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
    googleConfigSchema,
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

    async googleConfig(_req: Request, res: Response) {
        const config = authService.getGoogleConfig();
        return res.status(200).json({
            success: true,
            data: config,
        });
    }

    async saveGoogleConfig(req: Request, res: Response) {
        try {
            const validation = googleConfigSchema.safeParse(req.body);
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

            const result = authService.saveGoogleConfig(validation.data);
            return res.status(200).json({
                success: true,
                message: 'Google credentials saved successfully',
                data: result,
            });
        } catch (error) {
            console.error('Save Google config error:', error);
            return res.status(500).json({
                success: false,
                message: 'Failed to save Google configuration',
            });
        }
    }

    async googleLogin(req: Request, res: Response) {
        try {
            const host = req.get('host');
            const url = authService.getGoogleAuthUrl(host);
            return res.redirect(url);
        } catch (error) {
            if (
                error instanceof Error &&
                error.message === 'MISSING_GOOGLE_CLIENT_ID'
            ) {
                return res.status(400).send(`
                    <!DOCTYPE html>
                    <html>
                    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 48px 24px; text-align: center; background: #0f172a; color: #f8fafc;">
                        <div style="max-width: 500px; margin: 0 auto; background: #1e293b; padding: 32px; border-radius: 12px; border: 1px solid #334155;">
                            <h2 style="color: #ef4444; margin-top: 0;">Google Cloud Setup Required</h2>
                            <p style="color: #94a3b8; font-size: 14px; line-height: 1.6;">
                                Real Google OAuth requires a Google OAuth Client ID configured in your environment.
                            </p>
                            <div style="background: #0f172a; padding: 14px; border-radius: 8px; font-family: monospace; font-size: 13px; color: #38bdf8; text-align: left; margin: 20px 0; word-break: break-all;">
                                GOOGLE_CLIENT_ID="your-client-id.apps.googleusercontent.com"<br>
                                GOOGLE_CLIENT_SECRET="your-client-secret"
                            </div>
                            <p style="color: #cbd5e1; font-size: 13px;">
                                Add these keys into <code>backend/.env</code> from your Google Cloud Console project.
                            </p>
                            <button onclick="window.close()" style="margin-top: 16px; padding: 10px 24px; background: #2563eb; color: white; border: none; border-radius: 6px; font-weight: bold; cursor: pointer;">Close Window</button>
                        </div>
                    </body>
                    </html>
                `);
            }
            return res.status(500).json({
                success: false,
                message: 'Failed to initiate Google login',
            });
        }
    }

    async googleCallback(req: Request, res: Response) {
        try {
            const code = req.query.code as string;
            if (!code) {
                return res.status(400).send('Authorization code missing from Google callback');
            }

            const host = req.get('host');
            const result = await authService.handleGoogleCallback(code, host);

            return res.status(200).send(`
                <!DOCTYPE html>
                <html>
                <head>
                    <title>Authenticating with Google...</title>
                </head>
                <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #f8fafc; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0;">
                    <div style="text-align: center;">
                        <h3 style="color: #38bdf8; margin-bottom: 8px;">Google authentication successful!</h3>
                        <p style="color: #94a3b8; font-size: 14px;">Connecting to your workspace...</p>
                    </div>
                    <script>
                        const payload = ${JSON.stringify(result)};
                        if (window.opener && !window.opener.closed) {
                            window.opener.postMessage({
                                type: 'GOOGLE_AUTH_SUCCESS',
                                data: payload
                            }, '*');
                            setTimeout(() => window.close(), 600);
                        } else {
                            const frontendUrl = "${process.env.FRONTEND_URL || 'http://localhost:59314'}";
                            window.location.href = frontendUrl + '/#/dashboard';
                        }
                    </script>
                </body>
                </html>
            `);
        } catch (error) {
            console.error('Google callback error:', error);
            return res.status(500).send(`
                <!DOCTYPE html>
                <html>
                <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #f8fafc; padding: 40px; text-align: center;">
                    <h3 style="color: #ef4444;">Google Authentication Failed</h3>
                    <p style="color: #94a3b8; font-size: 14px;">${error instanceof Error ? error.message : 'Unknown error'}</p>
                    <button onclick="window.close()" style="margin-top: 20px; padding: 10px 20px; background: #2563eb; color: white; border: none; border-radius: 6px; cursor: pointer;">Close</button>
                </body>
                </html>
            `);
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