import { Router } from 'express';
import authController from './auth.controller';
import { authenticate } from '../../middleware/auth.middleware';

const router = Router();

router.post('/register', (req, res) =>
    authController.register(req, res),
);
router.post('/verify-email-otp', (req, res) =>
    authController.verifyEmailOtp(req, res),
);
router.post('/resend-verification-otp', (req, res) =>
    authController.resendVerificationOtp(req, res),
);
router.get('/google/config', (req, res) =>
    authController.googleConfig(req, res),
);
router.post('/google/config', (req, res) =>
    authController.saveGoogleConfig(req, res),
);
router.get('/google/login', (req, res) =>
    authController.googleLogin(req, res),
);
router.get('/google/callback', (req, res) =>
    authController.googleCallback(req, res),
);
router.post('/google', (req, res) =>
    authController.google(req, res),
);
router.post('/login', (req, res) =>
    authController.login(req, res),
);
router.post('/refresh', (req, res) =>
    authController.refresh(req, res),
);
router.post('/logout', (req, res) =>
    authController.logout(req, res),
);
router.post('/forgot-password', (req, res) =>
    authController.forgotPassword(req, res),
);
router.post('/verify-otp', (req, res) =>
    authController.verifyOtp(req, res),
);
router.post('/reset-password', (req, res) =>
    authController.resetPassword(req, res),
);
router.get('/me', authenticate, (req, res) =>
    authController.me(req, res),
);

export default router;