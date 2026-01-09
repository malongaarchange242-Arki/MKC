// modules/requests/requests.module.ts
import { Router } from 'express';
import { RequestsController } from './requests.controller';
import { authMiddleware } from '../../middlewares/auth.middleware';
import { requireRole } from '../../middlewares/role.middleware';
import { uploadMiddleware } from '../../middlewares/upload.middleware';

// ===============================
// REQUESTS MODULE
// ===============================
export const requestsModule = (): Router => {
  const router = Router();

  // ===============================
  // LIST REQUESTS (CLIENT) - explicit /me route
  // ===============================
  router.get(
    '/me',
    authMiddleware,
    requireRole(['CLIENT']),
    RequestsController.list
  );

  // ===============================
  // CREATE REQUEST (CLIENT ONLY)
  // ===============================
  router.post(
    '/',
    authMiddleware,
    requireRole(['CLIENT']),
    RequestsController.create
  );

  // ===============================
  // UPLOAD PAYMENT PROOF (CLIENT)
  // ===============================
  router.post(
    '/:requestId/payment-proof',
    authMiddleware,
    requireRole(['CLIENT']),
    uploadMiddleware.single('file'),
    RequestsController.submitPaymentProof
  );

  // ===============================
  // TRANSITION STATUS (AUTHENTICATED)
  // ===============================
  router.post(
    '/transition',
    authMiddleware,
    RequestsController.transition
  );

  // ===============================
  // CLIENT SUBMIT (manual)
  // ===============================
  router.post(
    '/:requestId/submit',
    authMiddleware,
    requireRole(['CLIENT']),
    RequestsController.submit
  );

  return router;
};
