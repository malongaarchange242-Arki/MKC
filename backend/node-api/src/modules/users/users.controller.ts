// modules/users/users.controller.ts
import { Request, Response } from 'express';
import { z, ZodError } from 'zod';
import { UsersService, UpdateProfileInput } from './users.service';
import { getAuthUserId } from '../../utils/request-user';
import { logger } from '../../utils/logger';

// ===============================
// TYPES
// ===============================
type AuthRequest = Request & {
  user?: {
    id: string;
    email: string;
    role: 'CLIENT' | 'ADMIN' | 'SYSTEM';
  };
};

// ===============================
// SCHEMAS
// ===============================
const updateProfileSchema = z.object({
  nom: z.string().min(2).optional(),
  prenom: z.string().min(2).optional()
});

const updateRoleSchema = z.object({
  role: z.enum(['CLIENT', 'ADMIN', 'SYSTEM'])
});

// ===============================
// HELPER ERROR HANDLER
// ===============================
const handleControllerError = (
  res: Response,
  error: unknown,
  context = ''
) => {
  logger.error(`${context} failed`, { error });

  if (error instanceof ZodError) {
    return res.status(422).json({
      message: 'Invalid payload',
      errors: error.flatten().fieldErrors
    });
  }

  if (error instanceof Error) {
    return res.status(400).json({
      message: error.message
    });
  }

  return res.status(500).json({
    message: 'Unexpected error'
  });
};

// ===============================
// CONTROLLER
// ===============================
export class UsersController {
  // ===============================
  // GET MY PROFILE
  // ===============================
  static async getMe(req: AuthRequest, res: Response) {
    try {
      const userId = getAuthUserId(req);
      if (!userId) return res.status(401).json({ message: 'Unauthorized' });

      const profile = await UsersService.getMe(userId);

      return res.status(200).json({
        success: true,
        profile
      });
    } catch (error: unknown) {
      return handleControllerError(res, error, 'Get profile');
    }
  }

  // ===============================
  // UPDATE MY PROFILE
  // ===============================
  static async updateMe(req: AuthRequest, res: Response) {
    try {
      const userId = getAuthUserId(req);
      if (!userId) return res.status(401).json({ message: 'Unauthorized' });

      const body = updateProfileSchema.parse(req.body);
      const profile = await UsersService.updateMe(userId, body);

      return res.status(200).json({
        success: true,
        profile
      });
    } catch (error: unknown) {
      return handleControllerError(res, error, 'Update profile');
    }
  }

  // ===============================
  // GET USER BY ID (ADMIN ONLY)
  // ===============================
  static async getUserById(req: AuthRequest, res: Response) {
    try {
      if (!req.user) {
        return res.status(401).json({ message: 'Unauthorized' });
      }

      const userId = req.params.id;
      const profile = await UsersService.getUserById(userId);

      return res.status(200).json({
        success: true,
        profile
      });
    } catch (error: unknown) {
      return handleControllerError(res, error, 'Get user by ID');
    }
  }

  // ===============================
  // LIST ALL USERS (ADMIN ONLY)
  // ===============================
  static async listUsers(req: AuthRequest, res: Response) {
    try {
      if (!req.user) {
        return res.status(401).json({ message: 'Unauthorized' });
      }

      const limit = Number(req.query.limit) || 50;
      const offset = Number(req.query.offset) || 0;

      const users = await UsersService.listUsers(limit, offset);

      return res.status(200).json({
        success: true,
        users,
        count: users.length
      });
    } catch (error: unknown) {
      return handleControllerError(res, error, 'List users');
    }
  }

  // ===============================
  // UPDATE USER ROLE (ADMIN ONLY)
  // ===============================
  static async updateUserRole(req: AuthRequest, res: Response) {
    try {
      if (!req.user) {
        return res.status(401).json({ message: 'Unauthorized' });
      }

      const userId = req.params.id;
      const body = updateRoleSchema.parse(req.body);

      const profile = await UsersService.updateUserRole(userId, body.role);

      return res.status(200).json({
        success: true,
        profile
      });
    } catch (error: unknown) {
      return handleControllerError(res, error, 'Update user role');
    }
  }
}
