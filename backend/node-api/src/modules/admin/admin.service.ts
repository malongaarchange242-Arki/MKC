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
    logger.info('Admin: publish final documents', { requestId, adminId, opts });

    // 1. Load request
    const request = await RequestsService.getRequestById(requestId);

    if (!request) throw new Error('Request not found');

    // 2. Business rule: cannot publish if already completed
    if (request.status === 'COMPLETED') {
      throw new Error('Request already completed');
    }

    // 3. Find existing FINAL documents
    const existing = await DocumentsService.listDocuments({ requestId }, adminId, 'ADMIN');
    const finalDocs = existing.documents.filter((d: any) => d.category === 'FINAL');

    let createdDocs: any[] = [];

    if (finalDocs.length > 0) {
      createdDocs = finalDocs;
    } else {
      // If not present, try to promote matching client documents to FINAL by creating new entries
      const candidateDocs = existing.documents.filter((d: any) => !!d.file_path && (!d.category || d.category !== 'FINAL'));

      for (const c of candidateDocs) {
        // simple heuristic: if filename contains FERI or AD
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
        const url = await DocumentsService.generateSignedUrlFromDocument(d.id, 60 * 60);
        docsWithUrls.push({ id: d.id, type: (d as any).type || null, category: d.category || 'FINAL', format: d.format || 'PDF', downloadUrl: url });
      } catch (err) {
        logger.warn('Failed to generate signed url', { docId: d.id, err });
      }
    }

    // 7. Notify user
    try {
      const { NotificationsService } = await import('../notifications/notifications.service');

      await NotificationsService.send({
        userId: request.client_id,
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
          userId: request.client_id,
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
