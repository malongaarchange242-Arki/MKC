// src/modules/admin/admin.service.ts

import { UsersService } from '../users/users.service';
import { RequestsService } from '../requests/requests.service';
import { DocumentsService } from '../documents/documents.service';
import { AuditService } from '../audit/audit.service';
import { logger } from '../../utils/logger';
import { supabase } from '../../config/supabase';
import axios from 'axios';

export class AdminService {
  // ===============================
  // USERS
  // ===============================
  static async listUsers(limit = 50, offset = 0) {
    logger.info('Admin: list users');
    return UsersService.listUsers(limit, offset);
  }

  static async getUserById(userId: string) {
    logger.info('Admin: get user', { userId });
    return UsersService.getUserById(userId);
  }

  static async updateUserRole(userId: string, role: 'CLIENT' | 'ADMIN' | 'SYSTEM') {
    logger.info('Admin: update user role', { userId, role });
    return UsersService.updateUserRole(userId, role);
  }

  // ===============================
  // REQUESTS (FERI / AD)
  // ===============================
  static async listRequests(filters: {
    status?: string;
    type?: string;
    userId?: string;
  }) {
    logger.info('Admin: list requests', filters);
    return RequestsService.listRequests(filters);
  }

  static async getRequestById(requestId: string, adminId?: string) {
    logger.info('Admin: get request detailed', { requestId });

    // Core request
    const request = await RequestsService.getRequestById(requestId);

    // Documents + extractions
    const docsResult = await DocumentsService.listDocuments({ requestId }, adminId || 'ADMIN', 'ADMIN');
    const documents = docsResult.documents || [];

    // Audit/history for this request
    const { data: auditData, error: auditError } = await supabase
      .from('audit_logs')
      .select('*')
      .eq('entity', 'request')
      .eq('entity_id', requestId)
      .order('created_at', { ascending: false })
      .limit(100);

    if (auditError) {
      logger.warn('Failed to fetch audit logs for request', { requestId, auditError });
    }

    return {
      request,
      documents,
      audit: auditData || []
    };
  }

  static async forceUpdateRequestStatus(
    requestId: string,
    status: string,
    adminId: string
  ) {
    logger.warn('Admin: force update request status', {
      requestId,
      status,
      adminId
    });

    const result = await RequestsService.forceUpdateStatus(
      requestId,
      status
    );

    await AuditService.log({
      actor_id: adminId,
      action: 'FORCE_UPDATE_REQUEST_STATUS',
      entity: 'request',
      entity_id: requestId,
      metadata: { status }
    });

    return result;
  }

  // ===============================
  // PUBLISH FINAL DOCUMENTS
  // ===============================
  static async publishFinalDocuments(requestId: string, adminId: string, opts: any = {}) {
    // Avoid logging binary data from opts.file; only log minimal metadata
    const logMeta: any = { requestId, adminId };
    if (opts && opts.feri_ref) logMeta.feri_ref = opts.feri_ref;
    if (opts && opts.file) {
      logMeta.file_name = opts.file.originalname || null;
      logMeta.file_size = opts.file.size || null;
      logMeta.mime_type = opts.file.mimetype || null;
    }
    logger.info('Admin: publish final documents', logMeta);

    // 1. Load request
    const request = await RequestsService.getRequestById(requestId);

    if (!request) throw new Error('Request not found');

    // 2. Business rule: cannot publish if already completed
    if (request.status === 'COMPLETED') {
      throw new Error('Request already completed');
    }

    // If an admin attached a final PDF, persist it to feri_documents and create a feri_deliveries record
    if (opts && opts.file) {
      try {
        const file: Express.Multer.File = opts.file;
        const { v4: uuidv4 } = await import('uuid');
        const orig = file.originalname || `${requestId}.pdf`;
        const ext = orig.includes('.') ? orig.split('.').pop() : 'pdf';
        const storagePath = `${requestId}/${uuidv4()}.${ext}`;

        // Upload to private bucket 'feri_documents' (buffer only sent to Supabase SDK)
        const { data: uploadData, error: uploadErr } = await supabase.storage
          .from('feri_documents')
          .upload(storagePath, file.buffer as Buffer, { contentType: file.mimetype || 'application/pdf', upsert: false });

        if (uploadErr) {
          logger.error('Failed to upload final FERI to storage', { requestId, err: uploadErr });
          throw new Error('Failed to upload final document');
        }

        // Insert into feri_deliveries table — store only metadata, never the buffer
        // Build a clean payload (whitelist) to avoid accepting client-provided fields
        const deliveryPayload = {
          request_id: requestId,
          pdf_url: storagePath,
          file_name: orig,
          file_size: file.size || null,
          mime_type: file.mimetype || 'application/pdf',
          admin_id: adminId,
          feri_ref: opts.feri_ref || null,
          status: 'COMPLETED',
          delivered_at: new Date().toISOString()
        } as any;

        const { data: inserted, error: insertErr } = await supabase
          .from('feri_deliveries')
          .insert(deliveryPayload)
          .select()
          .single();

        if (insertErr || !inserted) {
          // rollback storage
          await supabase.storage.from('feri_documents').remove([storagePath]).catch(() => null);
          logger.error('Failed to insert feri_deliveries record', { requestId, err: insertErr });
          throw new Error('Failed to record final delivery');
        }

        // Audit the delivery (log only metadata)
        await AuditService.log({ actor_id: adminId, action: 'PUBLISH_FINAL_DOCUMENT_DELIVERY', entity: 'request', entity_id: requestId, metadata: { deliveryId: inserted.id, file_name: inserted.file_name, file_path: inserted.pdf_url } });
      } catch (e) {
        logger.error('Publish final documents (file handling) failed', { requestId, err: (e as any)?.message ?? String(e) });
        throw e;
      }
    }

    // 3. Prefer feri_deliveries entries as the authoritative final documents
    const { data: deliveries, error: deliveriesErr } = await supabase
      .from('feri_deliveries')
      .select('*')
      .eq('request_id', requestId)
      .order('delivered_at', { ascending: true });

    let createdDocs: any[] = [];
    if (deliveriesErr) {
      logger.warn('Failed to read feri_deliveries', { requestId, err: deliveriesErr });
    }

    if (Array.isArray(deliveries) && deliveries.length > 0) {
      createdDocs = deliveries.map((d: any) => ({
        id: d.id,
        pdf_url: d.pdf_url,
        file_name: d.file_name,
        mime_type: d.mime_type,
        category: 'FINAL'
      }));
    } else {
      // Fallback to existing DocumentsService flow (promote or use FINAL documents)
      const existing = await DocumentsService.listDocuments({ requestId }, adminId, 'ADMIN');
      const finalDocs = existing.documents.filter((d: any) => d.category === 'FINAL');
      if (finalDocs.length > 0) {
        createdDocs = finalDocs;
      } else {
        // Try promoting candidate docs
        const candidateDocs = existing.documents.filter((d: any) => !!d.file_path && (!d.category || d.category !== 'FINAL'));
        for (const c of candidateDocs) {
          const name = (c.file_name || '').toLowerCase();
          let type: 'FERI' | 'AD' | null = null;
          if (name.includes('feri')) type = 'FERI';
          if (name.includes('ad')) type = 'AD';
          try {
            const created = await DocumentsService.createFinalDocumentFromExisting(c, adminId, type);
            createdDocs.push(created);
          } catch (err) {
            logger.warn('Failed to create final document from candidate', { candidateId: c.id, err });
          }
        }
      }
    }

    if (createdDocs.length === 0) {
      throw new Error('No documents available to publish');
    }

    // 4. Update request status to COMPLETED
    await RequestsService.forceUpdateStatus(requestId, 'COMPLETED');

    // 5. Audit
    await AuditService.log({
      actor_id: adminId,
      action: 'PUBLISH_FINAL_DOCUMENTS',
      entity: 'request',
      entity_id: requestId,
      metadata: { documents: createdDocs.map(d => d.id) }
    });

    // 6. Prepare signed URLs
    const docsWithUrls = [] as any[];
    for (const d of createdDocs) {
      try {
        if (d.pdf_url) {
          // feri_deliveries entry — create signed url from storage path
          const bucket = 'feri_documents';
          const path = d.pdf_url;
          try {
            const { data: signed, error: signedErr } = await supabase.storage.from(bucket).createSignedUrl(path, 60 * 60);
            if (signedErr || !signed || !signed.signedUrl) {
              logger.warn('Failed to create signed url for feri_delivery', { requestId, path, err: signedErr });
            } else {
              docsWithUrls.push({ id: d.id, type: 'FERI', category: d.category || 'FINAL', format: 'PDF', downloadUrl: signed.signedUrl, file_name: d.file_name });
            }
          } catch (e) {
            logger.warn('Failed to create signed url for feri_delivery', { requestId, path, err: (e as any)?.message ?? String(e) });
          }
        } else if (d.id) {
          const url = await DocumentsService.generateSignedUrlFromDocument(d.id, 60 * 60);
          docsWithUrls.push({ id: d.id, type: (d as any).type || null, category: d.category || 'FINAL', format: d.format || 'PDF', downloadUrl: url });
        }
      } catch (err) {
        logger.warn('Failed to generate signed url', { doc: d, err });
      }
    }

    // 7. Notify user
    try {
      const { NotificationsService } = await import('../notifications/notifications.service');

      await NotificationsService.send({
        userId: request.user_id,
        type: 'REQUEST_COMPLETED',
        title: 'Vos documents officiels sont disponibles',
        message: 'Votre FERI / AD a été validée. Vous pouvez télécharger vos documents sur la plateforme. Ils sont également joints à cet email.',
        entityType: 'REQUEST',
        entityId: requestId,
        channels: ['in_app', 'email'],
        links: docsWithUrls.map(d => ({ name: d.type || d.id, url: d.downloadUrl, expires_in: 3600 })),
        attachments: []
      });
    } catch (err) {
      logger.warn('Notification send failed', { err });
    }

    return { requestId, documents: docsWithUrls };
  }

  // ===============================
  // GENERATE FINAL DOCUMENT (via Python)
  // ===============================
  static async generateFinalDocument(requestId: string, adminId: string, kind: 'FERI' | 'AD') {
    logger.info('Admin: generate final document', { requestId, adminId, kind });

    // Load request and enforce payment confirmed
    const request = await RequestsService.getRequestById(requestId);
    if (!request) throw new Error('Request not found');
    if (request.status !== 'PAYMENT_CONFIRMED') throw new Error('Cannot generate final documents before payment is confirmed');

    // Collect data for Python service: signed URLs for documents and extraction
    const { documents } = await DocumentsService.listDocuments({ requestId }, adminId, 'ADMIN');
    const signedDocs: Array<{ id: string; url: string; mime: string }> = [];
    for (const d of documents) {
      try {
        const url = await DocumentsService.generateSignedUrlFromDocument(d.id, 60 * 60);
        signedDocs.push({ id: d.id, url, mime: d.mime_type });
      } catch (e) {
        logger.warn('Failed to create signed url for document', { docId: d.id, e });
      }
    }

    const pythonUrlBase = process.env.PYTHON_SERVICE_URL || 'http://127.0.0.1:8000';
    const endpoint = kind === 'FERI' ? `${pythonUrlBase}/api/v1/generate/feri` : `${pythonUrlBase}/api/v1/generate/ad`;
    const apiKey = process.env.PYTHON_SERVICE_API_KEY || '';

    try {
      const resp = await axios.post(endpoint, {
        request_id: requestId,
        request,
        documents: signedDocs
      }, {
        headers: apiKey ? { 'x-api-key': apiKey } : undefined,
        responseType: 'arraybuffer'
      });

      let buffer: Buffer | null = null;
      let filename = `${requestId}_${kind}.pdf`;
      let mime = 'application/pdf';

      // If response is binary PDF
      if (resp && resp.data) {
        buffer = Buffer.from(resp.data);
        // try to parse filename from headers
        const disp = resp.headers['content-disposition'];
        if (disp && typeof disp === 'string') {
          const m = disp.match(/filename="?([^";]+)"?/);
          if (m) filename = m[1];
        }
        if (resp.headers['content-type']) mime = resp.headers['content-type'];
      }

      if (!buffer) throw new Error('Empty response from generation service');

      // Persist final document
      const doc = await DocumentsService.createFinalDocumentFromBuffer({
        requestId,
        buffer,
        filename,
        mimeType: mime,
        adminId,
        type: kind === 'FERI' ? 'FERI_FINAL' : 'AD_FINAL'
      });

      // Update request to COMPLETED
      await RequestsService.forceUpdateStatus(requestId, 'COMPLETED');

      // Audit
      await AuditService.log({
        actor_id: adminId,
        action: 'GENERATE_FINAL_DOCUMENT',
        entity: 'request',
        entity_id: requestId,
        metadata: { documentId: doc.id, kind }
      });

      // Notify client with signed URL
      try {
        const url = await DocumentsService.generateSignedUrlFromDocument(doc.id, 60 * 60);
        const { NotificationsService } = await import('../notifications/notifications.service');
        await NotificationsService.send({
          userId: request.user_id,
          type: 'REQUEST_COMPLETED',
          title: 'Documents officiels disponibles',
          message: 'Vos documents officiels sont disponibles. Merci de les télécharger depuis votre espace client.',
          entityType: 'request',
          entityId: requestId,
          channels: ['in_app', 'email'],
          links: [{ name: filename, url, expires_in: 3600 }]
        });
      } catch (e) {
        logger.warn('Failed to send final document notification', { e });
      }

      return doc;
    } catch (err: any) {
      logger.error('Generation failed', { err: err?.message || err });
      throw new Error('Generation service failed: ' + (err?.message || 'unknown'));
    }
  }

  // ===============================
  // DOCUMENTS
  // ===============================
  static async listDocuments(adminId: string, filters: { requestId?: string; userId?: string; limit?: number; offset?: number } = {}) {
    logger.info('Admin: list documents', { adminId, filters });
    return DocumentsService.listDocuments(filters, adminId, 'ADMIN');
  }

  static async getDocumentById(documentId: string, adminId: string) {
    logger.info('Admin: get document', { documentId, adminId });
    return DocumentsService.getDocumentById(documentId, adminId, 'ADMIN');
  }

  static async deleteDocument(documentId: string, adminId: string) {
    logger.warn('Admin: delete document', { documentId, adminId });

    await DocumentsService.deleteDocument(documentId, adminId, 'ADMIN');

    await AuditService.log({
      actor_id: adminId,
      action: 'DELETE_DOCUMENT',
      entity: 'document',
      entity_id: documentId
    });

    return { success: true };
  }
}
