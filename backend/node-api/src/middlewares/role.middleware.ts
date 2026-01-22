import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';
import { getAuthUserRole } from '../utils/request-user';

// ===============================
// ROLES MIDDLEWARE
// ===============================
export const requireRole =
  (allowedRoles: Array<'ADMIN' | 'CLIENT' | 'SYSTEM'>) =>
  (req: Request, res: Response, next: NextFunction): void => {
    try {
      const role = getAuthUserRole(req);

      if (!role) {
        logger.warn('User role not found on request');
        res.status(403).json({ message: 'Forbidden' });
        return;
      }

      if (!allowedRoles.includes(role as any)) {
        logger.warn('User role not allowed', { role, allowedRoles });
        res.status(403).json({ message: 'Forbidden' });
        return;
      }

      next();
    } catch (error) {
      logger.error('Role middleware failed', { error });
      res.status(500).json({ message: 'Role validation error' });
    }
  };
