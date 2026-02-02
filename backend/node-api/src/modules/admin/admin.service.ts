// src/modules/admin/admin.service.ts

import { UsersService } from '../users/users.service';
import { RequestsService } from '../requests/requests.service';
import { DocumentsService } from '../documents/documents.service';
import { DraftsService } from '../drafts/drafts.service';
import { AuditService } from '../audit/audit.service';
import { logger } from '../../utils/logger';
import { supabase } from '../../config/supabase';
import supabaseAdmin from '../../config/supabaseAdmin';
import axios from 'axios';
import PaymentsService from '../payments/payments.service';

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
      status,
      { notifyClient: false }
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
  // GENERATE BL REFERENCE (REUSABLE)
  // ===============================
  /**
   * Generates a BL reference in format MKC{year}{seq}
   * e.g., MKC20260001 for year 2026, sequence 1
   * Used for automatic BL generation when OCR fails or when manually regenerated
   */
  static async generateBlReference(): Promise<string> {
    const year = new Date().getFullYear();
    const likePattern = `MKC${year}%`;

    const { data: rows, error: countErr } = await supabaseAdmin
      .from('requests')
      .select('manual_bl')
      .ilike('manual_bl', likePattern);

    if (countErr) {
      logger.warn('Failed to query existing manual_bl rows for sequencing', { err: countErr });
    }

    let seq = 1;
    try {
      if (Array.isArray(rows) && rows.length > 0) {
        const max = rows
          .map((r: any) => {
            const m = String(r.manual_bl || '').match(/^MKC(\d{4})(\d{4,})$/);
            return m ? parseInt(m[2], 10) : 0;
          })
          .reduce((a: number, b: number) => Math.max(a, b), 0);
        seq = max + 1;
      }
    } catch (e) {
      logger.warn('Error computing manual_bl sequence', { err: e });
      seq = 1;
    }

    const ref = `MKC${year}${String(seq).padStart(4, '0')}`;
    return ref;
  }

  // ===============================
  // REGENERATE MANUAL BL
  // ===============================
  static async regenerateManualBl(requestId: string, adminId: string) {
    logger.info('Admin: regenerate manual BL', { requestId, adminId });

    // Fetch current request row using admin client (bypass RLS)
    const { data: reqRow, error: reqErr } = await supabaseAdmin
      .from('requests')
      .select('id, manual_bl')
      .eq('id', requestId)
      .single();

    if (reqErr || !reqRow) {
      logger.warn('Request not found when regenerating manual_bl', { requestId, err: reqErr });
      throw new Error('Request not found');
    }

    if (reqRow.manual_bl && String(reqRow.manual_bl).trim() !== '') {
      // Nothing to do
      return { success: true, manual_bl: reqRow.manual_bl, message: 'manual_bl already present' };
    }

    // Generate MKC{year}{seq} using the reusable function
    const ref = await AdminService.generateBlReference();

    const { data: updated, error: updErr } = await supabaseAdmin
      .from('requests')
      .update({ manual_bl: ref, bl_number: ref })
      .eq('id', requestId)
      .select()
      .single();

    if (updErr || !updated) {
      logger.error('Failed to update request with regenerated manual_bl', { requestId, updErr });
      throw new Error('Failed to update request with manual_bl');
    }

    // Audit
    try {
      await AuditService.log({ actor_id: adminId, action: 'REGENERATE_MANUAL_BL', entity: 'request', entity_id: requestId, metadata: { manual_bl: ref } });
    } catch (e) {
      logger.warn('Failed to write audit for regenerate manual_bl', { err: e });
    }

    return { success: true, manual_bl: ref, request: updated };
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

    // If an AD file was also attached (FERI_AND_AD flows), persist it as an additional feri_deliveries record
    if (opts && opts.ad_file) {
      try {
        const adFile: Express.Multer.File = opts.ad_file;
        const { v4: uuidv4 } = await import('uuid');
        const origA = adFile.originalname || `${requestId}-ad.pdf`;
        const extA = origA.includes('.') ? origA.split('.').pop() : 'pdf';
        const storagePathA = `${requestId}/ad_${uuidv4()}.${extA}`;

        const { data: uploadDataA, error: uploadErrA } = await supabase.storage
          .from('feri_documents')
          .upload(storagePathA, adFile.buffer as Buffer, { contentType: adFile.mimetype || 'application/pdf', upsert: false });

        if (uploadErrA) {
          logger.error('Failed to upload AD final to storage', { requestId, err: uploadErrA });
          throw new Error('Failed to upload AD document');
        }

        const deliveryPayloadA = {
          request_id: requestId,
          pdf_url: storagePathA,
          file_name: origA,
          file_size: adFile.size || null,
          mime_type: adFile.mimetype || 'application/pdf',
          admin_id: adminId,
          feri_ref: null,
          status: 'COMPLETED',
          delivered_at: new Date().toISOString()
        } as any;

        const { data: insertedA, error: insertErrA } = await supabase
          .from('feri_deliveries')
          .insert(deliveryPayloadA)
          .select()
          .single();

        if (insertErrA || !insertedA) {
          await supabase.storage.from('feri_documents').remove([storagePathA]).catch(() => null);
          logger.error('Failed to insert feri_deliveries record for AD', { requestId, err: insertErrA });
          throw new Error('Failed to record AD final delivery');
        }

        await AuditService.log({ actor_id: adminId, action: 'PUBLISH_FINAL_DOCUMENT_DELIVERY', entity: 'request', entity_id: requestId, metadata: { deliveryId: insertedA.id, file_name: insertedA.file_name, file_path: insertedA.pdf_url, ad: true } });
      } catch (e) {
        logger.error('Publish final documents (AD file handling) failed', { requestId, err: (e as any)?.message ?? String(e) });
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
    await RequestsService.forceUpdateStatus(requestId, 'COMPLETED', { notifyClient: false });

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
    const requestTypeKey = (request && (request as any).type) ? String((request as any).type).toUpperCase() : null;
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
              // Prefer request-level type when explicit (AD_ONLY or FERI_ONLY).
              // For mixed flows (FERI_AND_AD) or unknown, fall back to filename/path heuristics.
              let derivedType: string | null = null;
              if (requestTypeKey === 'AD_ONLY') {
                derivedType = 'AD';
              } else if (requestTypeKey === 'FERI_ONLY') {
                derivedType = 'FERI';
              } else {
                // Derive type from filename or path to distinguish FERI vs AD
                const fname = (d.file_name || '').toString().toLowerCase();
                const p = (path || '').toString().toLowerCase();
                derivedType = 'FERI';
                if (fname.includes('ad') || fname.includes(' a d') || fname.includes('ad_') || p.includes('/ad_') || p.includes('-ad')) {
                  derivedType = 'AD';
                }
              }
              docsWithUrls.push({ id: d.id, type: derivedType, category: d.category || 'FINAL', format: 'PDF', downloadUrl: signed.signedUrl, file_name: d.file_name });
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

    // 7. Prepare attachments (download binaries) and notify user
    const attachments: Array<{ name: string; mime: string; base64: string }> = [];
    for (const d of createdDocs) {
      try {
        if (d.pdf_url) {
          // feri_deliveries entry: download from feri_documents bucket
          const bucket = 'feri_documents';
          const path = d.pdf_url;
          const { data: fileData, error: downloadErr } = await supabase.storage.from(bucket).download(path);
          if (downloadErr || !fileData) {
            logger.warn('Failed to download feri_delivery file for attachment', { requestId, path, downloadErr });
          } else {
            const arrayBuffer = await fileData.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);
            attachments.push({ name: d.file_name || path.split('/').pop() || 'document.pdf', mime: d.mime_type || 'application/pdf', base64: buffer.toString('base64') });
          }
        } else if (d.id) {
          // document stored in documents table — reuse DocumentsService download helper
          try {
            const { file, document } = await DocumentsService.downloadDocument(d.id, adminId, 'ADMIN');
            attachments.push({ name: document.file_name || `${d.id}.pdf`, mime: document.mime_type || 'application/pdf', base64: file.toString('base64') });
          } catch (e) {
            logger.warn('Failed to download document entry for attachment', { requestId, docId: d.id, err: (e as any)?.message ?? e });
          }
        }
      } catch (e) {
        logger.warn('Unexpected error while preparing attachment', { requestId, doc: d, err: (e as any)?.message ?? e });
      }
    }

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
        links: docsWithUrls.map(d => ({ name: d.type || d.file_name || d.id, url: d.downloadUrl, expires_in: 3600 })),
        attachments: attachments
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

    const pythonUrlBase = process.env.PYTHON_SERVICE_URL || 'https://mkc-5slv.onrender.com/api/v1';
    const endpoint = kind === 'FERI'
      ? (pythonUrlBase.includes('/api/') ? `${pythonUrlBase.replace(/\/$/, '')}/generate/feri` : `${pythonUrlBase.replace(/\/$/, '')}/api/v1/generate/feri`)
      : (pythonUrlBase.includes('/api/') ? `${pythonUrlBase.replace(/\/$/, '')}/generate/ad` : `${pythonUrlBase.replace(/\/$/, '')}/api/v1/generate/ad`);
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
      await RequestsService.forceUpdateStatus(requestId, 'COMPLETED', { notifyClient: false });

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

  // ===============================
  // INVOICES
  // ===============================
  static async sendDraft(requestId: string, adminId: string, opts: { amount?: number | null; currency?: string; file?: Express.Multer.File; cargo_route?: string; frontend_base?: string } = {}) {
    try {
      logger.info('Admin: send draft', { requestId, adminId, hasFile: !!opts.file });

      // 1. Validate inputs and permissions
      const request = await RequestsService.getRequestById(requestId);
      if (!request) throw new Error('Request not found');

      if (opts.amount === undefined || opts.amount === null || isNaN(Number(opts.amount))) {
        throw new Error('amount is required');
      }
      if (!opts.currency) throw new Error('currency is required');
      if (!opts.cargo_route || String(opts.cargo_route).trim() === '') throw new Error('cargo_route is required');
      if (!opts.file) throw new Error('file is required');

      const paymentsService = new PaymentsService();

      // 2. Create or update authoritative invoice (single source of truth)
      const { data: invoiceData, error: invoiceErr } = await paymentsService.createInvoice({
        request_id: requestId,
        amount: Number(opts.amount),
        currency: opts.currency,
        customer_reference: request.customer_reference || null,
        cargo_route: String(opts.cargo_route),
        created_by: adminId
      });
      if (invoiceErr || !invoiceData) {
        logger.error('Failed to create or update invoice', { requestId, adminId, err: invoiceErr });
        // Surface underlying error message when possible to help debugging client-side
        const msg = (invoiceErr && (invoiceErr.message || invoiceErr.toString())) || 'Failed to create or update invoice';
        throw new Error(msg);
      }
      const invoice = invoiceData;

      // 3. Attach the PDF as a request draft (persist in request_drafts)
      // Link the draft to the authoritative invoice (invoice_id) so
      // business data remains in `invoices` table only.
      const createdDraft = await DraftsService.createDraft({
        requestId,
        file: opts.file as Express.Multer.File,
        uploadedBy: adminId,
        type: 'PROFORMA',
        visibility: 'CLIENT',
        invoiceId: invoice.id
      });

      // 4. Transition request status to PROFORMAT_SENT (idempotent)
      try {
        await RequestsService.transitionStatus({ requestId, to: 'PROFORMAT_SENT', actorRole: 'ADMIN', actorId: adminId });
      } catch (e) {
        logger.warn('RequestsService.transitionStatus failed during sendDraft', { requestId, err: e });
      }

      // 5. Audit
      await AuditService.log({ actor_id: adminId, action: 'SEND_DRAFT', entity: 'request', entity_id: requestId, metadata: { invoice_number: invoice.invoice_number, draft_id: createdDraft.id, cargo_route: opts.cargo_route } });

      // 6. Send notification to client
      // IMPORTANT: do NOT send notifications for manual invoices
      try {
        if (invoice && invoice.source === 'MANUAL') {
          logger.info('Skipping notifications for MANUAL invoice', { invoiceId: invoice.id });
          const { data: fullInvoice } = await paymentsService.getInvoiceById(invoice.id);
          return fullInvoice || invoice;
        }

        const { NotificationsService } = await import('../notifications/notifications.service');
        const signed = await DraftsService.generateSignedUrl(createdDraft.id, 60 * 60 * 24 * 3);
        // Build a user-facing invoice preview URL on the frontend. Fall back to frontend base env var.
        // Allow controller to pass `frontend_base` (origin/referer) for local dev convenience.
        const providedFrontend = (opts as any)?.frontend_base || process.env.FRONTEND_URL || process.env.ADMIN_DASHBOARD_URL || '';
        const frontendBase = (providedFrontend || process.env.FRONTEND_URL || 'https://feri-mkc.com').replace(/\/$/, '');
        // Facture_.html is at the root of the frontend, no need to add /frontend prefix
        const previewPath = `/Facture_.html?invoice_id=${encodeURIComponent(invoice.id)}`;
        // Generate a magic link token so recipients can open the preview without manual login
        try {
          const { JWTUtils } = await import('../../utils/jwt');
          const apiBase = (process.env.API_BASE_URL || 'https://mkc-backend-kqov.onrender.com').replace(/\/$/, '');
          const magic = JWTUtils.generateMagicToken({ sub: request.user_id, email: request.customer_email || '', redirect: previewPath });
          const invoicePreviewUrl = `${apiBase}/auth/magic/redirect?token=${encodeURIComponent(magic)}`;

          // replace the invoicePreviewUrl variable in the links below
          await NotificationsService.send({
            userId: request.user_id,
            type: 'DRAFT_AVAILABLE',
            title: 'Draft & Proforma disponibles',
            message: `A draft invoice is available. Invoice number: ${invoice.invoice_number}`,
            entityType: 'request',
            entityId: requestId,
            channels: ['in_app', 'email'],
            links: [
              { name: 'Proforma', url: signed, expires_in: 60 * 60 * 24 * 3 },
              { name: `Facture ${invoice.invoice_number}`, url: invoicePreviewUrl, expires_in: 60 * 60 * 24 * 3 }
            ],
            metadata: { invoice_id: invoice.id, invoice_number: invoice.invoice_number, draft_id: createdDraft.id }
          });
        } catch (e) {
          // fallback to original behavior if magic token creation fails
          const frontendBase2 = (providedFrontend || 'https://feri-mkc.com').replace(/\/$/, '');
          const invoicePreviewUrl = `${frontendBase2}/Facture_.html?invoice_id=${encodeURIComponent(invoice.id)}`;

          await NotificationsService.send({
            userId: request.user_id,
            type: 'DRAFT_AVAILABLE',
            title: 'Draft & Proforma disponibles',
            message: `A draft invoice is available. Invoice number: ${invoice.invoice_number}`,
            entityType: 'request',
            entityId: requestId,
            channels: ['in_app', 'email'],
            links: [
              { name: 'Proforma', url: signed, expires_in: 60 * 60 * 24 * 3 },
              { name: `Facture ${invoice.invoice_number}`, url: invoicePreviewUrl, expires_in: 60 * 60 * 24 * 3 }
            ],
            metadata: { invoice_id: invoice.id, invoice_number: invoice.invoice_number, draft_id: createdDraft.id }
          });
        }
        
      } catch (e) {
        logger.error('Failed to send draft notification', { 
          requestId, 
          err: e instanceof Error ? e.message : JSON.stringify(e),
          stack: e instanceof Error ? e.stack : undefined
        });
      }

      // 7. Return the authoritative invoice object
      const { data: fullInvoice } = await paymentsService.getInvoiceById(invoice.id);
      return fullInvoice || invoice;
    } catch (err) {
      logger.error('AdminService.sendDraft failed', { requestId, adminId, err: (err as any)?.message ?? err });
      throw err;
    }
  }

  static async notifyDraft(requestId: string, adminId: string, opts: { invoiceId?: string | null; invoiceNumber?: string | null } = {}) {
    try {
      logger.info('Admin: notify draft', { requestId, adminId, opts });

      const request = await RequestsService.getRequestById(requestId);
      if (!request) throw new Error('Request not found');

      // Discover an existing draft for this request; prefer one linked to the invoice if provided
      let proformaDraft: any | null = null;
      try {
        const drafts = await DraftsService.getDraftsByRequestId(requestId);
        if (Array.isArray(drafts) && drafts.length > 0) {
          if (opts.invoiceId) {
            proformaDraft = drafts.find((d: any) => String(d.invoice_id || '') === String(opts.invoiceId));
          }
          if (!proformaDraft) {
            proformaDraft = drafts.find((d: any) => (d.type || '').toString().toLowerCase().includes('proforma')) || drafts[drafts.length - 1];
          }
        }
      } catch (e) {
        logger.warn('Failed to query drafts when notifying', { requestId, err: e });
      }

      const links: Array<{ name: string; url: string; expires_in?: number }> = [];

      if (proformaDraft) {
        try {
          const signed = await DraftsService.generateSignedUrl(proformaDraft.id, 60 * 60 * 24 * 3);
          links.push({ name: 'Proforma', url: signed, expires_in: 60 * 60 * 24 * 3 });
        } catch (e) {
          logger.warn('Failed to sign proforma draft', { requestId, draftId: proformaDraft.id, err: e });
        }
      }

      // If invoice id provided, link to invoice preview via magic token
      if (opts.invoiceId) {
        try {
          const paymentsService = new PaymentsService();
          const { data: invoice } = await paymentsService.getInvoiceById(opts.invoiceId);
          const invoiceId = invoice?.id || opts.invoiceId;
          const invoiceNumber = invoice?.invoice_number || opts.invoiceNumber || '';

          const { JWTUtils } = await import('../../utils/jwt');
          const apiBase = (process.env.API_BASE_URL || 'https://mkc-backend-kqov.onrender.com').replace(/\/$/, '');
          const previewPath = `/Facture_.html?invoice_id=${encodeURIComponent(invoiceId)}`;
          const magic = JWTUtils.generateMagicToken({ sub: request.user_id, email: request.customer_email || '', redirect: previewPath });
          const invoicePreviewUrl = `${apiBase}/auth/magic/redirect?token=${encodeURIComponent(magic)}`;
          links.push({ name: `Facture ${invoiceNumber || ''}`, url: invoicePreviewUrl, expires_in: 60 * 60 * 24 * 3 });
        } catch (e) {
          logger.warn('Failed to create invoice preview link when notifying draft', { requestId, err: e });
        }
      }

      // Send notification
      try {
        // Transition request to DRAFT_SENT so admin action and status reflect draft/proforma sent
        try {
          await RequestsService.transitionStatus({ requestId, to: 'DRAFT_SENT', actorRole: 'ADMIN', actorId: adminId, notifyClient: false });
        } catch (transErr) {
          logger.warn('RequestsService.transitionStatus to DRAFT_SENT failed during notifyDraft', { requestId, err: transErr });
        }
        const { NotificationsService } = await import('../notifications/notifications.service');
        await NotificationsService.send({
          userId: request.user_id,
          type: 'DRAFT_AVAILABLE',
          title: 'Draft & Proforma disponibles',
          message: `A draft invoice is available.`,
          entityType: 'request',
          entityId: requestId,
          channels: ['in_app', 'email'],
          links,
          metadata: { invoice_id: opts.invoiceId || null }
        });
      } catch (e) {
        logger.warn('Failed to send notify-draft notification', { requestId, err: e });
      }

      return { notified: true };
    } catch (err) {
      logger.error('AdminService.notifyDraft failed', { requestId, adminId, err: (err as any)?.message ?? err });
      throw err;
    }
  }

    static async notifyProforma(requestId: string, adminId: string, opts: { fileIds?: string[]; message?: string } = {}) {
      try {
        logger.info('Admin: notify proforma', { requestId, adminId, opts });

        const request = await RequestsService.getRequestById(requestId);
        if (!request) throw new Error('Request not found');

        const fileIds = Array.isArray(opts.fileIds) && opts.fileIds.length > 0 ? opts.fileIds : null;

        const links: Array<{ name: string; url: string; expires_in?: number }> = [];
        const metadataItems: any[] = [];

        if (fileIds) {
          for (const fid of fileIds) {
            try {
              const draft = await DraftsService.getDraftById(fid);
              if (!draft) continue;
              if (String(draft.request_id) !== String(requestId)) {
                logger.warn('Draft does not belong to request, skipping', { draftId: fid, requestId });
                continue;
              }
              const signed = await DraftsService.generateSignedUrl(draft.id, 60 * 60 * 24 * 3);
              const linkName = draft.file_name || 'Proforma';
              links.push({ name: linkName, url: signed, expires_in: 60 * 60 * 24 * 3 });
              metadataItems.push({ draft_id: draft.id, file_name: draft.file_name, file_path: draft.file_path, type: draft.type });
            } catch (e) {
              logger.warn('Failed to include draft when notifying proforma', { draftId: fid, err: e });
            }
          }
        } else {
          // fallback to existing logic: pick proforma draft or latest
          try {
            const drafts = await DraftsService.getDraftsByRequestId(requestId);
            let proformaDraft: any | null = null;
            if (Array.isArray(drafts) && drafts.length > 0) {
              proformaDraft = drafts.find((d: any) => (d.type || '').toString().toLowerCase().includes('proforma')) || drafts[drafts.length - 1];
            }
            if (proformaDraft) {
              try {
                const signed = await DraftsService.generateSignedUrl(proformaDraft.id, 60 * 60 * 24 * 3);
                links.push({ name: proformaDraft.file_name || 'Proforma', url: signed, expires_in: 60 * 60 * 24 * 3 });
                metadataItems.push({ draft_id: proformaDraft.id, file_name: proformaDraft.file_name, file_path: proformaDraft.file_path, type: proformaDraft.type });
              } catch (e) {
                logger.warn('Failed to sign proforma draft', { requestId, draftId: proformaDraft.id, err: e });
              }
            }
          } catch (e) {
            logger.warn('Failed to query drafts when notifying proforma', { requestId, err: e });
          }
        }

        // Send notification via existing notifications service
        try {
          const { NotificationsService } = await import('../notifications/notifications.service');
          await NotificationsService.send({
            userId: request.user_id,
            type: 'PROFORMA_AVAILABLE',
            title: 'Proforma disponible',
            message: opts.message || 'A proforma is available.',
            entityType: 'request',
            entityId: requestId,
            channels: ['in_app', 'email'],
            links,
            metadata: { drafts: metadataItems }
          });
        } catch (e) {
          logger.warn('Failed to send notify-proforma notification', { requestId, err: e });
        }

        return { notified: true, linksCount: links.length };
      } catch (err) {
        logger.error('AdminService.notifyProforma failed', { requestId, adminId, err: (err as any)?.message ?? err });
        throw err;
      }
    }

  // Helper method to get the next invoice sequence number
  private static async getNextInvoiceSequenceNumber(): Promise<string> {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');

    const { data: lastInvoice, error } = await supabaseAdmin
      .from('invoices')
      .select('invoice_number')
      .like('invoice_number', `MKC-INV-${year}${month}${day}-%`)
      .order('invoice_number', { ascending: false })
      .limit(1)
      .single();

    if (error || !lastInvoice) {
      return '0001';
    }

    const lastSequence = parseInt(lastInvoice.invoice_number.split('-').pop() || '0', 10);
    return String(lastSequence + 1).padStart(4, '0');
  }
}
