// modules/documents/documents.service.ts
import { supabaseAdmin as supabase } from '../../config/supabaseAdmin';
import { logger } from '../../utils/logger';
import { v4 as uuidv4 } from 'uuid';
import { RequestsService } from '../requests/requests.service';

// ===============================
// TYPES
// ===============================
export interface Document {
  id: string;
  request_id: string;
  file_name: string;
  file_path: string;
  bucket?: string;
  file_size: number;
  mime_type: string;
  version: number;
  uploaded_by: string;
  uploaded_at: string;
  created_at: string;
  type?: string;
}

export interface UploadDocumentInput {
  requestId: string;
  file: Express.Multer.File;
  uploadedBy: string;
  docType?: string;
}

export interface DocumentListFilters {
  requestId?: string;
  userId?: string;
  limit?: number;
  offset?: number;
}

// ===============================
// CONSTANTS
// ===============================
const STORAGE_BUCKET = 'documents';
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/jpg',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
];

// Allowed document types for client uploads (must match Postgres ENUM values)
// NOTE: If the Postgres ENUM for `documents.type` does not include these new
// AD types, you must update the DB enum/migration (infra/supabase/documents-schema.sql).
const ALLOWED_DOCUMENT_TYPES = [
  'BILL_OF_LADING',
  'FREIGHT_INVOICE',
  'COMMERCIAL_INVOICE',
  'EXPORT_DECLARATION',
  // AD-specific types
  'CUSTOMS_DECLARATION',
  'ROAD_CARRIER',
  'VEHICLE_REGISTRATION',
  'ROAD_FREIGHT_INVOICE',
  'RIVER_FREIGHT_INVOICE',
  'MISC' // Added MISC document type
];

// ===============================
// DOCUMENTS SERVICE
// ===============================
export class DocumentsService {
  private static async insertDocumentPayload(payload: any) {
    // Try inserting payload; if the DB schema is older and missing 'category', retry without it
    const { data, error } = await supabase.from('documents').insert(payload).select().single();
    if (error && (error as any).code === 'PGRST204' && payload && Object.prototype.hasOwnProperty.call(payload, 'category')) {
      const fallback = { ...payload };
      delete fallback.category;
      const { data: d2, error: e2 } = await supabase.from('documents').insert(fallback).select().single();
      return { data: d2, error: e2 };
    }

    return { data, error };
  }
  // Helper to fetch a request row with a small retry/backoff to handle
  // transient schema/cache/visibility issues observed in production.
  private static async fetchRequestRow(requestId: string, fields = 'user_id, status'): Promise<{ data: any | null; error: any | null }> {
    let lastErr: any = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const { data, error } = await supabase
          .from('requests')
          .select(fields)
          .eq('id', requestId)
          .single();

        if (!error && data) {
          return { data, error: null };
        }

        lastErr = error;
      } catch (e) {
        lastErr = e;
      }

      // backoff before retrying
      await new Promise((r) => setTimeout(r, 150 * (attempt + 1)));
    }

    return { data: null, error: lastErr };
  }
  // Centralized file path builder — single source of truth for all uploads
  private static buildDocumentFilePath(requestId: string, uniqueFileName: string, subfolder?: string): string {
    if (subfolder) return `${requestId}/${subfolder}/${uniqueFileName}`;
    return `${requestId}/${uniqueFileName}`;
  }

  // ===============================
  // VALIDATE FILE
  // ===============================
  private static validateFile(file: Express.Multer.File): void {
    if (!file) {
      throw new Error('No file provided');
    }

    if (file.size > MAX_FILE_SIZE) {
      throw new Error(`File size exceeds maximum allowed size of ${MAX_FILE_SIZE / 1024 / 1024}MB`);
    }

    if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      throw new Error(`File type ${file.mimetype} is not allowed`);
    }
  }

  // ===============================
  // CHECK REQUEST ACCESS
  // ===============================
  private static async checkRequestAccess(
    requestId: string,
    userId: string,
    userRole: 'CLIENT' | 'ADMIN' | 'SYSTEM'
  ): Promise<void> {
    // Récupérer la demande
    const { data: request, error } = await this.fetchRequestRow(requestId, 'user_id, status');

    if (error || !request) {
      logger.error('Request lookup failed in checkRequestAccess', { requestId, error });
      throw new Error(`Request not found: ${requestId}`);
    }

    // Vérifier les permissions
    if (userRole === 'ADMIN' || userRole === 'SYSTEM') {
      return; // Admin et System ont accès à tout
    }

    if (userRole === 'CLIENT' && request.user_id !== userId) {
      throw new Error('Access denied: You can only access your own requests');
    }
  }

  // ===============================
  // UPLOAD DOCUMENT (CORRIGÉ)
  // ===============================
  static async uploadDocument(
    input: UploadDocumentInput,
    userRole: 'CLIENT' | 'ADMIN' | 'SYSTEM'
  ): Promise<Document> {
    // 1. On récupère docType depuis l'input
    const { requestId, file, uploadedBy, docType } = input;

    logger.info('Uploading document', { requestId, fileName: file.originalname, docType });

    // Validate document type strictly against allowed enum values
    if (!docType) {
      logger.error('Missing document_type for upload', { requestId, uploadedBy });
      throw new Error('Invalid document_type: document_type is required');
    }

    const normalizedType = String(docType).toUpperCase();
    if (!ALLOWED_DOCUMENT_TYPES.includes(normalizedType)) {
      logger.error('Invalid document_type provided', { requestId, uploadedBy, docType });
      throw new Error('Invalid document_type');
    }

    // Valider le fichier
    this.validateFile(file);

    // Vérifier l'accès à la demande
    await this.checkRequestAccess(requestId, uploadedBy, userRole);

    // Vérifier que la demande est dans un état qui permet l'upload
    const { data: request, error: requestErr } = await this.fetchRequestRow(requestId, 'status');

    if (requestErr || !request) {
      logger.error('Request lookup failed during uploadDocument', { requestId, error: requestErr });
      throw new Error(`Request not found: ${requestId}`);
    }

    // Les clients peuvent uploader dans les états où des documents sont attendus.
    // Étendre l'autorisation à 'PROCESSING' pour permettre l'envoi de documents
    // complémentaires (ex: FACTURES, DECLARATIONS) même après détection automatique
    // du BL sans supprimer les règles existantes.
    if (userRole === 'CLIENT' && !['CREATED', 'AWAITING_DOCUMENTS', 'PROCESSING'].includes(request.status)) {
      throw new Error(`Cannot upload documents when request is in status: ${request.status}`);
    }

    // Générer un chemin unique pour le fichier (centralisé)
    const fileExtension = file.originalname.split('.').pop();
    const uniqueFileName = `${uuidv4()}.${fileExtension}`;
    const storagePath = this.buildDocumentFilePath(requestId, uniqueFileName);

    // Upload vers Supabase Storage (force overwrite to avoid silent failures)
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(storagePath, file.buffer, {
        contentType: file.mimetype,
        upsert: true
      });

    if (uploadError) {
      const errMeta = {
        message: (uploadError as any)?.message || null,
        status: (uploadError as any)?.status || (uploadError as any)?.statusCode || null,
        details: (uploadError as any)?.details || null,
        raw: uploadError
      };
      logger.error('Storage upload failed', { uploadError: errMeta, uploadData });
      throw new Error('Failed to upload file to storage: ' + (errMeta.message || 'unknown'));
    }

    // Use the exact path we generated for upload and store that in DB (single source of truth)
    const storedPath = storagePath;

    // Log the storage path used for debugging
    logger.info('Storage path used', { storagePath, bucket: STORAGE_BUCKET });

    // Verify file exists in storage (single immediate check)
    const { data: listData, error: listError } = await supabase.storage.from(STORAGE_BUCKET).list(requestId);
    if (!listData || !Array.isArray(listData) || !listData.find(f => f.name === uniqueFileName)) {
      // Attempt cleanup and surface clear error
      await supabase.storage.from(STORAGE_BUCKET).remove([storedPath]).catch(() => null);
      logger.error('Storage upload verification failed', { storagePath, uploadData, listError });
      throw new Error('Storage upload verification failed');
    }

    // Récupérer la version actuelle du document (si existe)
    const { data: existingDocs } = await supabase
      .from('documents')
      .select('version')
      .eq('request_id', requestId)
      .eq('file_name', file.originalname)
      .order('version', { ascending: false })
      .limit(1);

    const nextVersion = existingDocs && existingDocs.length > 0 
      ? existingDocs[0].version + 1 
      : 1;

    // 2. Enregistrer en base de données avec le champ 'type'
    const documentId = uuidv4();
    const { data: documentData, error: dbError } = await this.insertDocumentPayload({
      id: documentId,
      request_id: requestId,
      file_name: file.originalname,
      file_path: storedPath,
      bucket: STORAGE_BUCKET,
      file_size: file.size,
      mime_type: file.mimetype,
      version: nextVersion,
      uploaded_by: uploadedBy,
      // store the normalized, validated type matching Postgres ENUM
      type: normalizedType
    });

    if (dbError || !documentData) {
      // Nettoyer le fichier uploadé en cas d'erreur DB
      await supabase.storage.from(STORAGE_BUCKET).remove([storedPath]);
      logger.error('Failed to save document metadata', { dbError });
      throw new Error('Failed to save document metadata');
    }

    // NOTE: do NOT transition status here. Status will be determined after parsing/OCR
    // and updated by the controller to either 'PROCESSING' (if OCR detects valid BL)
    // or 'AWAITING_DOCUMENTS' (if no usable extraction). This avoids sending an
    // early notification for AWAITING_DOCUMENTS before OCR completes.

    logger.info('Document uploaded successfully', { documentId, requestId, type: docType });

    return documentData as Document;
  }

  // ===============================
  // GET DOCUMENT BY ID
  // ===============================
  static async getDocumentById(
    documentId: string,
    userId: string,
    userRole: 'CLIENT' | 'ADMIN' | 'SYSTEM'
  ): Promise<Document> {
    logger.info('Fetching document', { documentId });

    const { data: document, error } = await supabase
      .from('documents')
      .select('*')
      .eq('id', documentId)
      .single();

    if (error || !document) {
      throw new Error('Document not found');
    }

    // Vérifier l'accès
    await this.checkRequestAccess(document.request_id, userId, userRole);

    return document as Document;
  }

  // ===============================
  // DOWNLOAD DOCUMENT
  // ===============================
  static async downloadDocument(
    documentId: string,
    userId: string,
    userRole: 'CLIENT' | 'ADMIN' | 'SYSTEM'
  ): Promise<{ file: Buffer; document: Document }> {
    // Récupérer les métadonnées du document
    const document = await this.getDocumentById(documentId, userId, userRole);

    // Télécharger le fichier depuis Storage
    const { data: fileData, error: downloadError } = await supabase.storage
      .from(STORAGE_BUCKET)
      .download(document.file_path);

    if (downloadError || !fileData) {
      logger.error('Failed to download file from storage', { downloadError });
      throw new Error('Failed to download file');
    }

    // Convertir en Buffer
    const arrayBuffer = await fileData.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    return {
      file: buffer,
      document
    };
  }

  // ===============================
  // LIST DOCUMENTS
  // ===============================
  static async listDocuments(
    filters: DocumentListFilters,
    userId: string,
    userRole: 'CLIENT' | 'ADMIN' | 'SYSTEM'
  ): Promise<{ documents: Document[]; count: number }> {
    logger.info('Listing documents', { filters, userId, userRole });

    // Select a concise set of fields and use created_at as the canonical timestamp
    let query = supabase
      .from('documents')
      .select(`
        id,
        request_id,
        created_at,
        uploaded_by,
        file_name,
        file_size,
        mime_type,
        type
      `, { count: 'exact' });

    // Filtres selon le rôle
    if (userRole === 'CLIENT') {
      // Les clients voient uniquement les documents de leurs demandes
      // Récupérer d'abord les IDs des demandes du client
      const { data: userRequests } = await supabase
        .from('requests')
        .select('id')
        .eq('user_id', userId);

      if (userRequests && userRequests.length > 0) {
        const requestIds = userRequests.map(r => r.id);
        query = query.in('request_id', requestIds);
      } else {
        // Si le client n'a aucune demande, retourner un tableau vide
        return { documents: [], count: 0 };
      }
    }

    if (filters.requestId) {
      // Vérifier l'accès à la demande
      await this.checkRequestAccess(filters.requestId, userId, userRole);
      query = query.eq('request_id', filters.requestId);
    }

    query = query.order('created_at', { ascending: false });

    if (filters.limit) {
      query = query.limit(filters.limit);
    }

    if (filters.offset) {
      query = query.range(filters.offset, filters.offset + (filters.limit || 50) - 1);
    }

    const { data, error, count } = await query;

    if (error) {
      logger.error('Failed to list documents', { error });
      throw new Error('Failed to list documents');
    }

    return {
      documents: (data || []) as Document[],
      count: count || 0
    };
  }

  // ===============================
  // CREATE FINAL DOCUMENT (from existing metadata/file)
  // ===============================
  static async createFinalDocumentFromExisting(
    existing: Document,
    adminId: string,
    type: 'FERI' | 'AD' | null = null
  ): Promise<Document> {
    logger.info('Creating final document entry from existing file', { existing: existing.id, adminId });

    const documentId = uuidv4();

    const { data, error } = await supabase
      .from('documents')
      .insert({
        id: documentId,
        request_id: existing.request_id,
        file_name: existing.file_name,
        file_path: existing.file_path,
        bucket: (existing as any).bucket || STORAGE_BUCKET,
        file_size: existing.file_size,
        mime_type: existing.mime_type,
        version: (existing.version || 1) + 1,
        uploaded_by: adminId,
        category: 'FINAL',
        type: type || (existing as any).type || null,
        format: 'PDF',
        is_public: false
      })
      .select()
      .single();

    if (error || !data) {
      logger.error('Failed to create final document record', { error });
      throw new Error('Failed to create final document');
    }

    return data as Document;
  }

  // ===============================
  // GENERATE SIGNED URL
  // ===============================
  static async generateSignedUrl(filePath: string, expiresInSec = 60 * 60, bucket: string = STORAGE_BUCKET) {
    const { data, error } = await supabase.storage
      .from(bucket)
      .createSignedUrl(filePath, expiresInSec);

    if (error || !data) {
      logger.error('Failed to create signed URL', { filePath, bucket, error });
      throw new Error('Failed to create signed url');
    }

    return data.signedUrl as string;
  }

  // Generate signed URL by document id (always read path from DB)
  static async generateSignedUrlFromDocument(
  documentId: string,
  expiresInSec = 60 * 60
) {
  const { data: document, error } = await (supabase as any)
    .from('documents')
    .select('file_path, bucket')
    .eq('id', documentId)
    .single();

  if (error || !document?.file_path) {
    logger.error('Document file_path not found', { documentId, error });
    throw new Error('Document file_path not found');
  }

  const filePath = document.file_path as string;
  const bucket = document.bucket || STORAGE_BUCKET;
  // Create signed URL using the exact path stored in DB — no reconstruction, no polling, no retries
  const { data: signData, error: signError } = await supabase.storage
    .from(bucket)
    .createSignedUrl(filePath, expiresInSec);

  if (signError || !signData?.signedUrl) {
    logger.error('Failed to create signed URL', { filePath, bucket, error: signError });
    throw new Error('Failed to create signed url');
  }

  return signData.signedUrl as string;
}


  // ===============================
  // PERSIST EXTRACTION RESULT
  // ===============================
  /**
   * Persist extracted data for a document. Stores JSON in `extraction` column
   * on `documents` table and writes a small audit record in `document_extractions` if needed.
   */
  static async saveExtractionResult(documentId: string, extraction: any, source: 'python' | 'manual' = 'python') {
    try {
      // Insert full JSON response into `document_extractions` as the source of truth
      const { data: insertData, error: insertError } = await supabase
        .from('document_extractions')
        .insert({
          document_id: documentId,
          source,
          extraction
        });

      if (insertError) {
        logger.warn('Failed to persist extraction to document_extractions', { documentId, error: insertError });
        return null;
      }

      logger.info('Persisted extraction to document_extractions', { documentId, source });

      // Attempt to propagate BL and other common fields to the related request (best-effort)
      try {
        // Fetch minimal document info to find request_id
        const { data: docData, error: docErr } = await supabase
          .from('documents')
          .select('request_id')
          .eq('id', documentId)
          .single();

        if (docErr || !docData) {
          // Non-fatal: document may not exist or permission issue
          if (docErr) logger.warn('Could not fetch document for propagation', { documentId, error: docErr });
          return insertData;
        }

        const requestId = (docData as any).request_id;
        if (!requestId) return insertData;

        // Extract BL number and confidence (same logic as before)
        let blNumber: string | null = null;
        let blConfidence: number | null = null;

        if (Array.isArray(extraction?.fields)) {
          const blField = extraction.fields.find((x: any) => x && (x.key === 'bl_number' || x.key === 'BL'));
          if (blField && blField.value) {
            blNumber = String(blField.value);
            blConfidence = typeof blField.confidence === 'number' ? blField.confidence : null;
          }
        }

        if (!blNumber && extraction?.extraction && Array.isArray(extraction.extraction.fields)) {
          const blField = extraction.extraction.fields.find((x: any) => x && (x.key === 'bl_number' || x.key === 'BL'));
          if (blField && blField.value) {
            blNumber = String(blField.value);
            blConfidence = typeof blField.confidence === 'number' ? blField.confidence : blConfidence;
          }
        }

        if (!blNumber && extraction && extraction.references && extraction.references.bl_number) {
          blNumber = String(extraction.references.bl_number);
        }

        if (!blNumber && extraction && typeof extraction.fields === 'object' && extraction.fields !== null && !Array.isArray(extraction.fields)) {
          if (extraction.fields.bl_number) blNumber = String(extraction.fields.bl_number);
        }

        const reqUpdate: any = {};
        if (blNumber) reqUpdate.bl_number = blNumber;
        if (blConfidence != null) reqUpdate.bl_confidence = blConfidence;

        try {
          const normalized = extraction && (extraction.extraction || extraction) ? (extraction.extraction || extraction) : null;
          if (normalized && typeof normalized === 'object') {
            if (normalized.vessel) reqUpdate.vessel = normalized.vessel;
            if (normalized.voyage) reqUpdate.voyage = normalized.voyage;
            if (normalized.port_of_loading) reqUpdate.port_of_loading = normalized.port_of_loading;
            if (normalized.port_of_discharge) reqUpdate.port_of_discharge = normalized.port_of_discharge;
            if (normalized.shipped_on_board_date) reqUpdate.shipped_on_board_date = normalized.shipped_on_board_date;
            if (normalized.booking_no) reqUpdate.booking_no = normalized.booking_no;
          }
        } catch (e) {
          logger.warn('Failed to build request update payload from extraction', { e });
        }

        if (Object.keys(reqUpdate).length > 0) {
          try {
            await supabase.from('requests').update(reqUpdate).eq('id', requestId);
            logger.info('Propagated extraction fields to request', { requestId, reqUpdate });
            if (blNumber) {
              logger.info('[BL-DETECTED] ' + `requestId=${requestId} bl=${blNumber} confidence=${blConfidence}`);
            }
          } catch (e) {
            logger.warn('Failed to propagate extraction fields to request (columns may not exist)', { err: e, requestId, reqUpdate });
          }
        }

        return insertData;
      } catch (e) {
        logger.warn('Error while attempting to propagate extraction to request', { e });
        return insertData;
      }
    } catch (err) {
      logger.warn('saveExtractionResult failed', { documentId, err });
      return null;
    }
  }

  // ===============================
  // CREATE ADMIN DOCUMENT (DRAFT / PROFORMA)
  // ===============================
  static async createAdminDocument(input: {
    requestId: string;
    file: Express.Multer.File;
    uploadedBy: string;
    type: 'DRAFT_FERI' | 'PROFORMA' | string;
    visibility?: 'CLIENT' | 'ADMIN' | 'PRIVATE';
  }) {
    const { requestId, file, uploadedBy, type, visibility = 'CLIENT' } = input;

    logger.info('Creating admin document', { requestId, fileName: file.originalname, type, uploadedBy });

    // Validate basic file constraints
    this.validateFile(file);

    // Generate unique path
    const fileExtension = file.originalname.split('.').pop();
    const uniqueFileName = `${uuidv4()}.${fileExtension}`;
    const storagePath = this.buildDocumentFilePath(requestId, uniqueFileName, 'admin');

    // Upload to storage
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(storagePath, file.buffer, {
        contentType: file.mimetype,
        upsert: true
      });

    if (uploadError) {
      const errMeta = {
        message: (uploadError as any)?.message || null,
        status: (uploadError as any)?.status || (uploadError as any)?.statusCode || null,
        details: (uploadError as any)?.details || null,
        raw: uploadError
      };
      logger.error('Storage upload failed (admin document)', { uploadError: errMeta, uploadData });
      throw new Error('Failed to upload admin document to storage: ' + (errMeta.message || 'unknown'));
    }

    // Persist the exact generated path used for upload
    const storedPath = storagePath;

    // Log the storage path used for debugging
    logger.info('Storage path used', { storagePath, bucket: STORAGE_BUCKET });

    // Verify file exists in storage (single immediate check in admin folder)
    const adminFolder = `${requestId}/admin`;
    const { data: listData, error: listError } = await supabase.storage.from(STORAGE_BUCKET).list(adminFolder);
    if (!listData || !Array.isArray(listData) || !listData.find(f => f.name === uniqueFileName)) {
      await supabase.storage.from(STORAGE_BUCKET).remove([storedPath]).catch(() => null);
      logger.error('Storage upload verification failed (admin)', { storagePath, uploadData, listError });
      throw new Error('Storage upload verification failed');
    }

    // Insert metadata
    const documentId = uuidv4();
    const { data: documentData, error: dbError } = await this.insertDocumentPayload({
      id: documentId,
      request_id: requestId,
      file_name: file.originalname,
      file_path: storedPath,
      bucket: STORAGE_BUCKET,
      file_size: file.size,
      mime_type: file.mimetype,
      version: 1,
      uploaded_by: uploadedBy,
      uploaded_by_role: 'ADMIN',
      category: 'DRAFT',
      type: type,
      is_final: false,
      visibility: visibility
    });

    if (dbError || !documentData) {
      // cleanup
      await supabase.storage.from(STORAGE_BUCKET).remove([storedPath]);
      logger.error('Failed to save admin document metadata', { dbError });
      throw new Error('Failed to save admin document metadata');
    }

    return documentData as Document;
  }

  // ===============================
  // CREATE CLIENT DOCUMENT (PAYMENT PROOF)
  // ===============================
  static async createClientDocument(input: {
    requestId: string;
    file: Express.Multer.File;
    uploadedBy: string;
    type: 'PAYMENT_PROOF' | string;
    visibility?: 'CLIENT' | 'ADMIN' | 'PRIVATE';
  }) {
    const { requestId, file, uploadedBy, type, visibility = 'ADMIN' } = input;

    logger.info('Creating client document', { requestId, fileName: file.originalname, type, uploadedBy });

    // Validate file
    this.validateFile(file);

    const fileExtension = file.originalname.split('.').pop();
    const uniqueFileName = `${uuidv4()}.${fileExtension}`;
    const storagePath = this.buildDocumentFilePath(requestId, uniqueFileName, 'client');

    const { data: uploadData, error: uploadError } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(storagePath, file.buffer, {
        contentType: file.mimetype,
        upsert: true
      });

    if (uploadError) {
      const errMeta = {
        message: (uploadError as any)?.message || null,
        status: (uploadError as any)?.status || (uploadError as any)?.statusCode || null,
        details: (uploadError as any)?.details || null,
        raw: uploadError
      };
      logger.error('Storage upload failed (client document)', { uploadError: errMeta, uploadData });
      throw new Error('Failed to upload client document to storage: ' + (errMeta.message || 'unknown'));
    }

    const storedPath = storagePath;

    // Log the storage path used for debugging
    logger.info('Storage path used', { storagePath, bucket: STORAGE_BUCKET });

    // Verify file exists in storage (single immediate check in client folder)
    const clientFolder = `${requestId}/client`;
    const { data: listData, error: listError } = await supabase.storage.from(STORAGE_BUCKET).list(clientFolder);
    if (!listData || !Array.isArray(listData) || !listData.find(f => f.name === uniqueFileName)) {
      await supabase.storage.from(STORAGE_BUCKET).remove([storedPath]).catch(() => null);
      logger.error('Storage upload verification failed (client)', { storagePath, uploadData, listError });
      throw new Error('Storage upload verification failed');
    }

    const documentId = uuidv4();
    const { data: documentData, error: dbError } = await this.insertDocumentPayload({
      id: documentId,
      request_id: requestId,
      file_name: file.originalname,
      file_path: storedPath,
      bucket: STORAGE_BUCKET,
      file_size: file.size,
      mime_type: file.mimetype,
      version: 1,
      uploaded_by: uploadedBy,
      uploaded_by_role: 'CLIENT',
      category: 'PROOF',
      type: type,
      is_final: false,
      visibility: visibility
    });

    if (dbError || !documentData) {
      await supabase.storage.from(STORAGE_BUCKET).remove([storedPath]);
      logger.error('Failed to save client document metadata', { dbError });
      throw new Error('Failed to save client document metadata');
    }

    return documentData as Document;
  }

  // ===============================
  // CREATE FINAL DOCUMENT FROM BUFFER
  // ===============================
  static async createFinalDocumentFromBuffer(params: {
    requestId: string;
    buffer: Buffer;
    filename: string;
    mimeType: string;
    adminId: string;
    type?: 'FERI_FINAL' | 'AD_FINAL' | string;
  }) {
    const { requestId, buffer, filename, mimeType, adminId, type } = params;

    const fileExtension = filename.split('.').pop() || 'pdf';
    const uniqueFileName = `${uuidv4()}.${fileExtension}`;
    const storagePath = this.buildDocumentFilePath(requestId, uniqueFileName, 'final');

    const { data: uploadData, error: uploadError } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(storagePath, buffer, {
        contentType: mimeType,
        upsert: true
      });

    if (uploadError) {
      const errMeta = {
        message: (uploadError as any)?.message || null,
        status: (uploadError as any)?.status || (uploadError as any)?.statusCode || null,
        details: (uploadError as any)?.details || null,
        raw: uploadError
      };
      logger.error('Storage upload failed (final document)', { uploadError: errMeta, uploadData });
      throw new Error('Failed to upload final document to storage: ' + (errMeta.message || 'unknown'));
    }

    const storedPath = storagePath;

    // Log the storage path used for debugging
    logger.info('Storage path used', { storagePath, bucket: STORAGE_BUCKET });

    // Verify file exists in storage (single immediate check in final folder)
    const finalFolder = `${requestId}/final`;
    const { data: listData, error: listError } = await supabase.storage.from(STORAGE_BUCKET).list(finalFolder);
    if (!listData || !Array.isArray(listData) || !listData.find(f => f.name === uniqueFileName)) {
      await supabase.storage.from(STORAGE_BUCKET).remove([storedPath]).catch(() => null);
      logger.error('Storage upload verification failed (final)', { storagePath, uploadData, listError });
      throw new Error('Storage upload verification failed');
    }

    const documentId = uuidv4();

    const { data: documentData, error: dbError } = await this.insertDocumentPayload({
      id: documentId,
      request_id: requestId,
      file_name: filename,
      file_path: storedPath,
      bucket: STORAGE_BUCKET,
      file_size: buffer.length,
      mime_type: mimeType,
      version: 1,
      uploaded_by: adminId,
      uploaded_by_role: 'ADMIN',
      category: 'FINAL',
      type: type || null,
      is_final: true,
      visibility: 'CLIENT'
    });

    if (dbError || !documentData) {
      // cleanup
      await supabase.storage.from(STORAGE_BUCKET).remove([storedPath]);
      logger.error('Failed to save final document metadata', { dbError });
      throw new Error('Failed to save final document metadata');
    }

    return documentData as Document;
  }

  // ===============================
  // DELETE DOCUMENT
  // ===============================
  static async deleteDocument(
    documentId: string,
    userId: string,
    userRole: 'CLIENT' | 'ADMIN' | 'SYSTEM'
  ): Promise<void> {
    logger.info('Deleting document', { documentId });

    // Récupérer le document
    const document = await this.getDocumentById(documentId, userId, userRole);

    // Vérifier que seul le client peut supprimer ses documents (et seulement si la demande n'est pas soumise)
    if (userRole === 'CLIENT') {
      const { data: request } = await supabase
        .from('requests')
        .select('status')
        .eq('id', document.request_id)
        .single();

      if (request && ['SUBMITTED', 'UNDER_REVIEW', 'DRAFT_READY', 'VALIDATED', 'ISSUED'].includes(request.status)) {
        throw new Error('Cannot delete document: request is already submitted or processed');
      }
    }

    // Supprimer le fichier du storage
    const { error: storageError } = await supabase.storage
      .from(STORAGE_BUCKET)
      .remove([document.file_path]);

    if (storageError) {
      logger.warn('Failed to delete file from storage', { storageError });
    }

    // Supprimer l'enregistrement en DB
    const { error: dbError } = await supabase
      .from('documents')
      .delete()
      .eq('id', documentId);

    if (dbError) {
      logger.error('Failed to delete document from database', { dbError });
      throw new Error('Failed to delete document');
    }

    logger.info('Document deleted successfully', { documentId });
  }
}
