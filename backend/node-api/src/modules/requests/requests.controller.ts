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
  type: z.enum(['FERI_ONLY', 'AD_ONLY', 'FERI_AND_AD']),
  ref: z.string().optional(),
  fxi_number: z.string().optional(),
  feri_number: z.string().optional(),
  manual_bl: z.string().optional()
});

const updateRequestSchema = z.object({
  manual_bl: z.string().optional()
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
        type: body.type,
        ref: body.ref,
        fxi_number: body.fxi_number,
        feri_number: body.feri_number,
        manual_bl: body.manual_bl
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
  // UPDATE REQUEST (CLIENT - partial)
  // Allows updating client-editable fields like `manual_bl`.
  // ===============================
  static async update(req: AuthRequest, res: Response) {
    try {
      const userId = getAuthUserId(req);
      if (!userId) return res.status(401).json({ message: 'Unauthorized' });

      const { requestId } = req.params;
      if (!requestId) return res.status(400).json({ message: 'requestId is required' });

      const body = updateRequestSchema.parse(req.body);

      const updated = await RequestsService.updateRequest(requestId, userId, { manual_bl: body.manual_bl ?? null });

      return res.status(200).json({ success: true, request: updated });
    } catch (error) {
      return handleControllerError(res, error, 'Update request');
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

  // ===============================
  // CREATE MESSAGE / DISPUTE (CLIENT / ADMIN)
  // ===============================
  static async createMessage(req: AuthRequest, res: Response) {
    try {
      const userId = getAuthUserId(req);
      const userRole = getAuthUserRole(req);
      if (!userId) return res.status(401).json({ message: 'Unauthorized' });

      const { requestId } = req.params;
      if (!requestId) return res.status(400).json({ message: 'requestId is required' });

      const file = req.file as Express.Multer.File | undefined;
      const { content, type } = req.body as { content?: string; type?: string };

      if (!content || String(content).trim().length === 0) {
        return res.status(422).json({ message: 'content is required' });
      }

      const { MessagesService } = await import('../messages/messages.service');
      const message = await MessagesService.createMessage({
        requestId,
        content: String(content),
        type: String(type || 'MESSAGE'),
        file,
        senderId: userId,
        senderRole: userRole as any
      });

      return res.status(201).json({ success: true, message });
    } catch (error) {
      return handleControllerError(res, error, 'Create message');
    }
  }

  static async getMessages(req: AuthRequest, res: Response) {
    try {
      const userId = getAuthUserId(req);
      if (!userId) return res.status(401).json({ message: 'Unauthorized' });

      const { requestId } = req.params;
      if (!requestId) return res.status(400).json({ message: 'requestId is required' });

      const { MessagesService } = await import('../messages/messages.service');
      const rows = await MessagesService.getMessages(requestId);
      return res.status(200).json({ messages: rows });
    } catch (error) {
      return handleControllerError(res, error, 'Get messages');
    }
  }

  static async getDocuments(req: AuthRequest, res: Response) {
    try {
      const userId = getAuthUserId(req);
      if (!userId) return res.status(401).json({ message: 'Unauthorized' });

      const { requestId } = req.params;
      if (!requestId) return res.status(400).json({ message: 'requestId is required' });

      const result = await DocumentsService.listDocuments({ requestId }, userId, getAuthUserRole(req) as any);
      return res.status(200).json({ documents: result.documents || [] });
    } catch (error) {
      return handleControllerError(res, error, 'Get documents');
    }
  }

  static async createDispute(req: AuthRequest, res: Response) {
    try {
      const userId = getAuthUserId(req);
      const userRole = getAuthUserRole(req) as 'ADMIN' | 'CLIENT';
      if (!userId) return res.status(401).json({ message: 'Unauthorized' });

      const { requestId } = req.params;
      if (!requestId) return res.status(400).json({ message: 'requestId is required' });

      const file = req.file as Express.Multer.File | undefined;
      const { reason, invoice_id } = req.body as { reason?: string; invoice_id?: string };

      if (!reason || String(reason).trim().length === 0) {
        return res.status(422).json({ message: 'reason is required' });
      }

      if (!(userRole === 'ADMIN' || userRole === 'CLIENT')) {
        return res.status(422).json({ message: 'raised_by must be ADMIN or CLIENT' });
      }

      const { DisputesService } = await import('../disputes/disputes.service');
      const dispute = await DisputesService.createDispute({
        requestId,
        invoiceId: invoice_id ? String(invoice_id) : null,
        reason: String(reason),
        file,
        raisedByRole: userRole,
        raisedByUserId: userId
      });

      return res.status(201).json({ success: true, dispute });
    } catch (error) {
      return handleControllerError(res, error, 'Create dispute');
    }
  }

  static async getDisputes(req: AuthRequest, res: Response) {
    try {
      const userId = getAuthUserId(req);
      if (!userId) return res.status(401).json({ message: 'Unauthorized' });

      const { requestId } = req.params;
      if (!requestId) return res.status(400).json({ message: 'requestId is required' });

      const { DisputesService } = await import('../disputes/disputes.service');
      const rows = await DisputesService.listDisputes(requestId);
      return res.status(200).json({ disputes: rows });
    } catch (error) {
      return handleControllerError(res, error, 'Get disputes');
    }
  }

  static async getMyDisputes(req: AuthRequest, res: Response) {
    try {
      const userId = getAuthUserId(req);
      logger.info('getMyDisputes called', { userId });
      if (!userId) return res.status(401).json({ message: 'Unauthorized' });

      const { DisputesService } = await import('../disputes/disputes.service');
      const rows = await DisputesService.getDisputesForUser(userId);
      logger.info('getMyDisputes result', { count: rows.length });
      return res.status(200).json({ disputes: rows });
    } catch (error) {
      return handleControllerError(res, error, 'Get my disputes');
    }
  }
}
