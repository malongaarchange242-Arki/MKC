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
  // LIST MY DISPUTES (Must be first to avoid :requestId collision)
  // ===============================
  router.get(
    '/disputes',
    authMiddleware,
    RequestsController.getMyDisputes
  );

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
  // CREATE MESSAGE / DISPUTE (CLIENT / ADMIN)
  // ===============================
  router.post(
    '/:requestId/messages',
    authMiddleware,
    uploadMiddleware.single('file'),
    RequestsController.createMessage
  );
  // GET messages for a request
  router.get(
    '/:requestId/messages',
    authMiddleware,
    RequestsController.getMessages
  );

  // Documents list for a request (client/admin)
  router.get(
    '/:requestId/documents',
    authMiddleware,
    RequestsController.getDocuments
  );

  // Create dispute for a request
  router.post(
    '/:requestId/disputes',
    authMiddleware,
    uploadMiddleware.single('file'),
    RequestsController.createDispute
  );

  // List disputes for a request
  router.get(
    '/:requestId/disputes',
    authMiddleware,
    RequestsController.getDisputes
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

  // ===============================
  // PARTIAL UPDATE (CLIENT)
  // ===============================
  router.patch(
    '/:requestId',
    authMiddleware,
    requireRole(['CLIENT']),
    RequestsController.update
  );

  return router;
};
