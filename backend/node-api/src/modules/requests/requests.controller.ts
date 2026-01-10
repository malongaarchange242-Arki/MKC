import { Request, Response } from 'express';
import { z, ZodError } from 'zod';
import { RequestsService } from './requests.service';
import { getAuthUserId, getAuthUserRole } from '../../utils/request-user';
import { ActorRole, REQUEST_STATUSES, RequestStatus } from './request.state-machine';
import { logger } from '../../utils/logger';
import { DocumentsService } from '../documents/documents.service';

// ===============================
// TYPES
// ===============================
type AuthRequest = Request & {
  user?: {
    id: string;
    role: ActorRole;
  };
};

// ===============================
// SCHEMAS
// ===============================
const createRequestSchema = z.object({
  type: z.enum(['FERI_ONLY', 'AD_ONLY', 'FERI_AND_AD'])
});

const statusEnum = [...REQUEST_STATUSES] as [RequestStatus, ...RequestStatus[]];
const transitionSchema = z.object({
  requestId: z.string().uuid(),
  to: z.enum(statusEnum)
});

// ===============================
// ERROR HANDLER
// ===============================
const handleControllerError = (res: Response, error: unknown, context = '') => {
  logger.error(`${context} failed`, { error });

  if (error instanceof ZodError) {
    return res.status(422).json({
      message: 'Invalid payload',
      errors: error.flatten().fieldErrors
    });
  }

  if (error instanceof Error) {
    return res.status(400).json({ message: error.message });
  }

  return res.status(500).json({ message: 'Unexpected error' });
};

// ===============================
// CONTROLLER
// ===============================
export class RequestsController {
  // ===============================
  // CREATE REQUEST (CLIENT)
  // ===============================
  static async create(req: AuthRequest, res: Response) {
    try {
      const userId = getAuthUserId(req);
      if (!userId) return res.status(401).json({ message: 'Unauthorized' });

      const body = createRequestSchema.parse(req.body);

      const request = await RequestsService.createRequest({
        userId: userId,
        type: body.type
      });

      return res.status(201).json(request);
    } catch (error) {
      return handleControllerError(res, error, 'Create request');
    }
  }

  // ===============================
  // LIST REQUESTS (CLIENT ONLY)
  // ===============================
  static async list(req: AuthRequest, res: Response) {
    try {
      const userId = getAuthUserId(req);
      const role = getAuthUserRole(req);

      if (!userId) return res.status(401).json({ message: 'Unauthorized' });
      if (role !== 'CLIENT') {
        logger.warn('Forbidden access to client list', { userId, role });
        return res.status(403).json({ message: 'Forbidden' });
      }

      const rows = await RequestsService.listRequests({ userId });
      return res.status(200).json(rows ?? []);
    } catch (error) {
      return handleControllerError(res, error, 'List requests');
    }
  }

  // ===============================
  // TRANSITION STATUS (ADMIN / SYSTEM / CLIENT via rules)
  // ===============================
  static async transition(req: AuthRequest, res: Response) {
    try {
      const userId = getAuthUserId(req);
      const userRole = getAuthUserRole(req) as ActorRole;

      if (!userId) return res.status(401).json({ message: 'Unauthorized' });

      const body = transitionSchema.parse(req.body);

      const result = await RequestsService.transitionStatus({
        requestId: body.requestId,
        to: body.to,
        actorRole: userRole,
        actorId: userId
      });

      return res.status(200).json(result);
    } catch (error) {
      return handleControllerError(res, error, 'Transition');
    }
  }

  // ===============================
  // CLIENT SUBMIT REQUEST
  // ===============================
  static async submit(req: AuthRequest, res: Response) {
    try {
      const userId = getAuthUserId(req);
      if (!userId) return res.status(401).json({ message: 'Unauthorized' });

      const { requestId } = req.params;
      if (!requestId) {
        return res.status(400).json({ message: 'requestId is required' });
      }

      await RequestsService.canClientSubmit(requestId, userId);

      const result = await RequestsService.transitionStatus({
        requestId,
        to: 'SUBMITTED',
        actorRole: 'CLIENT',
        actorId: userId
      });

      return res.status(200).json(result);
    } catch (error) {
      return handleControllerError(res, error, 'Submit request');
    }
  }

  // ===============================
  // CLIENT UPLOAD PAYMENT PROOF
  // ===============================
  static async submitPaymentProof(req: AuthRequest, res: Response) {
    try {
      const userId = getAuthUserId(req);
      if (!userId) return res.status(401).json({ message: 'Unauthorized' });

      const { requestId } = req.params;
      const file = req.file as Express.Multer.File | undefined;
      if (!file) return res.status(400).json({ message: 'No file provided' });

      const request = await RequestsService.getRequestById(requestId);
      if (!request) return res.status(404).json({ message: 'Request not found' });

      if (request.status !== 'DRAFT_SENT') {
        return res.status(400).json({
          message: 'Payment proof can only be uploaded after draft is sent'
        });
      }

      const document = await DocumentsService.createClientDocument({
        requestId,
        file,
        uploadedBy: userId,
        type: 'PAYMENT_PROOF',
        visibility: 'ADMIN'
      });

      await RequestsService.transitionStatus({
        requestId,
        to: 'PAYMENT_PROOF_UPLOADED',
        actorRole: 'CLIENT',
        actorId: userId
      });

      // 🔔 Notify client
      try {
        const { NotificationsService } = await import('../notifications/notifications.service');
        await NotificationsService.send({
          userId: request.user_id,
          type: 'PAYMENT_PROOF_UPLOADED',
          title: 'Preuve de paiement reçue',
          message:
            'Votre preuve de paiement a été reçue et est en attente de validation par un administrateur.',
          entityType: 'request',
          entityId: requestId,
          channels: ['in_app', 'email']
        });
      } catch (e) {
        logger.warn('Client notification failed', { e });
      }

      return res.status(200).json({
        success: true,
        document
      });
    } catch (error) {
      return handleControllerError(res, error, 'Submit payment proof');
    }
  }
}
