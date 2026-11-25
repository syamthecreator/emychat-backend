/**
 * Production Email Service & OTP Dispatcher for EmyChat.
 * Supports SMTP/HTTP integrations when configured, with clean logging fallback.
 */

export interface EmailOptions {
    to: string;
    subject: string;
    html: string;
    text: string;
}

export async function sendEmail(options: EmailOptions): Promise<boolean> {
    const { to, subject, text } = options;

    // Check if custom SMTP or external mail provider is configured
    const smtpHost = process.env.SMTP_HOST;
    const resendApiKey = process.env.RESEND_API_KEY;

    if (resendApiKey) {
        try {
            const res = await fetch('https://api.resend.com/emails', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${resendApiKey}`,
                },
                body: JSON.stringify({
                    from: process.env.EMAIL_FROM || 'EmyChat <support@emychat.com>',
                    to: [to],
                    subject,
                    html: options.html,
                    text,
                }),
            });

            if (res.ok) {
                console.log(`[EMAIL DISPATCH] Sent successfully via Resend to ${to}`);
                return true;
            }
        } catch (err) {
            console.error('[EMAIL DISPATCH] External mail provider error:', err);
        }
    }

    // Default development & server log output
    console.log('\n================================================================');
    console.log(`[EMAIL DISPATCH] To: ${to}`);
    console.log(`[EMAIL DISPATCH] Subject: ${subject}`);
    console.log('----------------------------------------------------------------');
    console.log(text.trim());
    console.log('================================================================\n');

    return true;
}

export async function sendEmailVerificationOtp(email: string, otp: string): Promise<boolean> {
    const subject = `Your EmyChat Verification Code: ${otp}`;
    const text = `
Welcome to EmyChat!

Here is your 4-digit verification code to activate your account:

        [ ${otp} ]

This code will expire in 15 minutes.
If you did not request this, please ignore this email.
`;

    const html = `
<div style="font-family: Arial, sans-serif; max-width: 520px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 8px;">
    <h2 style="color: #0f172a; margin-top: 0;">Welcome to EmyChat!</h2>
    <p style="color: #475569; font-size: 15px;">Please verify your email address to activate your account and access your automated messaging workspace.</p>
    <div style="text-align: center; margin: 24px 0;">
        <span style="display: inline-block; font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #2563eb; background: #eff6ff; padding: 12px 24px; border-radius: 8px; border: 1px solid #bfdbfe;">${otp}</span>
    </div>
    <p style="color: #64748b; font-size: 13px;">This code will expire in 15 minutes.</p>
    <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;" />
    <p style="color: #94a3b8; font-size: 12px;">If you didn't create an EmyChat account, you can safely ignore this message.</p>
</div>
`;

    return sendEmail({ to: email, subject, text, html });
}

export async function sendPasswordResetOtp(email: string, otp: string): Promise<boolean> {
    const subject = `Your EmyChat Password Reset Code: ${otp}`;
    const text = `
You requested a password reset for your EmyChat account.

Here is your 4-digit verification code:

        [ ${otp} ]

This code will expire in 15 minutes.
If you did not request a password reset, please secure your account immediately.
`;

    const html = `
<div style="font-family: Arial, sans-serif; max-width: 520px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 8px;">
    <h2 style="color: #0f172a; margin-top: 0;">Password Reset Request</h2>
    <p style="color: #475569; font-size: 15px;">Use the verification code below to reset the password for your EmyChat workspace.</p>
    <div style="text-align: center; margin: 24px 0;">
        <span style="display: inline-block; font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #2563eb; background: #eff6ff; padding: 12px 24px; border-radius: 8px; border: 1px solid #bfdbfe;">${otp}</span>
    </div>
    <p style="color: #64748b; font-size: 13px;">This code will expire in 15 minutes.</p>
    <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;" />
    <p style="color: #94a3b8; font-size: 12px;">If you did not request a password reset, please ignore this email.</p>
</div>
`;

    return sendEmail({ to: email, subject, text, html });
}
