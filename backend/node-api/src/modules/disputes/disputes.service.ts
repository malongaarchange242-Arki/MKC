import { supabaseAdmin as supabase } from '../../config/supabaseAdmin';
import { DocumentsService } from '../documents/documents.service';
import { logger } from '../../utils/logger';
import { v4 as uuidv4 } from 'uuid';

export class DisputesService {
  static async createDispute(params: {
    requestId: string;
    invoiceId?: string | null;
    reason: string;
    file?: Express.Multer.File | undefined;
    raisedByRole: 'ADMIN' | 'CLIENT';
    raisedByUserId: string;
  }) {
    const { requestId, invoiceId = null, reason, file, raisedByRole, raisedByUserId } = params;

    logger.info('Creating request dispute', { requestId, invoiceId, raisedByRole, hasFile: !!file });

    // Persist attachment if provided
    let attachmentUrl: string | null = null;
    try {
      if (file) {
        // Choose upload method based on who raises the dispute
        let doc: any = null;
        if (raisedByRole === 'CLIENT') {
          doc = await DocumentsService.createClientDocument({
            requestId,
            file,
            uploadedBy: raisedByUserId,
            type: 'MISC',
            visibility: 'ADMIN'
          });
        } else {
          doc = await DocumentsService.createAdminDocument({
            requestId,
            file,
            uploadedBy: raisedByUserId,
            type: 'DRAFT_FERI',
            visibility: 'CLIENT'
          });
        }

        if (doc && doc.id) {
          try {
            attachmentUrl = await DocumentsService.generateSignedUrlFromDocument(doc.id, 60 * 60);
          } catch (e) {
            logger.warn('Failed to generate signed url for dispute attachment', { err: e });
            // fallback: do not fail the whole request
            attachmentUrl = null;
          }
        }
      }
    } catch (e) {
      logger.warn('Attachment save failed for dispute', { err: e });
      throw new Error('Failed to save attachment');
    }

    const disputeId = uuidv4();
    const payload: any = {
      id: disputeId,
      request_id: requestId,
      invoice_id: invoiceId || null,
      raised_by: raisedByRole,
      reason: reason,
      attachment_url: attachmentUrl,
      status: 'OPEN',
      created_at: new Date().toISOString()
    };

    const { data, error } = await supabase.from('request_disputes').insert(payload).select().single();

    if (error || !data) {
      logger.error('Failed to persist dispute', { error });
      throw new Error('Failed to persist dispute');
    }

    // Non-blocking notifications
    (async () => {
      try {
        const { NotificationsService } = await import('../notifications/notifications.service');

        // fetch request to get client owner
        const { data: reqRow } = await supabase.from('requests').select('id,user_id,extracted_bl,bl_number').eq('id', requestId).maybeSingle();
        const clientId = reqRow?.user_id;
        const blDesc = reqRow?.extracted_bl || reqRow?.bl_number || requestId;

        // Notify client (in-app + email)
        if (clientId) {
          await NotificationsService.send({
            userId: clientId,
            type: 'REQUEST_DISPUTE',
            title: `BL contested – ${blDesc}`,
            message: reason.slice(0, 240),
            entityType: 'request',
            entityId: requestId,
            channels: ['in_app', 'email']
          });
        }

        // Notify admin emails if configured
        const adminEmail = process.env.ADMIN_EMAIL || null;
        if (adminEmail) {
          await NotificationsService.send({
            userId: clientId || raisedByUserId,
            type: 'REQUEST_DISPUTE_ADMIN',
            title: `BL contested – ${blDesc}`,
            message: reason.slice(0, 240),
            entityType: 'request',
            entityId: requestId,
            channels: ['email'],
            overrideEmail: adminEmail
          });
        }
      } catch (e) {
        logger.warn('Post-dispute notifications failed', { e });
      }
    })();

    return data;
  }

  static async listDisputes(requestId: string) {
    const { data, error } = await supabase
      .from('request_disputes')
      .select('*')
      .eq('request_id', requestId)
      .order('created_at', { ascending: true });

    if (error) {
      logger.error('Failed to fetch disputes', { error });
      throw new Error('Failed to fetch disputes');
    }

    return data || [];
  }

  static async getDisputesForUser(userId: string) {
    // 1. Get all request IDs for this user
    const { data: reqs, error: reqError } = await supabase
      .from('requests')
      .select('id')
      .eq('user_id', userId);

    if (reqError) {
      logger.error('Failed to fetch user requests for disputes', { error: reqError });
      throw new Error('Failed to fetch user requests');
    }

    if (!reqs || reqs.length === 0) {
      return [];
    }

    const requestIds = reqs.map(r => r.id);

    // 2. Fetch disputes for these requests
    const { data, error } = await supabase
      .from('request_disputes')
      .select('*')
      .in('request_id', requestIds)
      .order('created_at', { ascending: false });

    if (error) {
      logger.error('Failed to fetch user disputes', { error });
      throw new Error('Failed to fetch user disputes');
    }

    return data || [];
  }
}
