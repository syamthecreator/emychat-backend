/**
 * Email & OTP Dispatcher for EmyChat.
 * Delegates OTP and transactional email delivery to the Verifly microservice,
 * with a clean console logging fallback when VERIFLY_API_KEY is not set.
 */

export interface EmailOptions {
    to: string;
    subject: string;
    html: string;
    text: string;
}

const DEFAULT_VERIFLY_URL = 'https://verifly-t5sl.onrender.com';

function getVeriflyConfig() {
    const baseUrl = (process.env.VERIFLY_URL?.trim() || DEFAULT_VERIFLY_URL).replace(/\/+$/, '');
    const apiKey = process.env.VERIFLY_API_KEY?.trim() || '';
    return { baseUrl, apiKey };
}

function logDevFallback(to: string, subject: string, text: string) {
    console.log('\n================================================================');
    console.log(`[EMAIL DISPATCH] To: ${to}`);
    console.log(`[EMAIL DISPATCH] Subject: ${subject}`);
    console.log('----------------------------------------------------------------');
    console.log(text.trim());
    console.log('================================================================\n');
}

export async function sendEmail(options: EmailOptions): Promise<boolean> {
    const { to, subject, html, text } = options;
    const { baseUrl, apiKey } = getVeriflyConfig();

    if (apiKey) {
        try {
            const res = await fetch(`${baseUrl}/api/v1/email/send`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': apiKey,
                },
                body: JSON.stringify({
                    to,
                    subject,
                    html,
                    text,
                    fromName: 'EmyChat',
                }),
            });

            if (res.ok) {
                console.log(`[EMAIL DISPATCH] Sent via Verifly to ${to}`);
                return true;
            }
            const errBody = await res.text();
            console.error(`[EMAIL DISPATCH] Verifly error (${res.status}):`, errBody);
        } catch (err) {
            console.error('[EMAIL DISPATCH] Verifly request failed:', err);
        }
    }

    logDevFallback(to, subject, text);
    return true;
}

async function sendOtpViaVerifly(params: {
    to: string;
    otp: string;
    type: 'verification' | 'password_reset';
    expiresInMinutes?: number;
}): Promise<boolean> {
    const { baseUrl, apiKey } = getVeriflyConfig();

    if (apiKey) {
        try {
            const res = await fetch(`${baseUrl}/api/v1/email/send-otp`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': apiKey,
                },
                body: JSON.stringify({
                    appName: 'EmyChat',
                    to: params.to,
                    otp: params.otp,
                    type: params.type,
                    expiresInMinutes: params.expiresInMinutes ?? 15,
                }),
            });

            if (res.ok) {
                console.log(
                    `[EMAIL DISPATCH] ${params.type} OTP sent via Verifly to ${params.to}`,
                );
                return true;
            }
            const errBody = await res.text();
            console.error(`[EMAIL DISPATCH] Verifly send-otp error (${res.status}):`, errBody);
        } catch (err) {
            console.error('[EMAIL DISPATCH] Verifly send-otp request failed:', err);
        }
    }

    const subject =
        params.type === 'verification'
            ? `Your EmyChat Verification Code: ${params.otp}`
            : `Your EmyChat Password Reset Code: ${params.otp}`;
    logDevFallback(params.to, subject, `OTP Code: [ ${params.otp} ]`);
    return true;
}

export async function sendEmailVerificationOtp(
    email: string,
    otp: string,
): Promise<boolean> {
    return sendOtpViaVerifly({
        to: email,
        otp,
        type: 'verification',
        expiresInMinutes: 15,
    });
}

export async function sendPasswordResetOtp(
    email: string,
    otp: string,
): Promise<boolean> {
    return sendOtpViaVerifly({
        to: email,
        otp,
        type: 'password_reset',
        expiresInMinutes: 15,
    });
}
