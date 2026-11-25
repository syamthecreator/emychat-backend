import { z } from 'zod';

export const registerSchema = z.object({
    name: z
        .string()
        .trim()
        .min(2, 'Name must contain at least 2 characters')
        .max(100, 'Name is too long'),

    email: z
        .string()
        .trim()
        .email('Please enter a valid email address')
        .max(255)
        .transform((value) => value.toLowerCase()),

    password: z
        .string()
        .min(6, 'Password must contain at least 6 characters')
        .max(72, 'Password is too long'),
});

export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
    email: z
        .string()
        .trim()
        .email('Please enter a valid email address')
        .transform((value) => value.toLowerCase()),

    password: z
        .string()
        .min(1, 'Password is required')
        .max(72, 'Password is too long'),
});

export type LoginInput = z.infer<typeof loginSchema>;

export const refreshTokenSchema = z.object({
    refreshToken: z
        .string()
        .min(1, 'Refresh token is required'),
});

export type RefreshTokenInput = z.infer<typeof refreshTokenSchema>;

export const logoutSchema = z.object({
    refreshToken: z.string().min(1, 'Refresh token is required').optional(),
});

export type LogoutInput = z.infer<typeof logoutSchema>;

export const forgotPasswordSchema = z.object({
    email: z
        .string()
        .trim()
        .email('Please enter a valid email address')
        .transform((value) => value.toLowerCase()),
});

export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export const verifyOtpSchema = z.object({
    email: z
        .string()
        .trim()
        .email('Please enter a valid email address')
        .transform((value) => value.toLowerCase()),
    otp: z
        .string()
        .trim()
        .min(4, 'Verification code must be at least 4 characters')
        .max(10, 'Verification code is too long'),
});

export type VerifyOtpInput = z.infer<typeof verifyOtpSchema>;

export const resetPasswordSchema = z.object({
    email: z
        .string()
        .trim()
        .email('Please enter a valid email address')
        .transform((value) => value.toLowerCase()),
    otp: z
        .string()
        .trim()
        .min(4, 'Verification code must be at least 4 characters')
        .max(10, 'Verification code is too long'),
    password: z
        .string()
        .min(6, 'Password must contain at least 6 characters')
        .max(72, 'Password is too long'),
});

export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

export const verifyEmailOtpSchema = z.object({
    email: z
        .string()
        .trim()
        .email('Please enter a valid email address')
        .transform((value) => value.toLowerCase()),
    otp: z
        .string()
        .trim()
        .min(4, 'Verification code must be at least 4 characters')
        .max(10, 'Verification code is too long'),
});

export type VerifyEmailOtpInput = z.infer<typeof verifyEmailOtpSchema>;

export const resendVerificationOtpSchema = z.object({
    email: z
        .string()
        .trim()
        .email('Please enter a valid email address')
        .transform((value) => value.toLowerCase()),
});

export type ResendVerificationOtpInput = z.infer<typeof resendVerificationOtpSchema>;

export const googleAuthSchema = z.object({
    idToken: z.string().optional(),
    email: z.string().trim().email().transform((v) => v.toLowerCase()).optional(),
    name: z.string().trim().optional(),
    googleId: z.string().optional(),
    avatarUrl: z.string().optional(),
});

export type GoogleAuthInput = z.infer<typeof googleAuthSchema>;

export const googleConfigSchema = z.object({
    clientId: z.string().trim().min(5, 'Google Client ID is required'),
    clientSecret: z.string().trim().min(5, 'Google Client Secret is required'),
});

export type GoogleConfigInput = z.infer<typeof googleConfigSchema>;


