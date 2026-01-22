// modules/documents/documents.module.ts
import { Router } from 'express';
import { DocumentsController } from './documents.controller';
import { authMiddleware } from '../../middlewares/auth.middleware';
import { requireRole } from '../../middlewares/role.middleware';
import { uploadMiddleware } from '../../middlewares/upload.middleware';

// ===============================
// DOCUMENTS MODULE
// ===============================
export const documentsModule = (): Router => {
  const router = Router();

  // ===============================
  // UPLOAD DOCUMENT (AUTHENTICATED)
  // ===============================
  router.post(
    '/:requestId/upload',
    authMiddleware,
    uploadMiddleware.array('files'),
    DocumentsController.upload
  );

  // ===============================
  // LIST MY DOCUMENTS (AUTHENTICATED)
  // ===============================
  router.get(
    '/me',
    authMiddleware,
    DocumentsController.listMyDocuments
  );

  // ===============================
  // GET DOCUMENT BY ID (AUTHENTICATED)
  // ===============================
  // Place signed-url route before generic id matcher
  router.get(
    '/:id/signed-url',
    authMiddleware,
    DocumentsController.getSignedUrl
  );

  router.get(
    '/:id',
    authMiddleware,
    DocumentsController.getById
  );

  // ===============================
  // DOWNLOAD DOCUMENT (AUTHENTICATED)
  // ===============================
  router.get(
    '/:id/download',
    authMiddleware,
    DocumentsController.download
  );

  // ===============================
  // DELETE DOCUMENT (AUTHENTICATED)
  // ===============================
  router.delete(
    '/:id',
    authMiddleware,
    DocumentsController.delete
  );

  // ===============================
  // LIST ALL DOCUMENTS (ADMIN ONLY)
  // ===============================
  router.get(
    '/',
    authMiddleware,
    requireRole(['ADMIN']),
    DocumentsController.listAll
  );

  return router;
};
