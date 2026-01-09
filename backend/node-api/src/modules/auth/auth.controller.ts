// modules/auth/auth.controller.ts
import { Request, Response } from 'express';
import { z, ZodError } from 'zod';
import { AuthService } from './auth.service';
import { getAuthUserId } from '../../utils/request-user';
import { logger } from '../../utils/logger';

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

}
