// modules/auth/auth.module.ts
import { Router, Request, Response, NextFunction } from 'express';
import { AuthController } from './auth.controller';
import { authMiddleware } from '../../middlewares/auth.middleware';

// ===============================
// Helper pour gérer les erreurs async
// ===============================
const asyncHandler =
  (fn: (req: Request, res: Response) => Promise<any>) =>
  (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res)).catch(next);
  };

// ===============================
// AUTH MODULE
// ===============================
export const authModule = (): Router => {
  const router = Router();

  // ===============================
  // PUBLIC ROUTES
  // ===============================
  router.post(
    '/register',
    asyncHandler(AuthController.register)
  );

  router.post(
    '/login',
    asyncHandler(AuthController.login)
  );

  // ===============================
  // PROTECTED ROUTES
  // ===============================
  router.post(
    '/logout',
    authMiddleware,
    asyncHandler(AuthController.logout)
  );

  router.get(
    '/me',
    authMiddleware,
    asyncHandler(AuthController.profile)
  );

  return router;
};
