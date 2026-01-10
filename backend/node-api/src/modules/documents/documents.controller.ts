// modules/documents/documents.controller.ts
import { Request, Response } from 'express';
import { z, ZodError } from 'zod';
import { DocumentsService } from './documents.service';
import { getAuthUserId, getAuthUserRole } from '../../utils/request-user';
import { supabase } from '../../config/supabase';
import axios from 'axios';
import { logger } from '../../utils/logger';

// ===============================
// TYPES
// ===============================
type AuthRequest = Request & {
  user?: {
    id: string;
    email: string;
    role: 'CLIENT' | 'ADMIN' | 'SYSTEM';
  };
};

// ===============================
// SCHEMAS
// ===============================
const listDocumentsSchema = z.object({
  requestId: z.string().uuid().optional(),
  limit: z.string().optional().transform(val => val ? parseInt(val, 10) : undefined),
  offset: z.string().optional().transform(val => val ? parseInt(val, 10) : undefined)
});

// ===============================
// HELPER ERROR HANDLER
// ===============================
const handleControllerError = (
  res: Response,
  error: unknown,
  context = ''
) => {
  // Ensure Error objects are serialized with message and stack for logs
  const errorMeta = error instanceof Error ? { message: error.message, stack: error.stack } : error;
  logger.error(`${context} failed`, { error: errorMeta });

  if (error instanceof ZodError) {
    return res.status(422).json({
      message: 'Invalid payload',
      errors: error.flatten().fieldErrors
    });
  }

  if (error instanceof Error) {
    // Map not-found errors to 404 for clarity
    if (error.message && error.message.startsWith('Request not found')) {
      return res.status(404).json({ message: error.message });
    }

    return res.status(400).json({ message: error.message });
  }

  return res.status(500).json({
    message: 'Unexpected error'
  });
};

// ===============================
// CONTROLLER
// ===============================
export class DocumentsController {
  // ===============================
  // UPLOAD DOCUMENT (CORRIGÉ & ROBUSTE)
  // ===============================
  static async upload(req: AuthRequest, res: Response) {
    try {
      const userId = getAuthUserId(req);
      const userRole = getAuthUserRole(req) as any;
      if (!userId) {
        return res.status(401).json({ message: 'Unauthorized' });
      }

      const requestId = req.params.requestId;
      const docType = req.body.doc_type; 

      const singleFile = req.file as Express.Multer.File | undefined;
      const multipleFiles = (req.files as Express.Multer.File[] | undefined) || undefined;

      if (!singleFile && (!multipleFiles || multipleFiles.length === 0)) {
        return res.status(400).json({ message: 'No file provided' });
      }

      if (!requestId) {
        return res.status(400).json({ message: 'Request ID is required' });
      }
      
      const uploadedDocs = [] as any[];

      const processOne = async (file: Express.Multer.File) => {
        // 1. Upload initial
        const document = await DocumentsService.uploadDocument(
          {
            requestId,
            file,
            uploadedBy: userId,
            docType: docType
          },
          userRole
        );

        // 2. Trigger parsing (Async)
        try {
          const fileUrl = await DocumentsService.generateSignedUrlFromDocument(document.id, 60 * 60);
          const pythonCfg = process.env.PYTHON_SERVICE_URL || 'http://127.0.0.1:8000';
          const pythonEndpoint = pythonCfg.includes('/api/') ? pythonCfg : `${pythonCfg.replace(/\/$/, '')}/api/v1/parse/document`;
          const apiKey = process.env.PYTHON_SERVICE_API_KEY || '';

          const payload = {
            file_url: fileUrl,
            document_id: document.id,
            request_id: requestId,
            hint: docType
          };

          const resp = await axios.post(pythonEndpoint, payload, {
            headers: apiKey ? { 'x-api-key': apiKey } : undefined
          });

          if (resp && resp.data) {
            const extraction = resp.data;
            let blValue: string | null = null;
            let blConfidence: number | null = null;

            // --- LOGIQUE D'EXTRACTION MULTI-FORMAT ---
            // A. Format Plat (Nouveau)
            if (extraction.bl_number) {
              blValue = String(extraction.bl_number);
              blConfidence = extraction.confidence || extraction.bl_confidence || null;
            } 
            // B. Format Array (Standard FastAPI)
            else if (Array.isArray(extraction.fields)) {
              const blField = extraction.fields.find((f: any) => f && (f.key === 'bl_number' || f.key === 'BL'));
              if (blField) {
                blValue = blField.value != null ? String(blField.value) : null;
                blConfidence = typeof blField.confidence === 'number' ? blField.confidence : null;
              }
            }

            if (blValue) {
              logger.info('[OCR-SUCCESS] BL detected', { requestId, blValue });

              // Update request fields and transition to PROCESSING via the RequestsService
              try {
                // Save BL fields
                const { error: saveErr } = await supabase
                  .from('requests')
                  .update({ bl_number: blValue, bl_confidence: blConfidence })
                  .eq('id', requestId);
                if (saveErr) logger.error('Failed to save BL fields', saveErr);

                // Use SYSTEM actor to perform transition (allowed in state-machine)
                const { RequestsService } = await import('../requests/requests.service');
                try {
                  await RequestsService.transitionStatus({
                    requestId,
                    to: 'PROCESSING',
                    actorRole: 'SYSTEM',
                    actorId: 'system'
                  });
                } catch (transErr: any) {
                  // If the state-machine disallows direct CREATED -> PROCESSING transitions
                  // fall back to a force update so automated OCR can progress the request.
                  logger.warn('Transition to PROCESSING blocked by state-machine, falling back to forceUpdateStatus', {
                    requestId,
                    reason: transErr?.message ?? transErr
                  });

                  try {
                    await RequestsService.forceUpdateStatus(requestId, 'PROCESSING');
                    logger.info('Force-updated request status to PROCESSING after OCR', { requestId });
                  } catch (forceErr) {
                    logger.error('Failed to force-update request to PROCESSING after transition blocked', { requestId, err: forceErr });
                  }
                }
              } catch (e) {
                logger.error('Failed to transition to PROCESSING', {
                  error: e instanceof Error ? { message: e.message, stack: e.stack } : e
                });
              }
            } else {
              // No BL found: ensure request moves to AWAITING_DOCUMENTS (no notification)
              try {
                const { data: reqRow, error: reqErr } = await supabase
                  .from('requests')
                  .select('status')
                  .eq('id', requestId)
                  .single();

                if (!reqErr && reqRow && reqRow.status === 'CREATED') {
                  const { error: updErr } = await supabase
                    .from('requests')
                    .update({ status: 'AWAITING_DOCUMENTS' })
                    .eq('id', requestId);
                  if (updErr) logger.error('Failed to set AWAITING_DOCUMENTS', updErr);
                }
              } catch (e) {
                logger.warn('Failed to set AWAITING_DOCUMENTS after OCR failure', { e });
              }
            }

            // Sauvegarde systématique du JSON complet
            await DocumentsService.saveExtractionResult(document.id, extraction, 'python');
          }
        } catch (err: any) {
          const respInfo: any = {};
          if (err.response) respInfo.response = { status: err.response.status, data: err.response.data };
          logger.error('Python service error', { message: err.message, documentId: document.id, ...respInfo });
        }

        return document;
      };

      if (singleFile) uploadedDocs.push(await processOne(singleFile));
      if (multipleFiles) {
        for (const f of multipleFiles) {
          uploadedDocs.push(await processOne(f));
        }
      }

      return res.status(201).json({ success: true, documents: uploadedDocs });
    } catch (error: unknown) {
      return handleControllerError(res, error, 'Upload document');
    }
  }

  // ===============================
  // DOWNLOAD DOCUMENT
  // ===============================
  static async download(req: AuthRequest, res: Response) {
    try {
      const userId = getAuthUserId(req);
      const userRole = getAuthUserRole(req) as any;
      if (!userId) return res.status(401).json({ message: 'Unauthorized' });
      const documentId = req.params.id;
      const { file, document } = await DocumentsService.downloadDocument(documentId, userId, userRole);

      res.setHeader('Content-Type', document.mime_type);
      res.setHeader('Content-Disposition', `attachment; filename="${document.file_name}"`);
      return res.send(file);
    } catch (error: unknown) {
      return handleControllerError(res, error, 'Download document');
    }
  }

  // ===============================
  // GET DOCUMENT BY ID (CORRIGÉ POUR CLIENT)
  // ===============================
  static async getById(req: AuthRequest, res: Response) {
    try {
      const userId = getAuthUserId(req);
      const userRole = getAuthUserRole(req) as any;
      if (!userId) return res.status(401).json({ message: 'Unauthorized' });
      const documentId = req.params.id;
      const document = await DocumentsService.getDocumentById(documentId, userId, userRole);
      const docOut: any = { ...document };

      if (userRole === 'CLIENT') {
        const ext = (document as any).extraction_result || (document as any).extraction || {};
        let blRef = null;
        
        // Extraction du BL pour affichage client
        if (ext.bl_number) {
          blRef = String(ext.bl_number);
        } else if (Array.isArray(ext.fields)) {
          const f = ext.fields.find((x: any) => x && (x.key === 'bl_number' || x.key === 'BL'));
          blRef = f?.value ? String(f.value) : null;
        }

        docOut.extraction = blRef ? { bl_reference: blRef } : null;
      }

      return res.status(200).json({ success: true, document: docOut });
    } catch (error: unknown) {
      return handleControllerError(res, error, 'Get document');
    }
  }

  // ===============================
  // LISTING METHODS
  // ===============================
  static async listMyDocuments(req: AuthRequest, res: Response) {
    try {
      const userId = getAuthUserId(req);
      const userRole = getAuthUserRole(req) as any;
      if (!userId) return res.status(401).json({ message: 'Unauthorized' });
      const filters = listDocumentsSchema.parse(req.query);
      const result = await DocumentsService.listDocuments({ ...filters, userId }, userId, userRole);
      return res.status(200).json({ success: true, documents: result.documents, count: result.count });
    } catch (error: unknown) {
      return handleControllerError(res, error, 'List documents');
    }
  }

  static async listAll(req: AuthRequest, res: Response) {
    try {
      const userId = getAuthUserId(req);
      const userRole = getAuthUserRole(req) as any;
      if (!userId) return res.status(401).json({ message: 'Unauthorized' });
      const filters = listDocumentsSchema.parse(req.query);
      const result = await DocumentsService.listDocuments(filters, userId, userRole);
      return res.status(200).json({ success: true, documents: result.documents, count: result.count });
    } catch (error: unknown) {
      return handleControllerError(res, error, 'List all documents');
    }
  }

  static async delete(req: AuthRequest, res: Response) {
    try {
      const userId = getAuthUserId(req);
      const userRole = getAuthUserRole(req) as any;
      if (!userId) return res.status(401).json({ message: 'Unauthorized' });
      await DocumentsService.deleteDocument(req.params.id, userId, userRole);
      return res.status(200).json({ success: true, message: 'Document deleted' });
    } catch (error: unknown) {
      return handleControllerError(res, error, 'Delete document');
    }
  }
}