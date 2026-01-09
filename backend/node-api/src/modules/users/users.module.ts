// modules/users/users.module.ts
import { Router } from 'express';
import { UsersController } from './users.controller';
import { authMiddleware } from '../../middlewares/auth.middleware';
import { requireRole } from '../../middlewares/role.middleware';

// ===============================
// USERS MODULE
// ===============================
export const usersModule = (): Router => {
  const router = Router();

  // ===============================
  // MY PROFILE (AUTHENTICATED)
  // ===============================
  router.get(
    '/me',
    authMiddleware,
    UsersController.getMe
  );

  router.patch(
    '/me',
    authMiddleware,
    UsersController.updateMe
  );

  // ===============================
  // ADMIN ROUTES
  // ===============================
  router.get(
    '/',
    authMiddleware,
    requireRole(['ADMIN']),
    UsersController.listUsers
  );

  router.get(
    '/:id',
    authMiddleware,
    requireRole(['ADMIN']),
    UsersController.getUserById
  );

  router.patch(
    '/:id/role',
    authMiddleware,
    requireRole(['ADMIN']),
    UsersController.updateUserRole
  );

  return router;
};
