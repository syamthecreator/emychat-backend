
import { Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { AuthenticatedRequest } from '../modules/auth/auth.types';

interface AccessTokenPayload {
    sub: string;
}

export const authenticate = (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction,
) => {
    try {
        const authorization = req.headers.authorization;

        if (!authorization?.startsWith('Bearer ')) {
            return res.status(401).json({
                success: false,
                message: 'Authentication required',
            });
        }

        const token = authorization.slice(7).trim();
        const secret = process.env.JWT_ACCESS_SECRET;

        if (!secret || !token) {
            return res.status(401).json({
                success: false,
                message: 'Invalid authentication token',
            });
        }

        const decoded = jwt.verify(token, secret, {
            algorithms: ['HS256'],
        });

        if (
            typeof decoded === 'string' ||
            typeof decoded.sub !== 'string' ||
            !decoded.sub
        ) {
            return res.status(401).json({
                success: false,
                message: 'Invalid authentication token',
            });
        }

        req.userId = decoded.sub;

        return next();
    } catch {
        return res.status(401).json({
            success: false,
            message: 'Invalid or expired access token',
        });
    }
};
