import { supabaseAdmin as supabase } from '../../config/supabaseAdmin';
import { DocumentsService } from '../documents/documents.service';
import { logger } from '../../utils/logger';
import { v4 as uuidv4 } from 'uuid';

export class MessagesService {
  static async createMessage(params: {
    requestId: string;
    content: string;
    type?: string;
    file?: Express.Multer.File;
    senderId: string;
    senderRole: string;
  }) {
    const { requestId, content, type = 'MESSAGE', file, senderId, senderRole } = params;

    logger.info('Creating request message', { requestId, senderId, senderRole, hasFile: !!file });

    // If file included, persist via DocumentsService
    let documentId: string | null = null;
    let attachmentUrl: string | null = null;
    try {
      if (file) {
        const doc = await DocumentsService.createClientDocument({
          requestId,
          file,
          uploadedBy: senderId,
          type: 'MISC',
          visibility: senderRole === 'CLIENT' ? 'ADMIN' : 'CLIENT'
        });
        documentId = doc.id;
        try {
          attachmentUrl = await DocumentsService.generateSignedUrlFromDocument(documentId, 60 * 60);
        } catch (e) {
          logger.warn('Failed to create signed url for message attachment', { err: e });
          attachmentUrl = null;
        }
      }
    } catch (e) {
      logger.warn('Attachment save failed for message', { err: e });
      throw new Error('Failed to save attachment');
    }

    const messageId = uuidv4();

    const payload: any = {
      id: messageId,
      request_id: requestId,
      sender_role: senderRole,
      content: content,
      attachment_url: attachmentUrl || null,
      created_at: new Date().toISOString()
    };

    // Try canonical table name `messages_request` first, then fall back to legacy `request_messages` if missing
    let data: any = null;
    let error: any = null;

    try {
      const resp = await supabase.from('messages_request').insert(payload).select().single();
      data = resp.data;
      error = resp.error;
      if (error && (error as any).code === 'PGRST205') {
        const resp2 = await supabase.from('request_messages').insert(payload).select().single();
        data = resp2.data;
        error = resp2.error;
      }
    } catch (e) {
      logger.error('Unexpected error during message insert', { err: e, payload });
      throw new Error('Unexpected error while persisting message');
    }

    if (error || !data) {
      const meta = {
        errorMessage: (error as any)?.message || null,
        errorDetails: (error as any)?.details || null,
        errorHint: (error as any)?.hint || null,
        payload
      };
      logger.error('Failed to persist request message', meta);

      const friendly = (error as any)?.code === 'PGRST205'
        ? 'Database table messages_request/request_messages not found. Did you run migrations?'
        : `Failed to persist message: ${(error as any)?.message || 'unknown'}`;

      throw new Error(friendly);
    }

    // Non-blocking notification: try to notify client and admin emails
    (async () => {
      try {
        const { NotificationsService } = await import('../notifications/notifications.service');
        // fetch request to get owner
        const { data: reqRow } = await supabase.from('requests').select('id,user_id,extracted_bl,bl_number').eq('id', requestId).maybeSingle();
        const clientId = reqRow?.user_id;
        const blDesc = reqRow?.extracted_bl || reqRow?.bl_number || requestId;

        if (clientId) {
          await NotificationsService.send({
            userId: clientId,
            type: 'REQUEST_MESSAGE',
            title: `New message regarding request ${blDesc}`,
            message: String(content).slice(0, 240),
            entityType: 'request',
            entityId: requestId,
            channels: ['in_app', 'email']
          });
        }

        const adminEmail = process.env.ADMIN_EMAIL || null;
        if (adminEmail) {
          await NotificationsService.send({
            userId: clientId || senderId,
            type: 'REQUEST_MESSAGE_ADMIN',
            title: `New message regarding request ${blDesc}`,
            message: String(content).slice(0, 240),
            entityType: 'request',
            entityId: requestId,
            channels: ['email'],
            overrideEmail: adminEmail
          });
        }
      } catch (e) {
        logger.warn('Post-message notifications failed', { e });
      }
    })();

    return data;
  }

  static async getMessages(requestId: string) {
    try {
      const { data, error } = await supabase
        .from('messages_request')
        .select('*')
        .eq('request_id', requestId)
        .order('created_at', { ascending: true });

      if (!error) return data || [];
      if ((error as any).code === 'PGRST205') {
        const { data: d2, error: e2 } = await supabase
          .from('request_messages')
          .select('*')
          .eq('request_id', requestId)
          .order('created_at', { ascending: true });
        if (e2) throw e2;
        return d2 || [];
      }

      throw error;
    } catch (e) {
      logger.error('Failed to fetch messages', { e });
      throw new Error('Failed to fetch messages');
    }
  }
}
