// modules/auth/auth.controller.ts
import { Request, Response } from 'express';
import { z, ZodError } from 'zod';
import { AuthService } from './auth.service';
import { getAuthUserId } from '../../utils/request-user';
import { logger } from '../../utils/logger';
import { JWTUtils } from '../../utils/jwt';
import { NotificationsService } from '../notifications/notifications.service';
import { supabase } from '../../config/supabase';

// ===============================
// SCHEMAS (ZOD)
// ===============================

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  nom: z.string().min(2),
  prenom: z.string().min(2),
  role: z.enum(['CLIENT', 'ADMIN', 'SYSTEM']).optional()
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8)
});

// ===============================
// HELPER ERROR HANDLER
// ===============================
const handleControllerError = (
  res: Response,
  error: unknown,
  context = ''
) => {
  // Normalize error logging so the message and stack are visible in logs
  if (error instanceof ZodError) {
    logger.error(`${context} failed`, { message: 'Validation error', details: error.format() });
    return res.status(422).json({
      success: false,
      message: 'Invalid payload',
      errors: error.format()
    });
  }

  // ===============================
  // MAGIC LINK REQUEST
  // ===============================
  // (magic link handlers moved into `AuthController` below)

  if (error instanceof Error) {
    logger.error(`${context} failed`, { message: error.message, stack: error.stack });

    // Map common business errors to more appropriate status codes
    const msg = error.message || '';
    if (msg.toLowerCase().includes('already') || msg.toLowerCase().includes('exists') || msg.toLowerCase().includes('email')) {
      return res.status(409).json({ success: false, message: msg });
    }
    return res.status(400).json({
      success: false,
      message: msg
    });
  }

  logger.error(`${context} failed`, { error });
  return res.status(500).json({
    success: false,
    message: 'Unexpected error'
  });
};

// ===============================
// CONTROLLER
// ===============================
export class AuthController {
  // ===============================
  // REGISTER
  // ===============================
  static async register(req: Request, res: Response) {
    try {
      const body = registerSchema.parse(req.body);

      const result = await AuthService.register(body);

      // Notify admins about new user registration (non-blocking)
      try {
        NotificationsService.send({
          userId: result.user.id,
          type: 'USER_REGISTERED',
          title: 'Nouvelle inscription',
          message: `Nouvel utilisateur inscrit: ${result.user.email || ''}`,
          channels: ['email']
        }).catch(e => logger.warn('Admin registration notification failed', { e }));
      } catch (e) {
        logger.warn('Failed to trigger registration notification', { e });
      }

      return res.status(201).json({
        success: true,
        user: result.user
      });
    } catch (error: unknown) {
      return handleControllerError(res, error, 'Register');
    }
  }

  // ===============================
  // LOGIN
  // ===============================
  static async login(req: Request, res: Response) {
    try {
      const body = loginSchema.parse(req.body);

      const result = await AuthService.login(body);

      return res.status(200).json({
        success: true,
        user: result.user,
        session: result.session
      });
    } catch (error: unknown) {
      return handleControllerError(res, error, 'Login');
    }
  }

  // ===============================
  // LOGOUT
  // ===============================
  static async logout(req: Request, res: Response) {
    try {
      // Le logout côté client consiste simplement à supprimer le token
      // Ici on peut ajouter une logique de blacklist si nécessaire
      return res.status(200).json({
        success: true,
        message: 'Logged out successfully'
      });
    } catch (error: unknown) {
      return handleControllerError(res, error, 'Logout');
    }
  }

  // ===============================
  // GET PROFILE
  // ===============================
  // ===============================
  // GET PROFILE (ME)
  // ===============================
  static async profile(req: Request, res: Response) {
    try {
      const authUserId = getAuthUserId(req);

      if (!authUserId) {
        return res.status(401).json({
          success: false,
          message: 'Unauthorized'
        });
      }

      logger.info('Controller get profile', { userId: authUserId });

      const profile = await AuthService.getProfile(authUserId);

      return res.status(200).json({
        success: true,
        profile
      });
    } catch (error: unknown) {
      return handleControllerError(res, error, 'Get profile');
    }
  }

  // ===============================
  // MAGIC LINK REQUEST
  // ===============================
  static async requestMagic(req: Request, res: Response) {
    try {
      const body = z.object({ email: z.string().email(), redirect: z.string().optional() }).parse(req.body);
      const email = body.email;
      const redirect = body.redirect || '/';

      // Try to resolve profile silently
      let profile: any = null;
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('id, prenom')
          .eq('email', email)
          .maybeSingle();
        if (error) {
          logger.warn('Profile lookup failed for magic link', { email, error });
        }
        profile = data || null;
      } catch (e) {
        logger.warn('Supabase profile lookup error (magic request)', { e });
      }

      // Always return 200 to avoid user enumeration
      if (!profile || !profile.id) {
        // Do not send an email if user not found, but respond success
        return res.status(200).json({ success: true });
      }

      // generate magic token
      const token = JWTUtils.generateMagicToken({ sub: profile.id, email, redirect });

      const apiBase = (process.env.API_BASE_URL || 'https://mkc-backend-kqov.onrender.com').replace(/\/$/, '');
      const link = `${apiBase}/auth/magic/redirect?token=${encodeURIComponent(token)}`;

      // send notification email with link
      await NotificationsService.send({
        userId: profile.id,
        type: 'MAGIC_LINK',
        title: 'Access your document',
        message: `Click the link to open your document (valid for 15 minutes).`,
        links: [{ name: 'Open document', url: link, expires_in: 900 }],
        language: 'fr'
      });

      return res.status(200).json({ success: true });
    } catch (error: unknown) {
      return handleControllerError(res, error, 'Request magic link');
    }
  }

  // ===============================
  // MAGIC LINK REDIRECT / CONSUME
  // ===============================
  static async consumeMagicRedirect(req: Request, res: Response) {
    try {
      const token = (req.query.token || req.body.token || req.params.token) as string;
      if (!token) return res.status(400).send('Missing token');

      const payload: any = JWTUtils.verifyMagicToken(token);
      const userId = payload.sub as string;
      const email = payload.email as string;
      const redirect = payload.redirect || '/';

      // fetch role from profile
      let role: any = 'CLIENT';
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('role')
          .eq('id', userId)
          .maybeSingle();
        if (!error && data && data.role) role = data.role;
      } catch (e) {
        logger.warn('Failed to fetch profile role during magic consume', { e, userId });
      }

      // generate application session token (24h)
      const appToken = JWTUtils.generateToken({ sub: userId, email, role });

      const frontendBase = (process.env.FRONTEND_URL || 'https://feri-mkc.com').replace(/\/$/, '');
      // redirect to a small frontend helper page that stores token then navigates
      // Place token in query string as a fallback for email clients that strip fragments.
      // The frontend consumer will accept token from either query or fragment.
      const consumeUrl = `${frontendBase}/_magic_consume.html?token=${encodeURIComponent(appToken)}&redirect=${encodeURIComponent(redirect)}`;

      return res.redirect(302, consumeUrl);
    } catch (error: unknown) {
      logger.warn('Magic consume failed', { error });
      return res.status(400).send('Invalid or expired magic link');
    }
  }

  // ===============================
  // RESET PASSWORD (after magic-consume stores app token)
  // ===============================
  static async resetPassword(req: Request, res: Response) {
    try {
      const authUserId = (req as any).authUserId;
      if (!authUserId) return res.status(401).json({ success: false, message: 'Unauthorized' });

      const body = z.object({ password: z.string().min(8) }).parse(req.body);

      // Delegate to AuthService to perform password update via Supabase admin API
      await AuthService.changePassword(authUserId, body.password);

      // On success, return generic success
      return res.status(200).json({ success: true, message: 'Password updated' });
    } catch (error: unknown) {
      return handleControllerError(res, error, 'Reset password');
    }
  }

}
