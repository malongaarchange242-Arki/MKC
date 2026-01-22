import { Request, Response } from 'express';
import { z, ZodError } from 'zod';
import { DraftsService } from './drafts.service';
import { getAuthUserId, getAuthUserRole } from '../../utils/request-user';
import { logger } from '../../utils/logger';

type AuthRequest = Request & {};

const handleControllerError = (res: Response, error: unknown, context = '') => {
  logger.error(`${context} failed`, { error });
  if (error instanceof ZodError) return res.status(422).json({ message: 'Invalid payload', errors: error.flatten().fieldErrors });
  if (error instanceof Error) return res.status(400).json({ message: error.message });
  return res.status(500).json({ message: 'Unexpected error' });
};

export class DraftsController {
  // GET /drafts/:id/download -> returns a signed url (only client owner or admin)
  static async download(req: AuthRequest, res: Response) {
    try {
      const userId = getAuthUserId(req);
      const role = getAuthUserRole(req);
      if (!userId) return res.status(401).json({ message: 'Unauthorized' });

      const draftId = req.params.id;
      const draft = await DraftsService.getDraftById(draftId);

      // Verify ownership: client owner of request OR ADMIN/SYSTEM
      if (role !== 'ADMIN' && role !== 'SYSTEM') {
        // verify that the requester is the client of the related request
        const { data: reqRow, error } = await (await import('../../config/supabase')).supabase
          .from('requests')
          .select('user_id')
          .eq('id', draft.request_id)
          .single();
        if (error || !reqRow || reqRow.user_id !== userId) {
          return res.status(403).json({ message: 'Forbidden' });
        }
      }

      const url = await DraftsService.generateSignedUrl(draftId, 60 * 10);
      return res.status(200).json({ success: true, url });
    } catch (error: unknown) {
      return handleControllerError(res, error, 'Download draft');
    }
  }

  // GET /drafts/request/:id -> list drafts for a request with short-lived signed urls
  static async listByRequest(req: AuthRequest, res: Response) {
    try {
      const userId = getAuthUserId(req);
      const role = getAuthUserRole(req);
      if (!userId) return res.status(401).json({ message: 'Unauthorized' });

      const requestId = req.params.id;

      // Verify ownership unless admin/system
      if (role !== 'ADMIN' && role !== 'SYSTEM') {
        const { data: reqRow, error } = await (await import('../../config/supabase')).supabase
          .from('requests')
          .select('user_id')
          .eq('id', requestId)
          .single();
        if (error || !reqRow || reqRow.user_id !== userId) {
          return res.status(403).json({ message: 'Forbidden' });
        }
      }

      const drafts = await DraftsService.getDraftsByRequestId(requestId);

      const result = [] as any[];
      for (const d of drafts) {
        try {
          const url = await DraftsService.generateSignedUrl(d.id, 60 * 10);
          // Do NOT expose amount/currency from drafts; drafts are documentary only
          result.push({ id: d.id, file_name: d.file_name, url });
        } catch (e) {
          result.push({ id: d.id, file_name: d.file_name });
        }
      }

      return res.status(200).json({ success: true, drafts: result });
    } catch (error: unknown) {
      return handleControllerError(res, error, 'List drafts by request');
    }
  }
}
