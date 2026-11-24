
import {
    createCipheriv,
    createDecipheriv,
    randomBytes,
} from 'crypto';

const ALGORITHM = 'aes-256-gcm';

function getEncryptionKey(): Buffer {
    const secret =
        process.env.TOKEN_ENCRYPTION_KEY ||
        'dnZwDqqZM5EFdXFG3YftIpxjl2A1WXL6GpJ/1mpgN1g=';

    const key = Buffer.from(secret, 'base64');

    if (key.length !== 32) {
        throw new Error('TOKEN_ENCRYPTION_KEY must decode to 32 bytes');
    }

    return key;
}

export function encryptToken(token: string): string {
    const key = getEncryptionKey();
    const iv = randomBytes(12);

    const cipher = createCipheriv(ALGORITHM, key, iv);

    const encrypted = Buffer.concat([
        cipher.update(token, 'utf8'),
        cipher.final(),
    ]);

    const authTag = cipher.getAuthTag();

    return [
        iv.toString('base64'),
        authTag.toString('base64'),
        encrypted.toString('base64'),
    ].join(':');
}

export function decryptToken(encryptedToken: string): string {
    const key = getEncryptionKey();

    const [ivValue, authTagValue, encryptedValue] =
        encryptedToken.split(':');

    if (!ivValue || !authTagValue || !encryptedValue) {
        throw new Error('Invalid encrypted token format');
    }

    const decipher = createDecipheriv(
        ALGORITHM,
        key,
        Buffer.from(ivValue, 'base64'),
    );

    decipher.setAuthTag(Buffer.from(authTagValue, 'base64'));

    const decrypted = Buffer.concat([
        decipher.update(Buffer.from(encryptedValue, 'base64')),
        decipher.final(),
    ]);

    return decrypted.toString('utf8');
}
