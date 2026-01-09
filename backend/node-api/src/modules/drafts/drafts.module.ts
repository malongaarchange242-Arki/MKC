import { Router } from 'express';
import { authMiddleware } from '../../middlewares/auth.middleware';
import { DraftsController } from './drafts.controller';

export const draftsModule = (): Router => {
  const router = Router();

  // Auth required for downloads; ownership checked in controller
  router.get('/:id/download', authMiddleware, DraftsController.download);

  return router;
};
