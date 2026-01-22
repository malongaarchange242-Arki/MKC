import { Router } from 'express';
import { authMiddleware } from '../../middlewares/auth.middleware';
import { DraftsController } from './drafts.controller';

export const draftsModule = (): Router => {
  const router = Router();

  // Auth required for downloads; ownership checked in controller
  router.get('/:id/download', authMiddleware, DraftsController.download);
  // List drafts by request id (returns signed urls when possible)
  router.get('/request/:id', authMiddleware, DraftsController.listByRequest);

  return router;
};
