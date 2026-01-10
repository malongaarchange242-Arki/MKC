"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DocumentsController = void 0;
const zod_1 = require("zod");
const documents_service_1 = require("./documents.service");
const request_user_1 = require("../../utils/request-user");
const supabase_1 = require("../../config/supabase");
const axios_1 = __importDefault(require("axios"));
const logger_1 = require("../../utils/logger");
// ===============================
// SCHEMAS
// ===============================
const listDocumentsSchema = zod_1.z.object({
    requestId: zod_1.z.string().uuid().optional(),
    limit: zod_1.z.string().optional().transform(val => val ? parseInt(val, 10) : undefined),
    offset: zod_1.z.string().optional().transform(val => val ? parseInt(val, 10) : undefined)
});
// ===============================
// HELPER ERROR HANDLER
// ===============================
const handleControllerError = (res, error, context = '') => {
    // Ensure Error objects are serialized with message and stack for logs
    const errorMeta = error instanceof Error ? { message: error.message, stack: error.stack } : error;
    logger_1.logger.error(`${context} failed`, { error: errorMeta });
    if (error instanceof zod_1.ZodError) {
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
class DocumentsController {
    // ===============================
    // UPLOAD DOCUMENT (CORRIGÉ & ROBUSTE)
    // ===============================
    static async upload(req, res) {
        try {
            const userId = (0, request_user_1.getAuthUserId)(req);
            const userRole = (0, request_user_1.getAuthUserRole)(req);
            if (!userId) {
                return res.status(401).json({ message: 'Unauthorized' });
            }
            const requestId = req.params.requestId;
            const docType = req.body.doc_type;
            const singleFile = req.file;
            const multipleFiles = req.files || undefined;
            if (!singleFile && (!multipleFiles || multipleFiles.length === 0)) {
                return res.status(400).json({ message: 'No file provided' });
            }
            if (!requestId) {
                return res.status(400).json({ message: 'Request ID is required' });
            }
            const uploadedDocs = [];
            const processOne = async (file) => {
                // 1. Upload initial
                const document = await documents_service_1.DocumentsService.uploadDocument({
                    requestId,
                    file,
                    uploadedBy: userId,
                    docType: docType
                }, userRole);
                // 2. Trigger parsing (Async)
                try {
                    const fileUrl = await documents_service_1.DocumentsService.generateSignedUrlFromDocument(document.id, 60 * 60);
                    const pythonCfg = process.env.PYTHON_SERVICE_URL || 'http://127.0.0.1:8000';
                    const pythonEndpoint = pythonCfg.includes('/api/') ? pythonCfg : `${pythonCfg.replace(/\/$/, '')}/api/v1/parse/document`;
                    const apiKey = process.env.PYTHON_SERVICE_API_KEY || '';
                    const payload = {
                        file_url: fileUrl,
                        document_id: document.id,
                        request_id: requestId,
                        hint: docType
                    };
                    const resp = await axios_1.default.post(pythonEndpoint, payload, {
                        headers: apiKey ? { 'x-api-key': apiKey } : undefined
                    });
                    if (resp && resp.data) {
                        const extraction = resp.data;
                        let blValue = null;
                        let blConfidence = null;
                        // --- LOGIQUE D'EXTRACTION MULTI-FORMAT ---
                        // A. Format Plat (Nouveau)
                        if (extraction.bl_number) {
                            blValue = String(extraction.bl_number);
                            blConfidence = extraction.confidence || extraction.bl_confidence || null;
                        }
                        // B. Format Array (Standard FastAPI)
                        else if (Array.isArray(extraction.fields)) {
                            const blField = extraction.fields.find((f) => f && (f.key === 'bl_number' || f.key === 'BL'));
                            if (blField) {
                                blValue = blField.value != null ? String(blField.value) : null;
                                blConfidence = typeof blField.confidence === 'number' ? blField.confidence : null;
                            }
                        }
                        if (blValue) {
                            logger_1.logger.info('[OCR-SUCCESS] BL detected', { requestId, blValue });
                            // Update request fields and transition to PROCESSING via the RequestsService
                            try {
                                // Save BL fields
                                const { error: saveErr } = await supabase_1.supabase
                                    .from('requests')
                                    .update({ bl_number: blValue, bl_confidence: blConfidence })
                                    .eq('id', requestId);
                                if (saveErr)
                                    logger_1.logger.error('Failed to save BL fields', saveErr);
                                // Use SYSTEM actor to perform transition (allowed in state-machine)
                                const { RequestsService } = await Promise.resolve().then(() => __importStar(require('../requests/requests.service')));
                                try {
                                    await RequestsService.transitionStatus({
                                        requestId,
                                        to: 'PROCESSING',
                                        actorRole: 'SYSTEM',
                                        actorId: 'system'
                                    });
                                }
                                catch (transErr) {
                                    // If the state-machine disallows direct CREATED -> PROCESSING transitions
                                    // fall back to a force update so automated OCR can progress the request.
                                    logger_1.logger.warn('Transition to PROCESSING blocked by state-machine, falling back to forceUpdateStatus', {
                                        requestId,
                                        reason: transErr?.message ?? transErr
                                    });
                                    try {
                                        await RequestsService.forceUpdateStatus(requestId, 'PROCESSING');
                                        logger_1.logger.info('Force-updated request status to PROCESSING after OCR', { requestId });
                                    }
                                    catch (forceErr) {
                                        logger_1.logger.error('Failed to force-update request to PROCESSING after transition blocked', { requestId, err: forceErr });
                                    }
                                }
                            }
                            catch (e) {
                                logger_1.logger.error('Failed to transition to PROCESSING', {
                                    error: e instanceof Error ? { message: e.message, stack: e.stack } : e
                                });
                            }
                        }
                        else {
                            // No BL found: ensure request moves to AWAITING_DOCUMENTS (no notification)
                            try {
                                const { data: reqRow, error: reqErr } = await supabase_1.supabase
                                    .from('requests')
                                    .select('status')
                                    .eq('id', requestId)
                                    .single();
                                if (!reqErr && reqRow && reqRow.status === 'CREATED') {
                                    const { error: updErr } = await supabase_1.supabase
                                        .from('requests')
                                        .update({ status: 'AWAITING_DOCUMENTS' })
                                        .eq('id', requestId);
                                    if (updErr)
                                        logger_1.logger.error('Failed to set AWAITING_DOCUMENTS', updErr);
                                }
                            }
                            catch (e) {
                                logger_1.logger.warn('Failed to set AWAITING_DOCUMENTS after OCR failure', { e });
                            }
                        }
                        // Sauvegarde systématique du JSON complet
                        await documents_service_1.DocumentsService.saveExtractionResult(document.id, extraction, 'python');
                    }
                }
                catch (err) {
                        const respInfo = {};
                        if (err.response)
                            respInfo.response = { status: err.response.status, data: err.response.data };
                        logger_1.logger.error('Python service error', Object.assign({ message: err.message, documentId: document.id }, respInfo));
                }
                return document;
            };
            if (singleFile)
                uploadedDocs.push(await processOne(singleFile));
            if (multipleFiles) {
                for (const f of multipleFiles) {
                    uploadedDocs.push(await processOne(f));
                }
            }
            return res.status(201).json({ success: true, documents: uploadedDocs });
        }
        catch (error) {
            return handleControllerError(res, error, 'Upload document');
        }
    }
    // ===============================
    // DOWNLOAD DOCUMENT
    // ===============================
    static async download(req, res) {
        try {
            const userId = (0, request_user_1.getAuthUserId)(req);
            const userRole = (0, request_user_1.getAuthUserRole)(req);
            if (!userId)
                return res.status(401).json({ message: 'Unauthorized' });
            const documentId = req.params.id;
            const { file, document } = await documents_service_1.DocumentsService.downloadDocument(documentId, userId, userRole);
            res.setHeader('Content-Type', document.mime_type);
            res.setHeader('Content-Disposition', `attachment; filename="${document.file_name}"`);
            return res.send(file);
        }
        catch (error) {
            return handleControllerError(res, error, 'Download document');
        }
    }
    // ===============================
    // GET DOCUMENT BY ID (CORRIGÉ POUR CLIENT)
    // ===============================
    static async getById(req, res) {
        try {
            const userId = (0, request_user_1.getAuthUserId)(req);
            const userRole = (0, request_user_1.getAuthUserRole)(req);
            if (!userId)
                return res.status(401).json({ message: 'Unauthorized' });
            const documentId = req.params.id;
            const document = await documents_service_1.DocumentsService.getDocumentById(documentId, userId, userRole);
            const docOut = { ...document };
            if (userRole === 'CLIENT') {
                const ext = document.extraction_result || document.extraction || {};
                let blRef = null;
                // Extraction du BL pour affichage client
                if (ext.bl_number) {
                    blRef = String(ext.bl_number);
                }
                else if (Array.isArray(ext.fields)) {
                    const f = ext.fields.find((x) => x && (x.key === 'bl_number' || x.key === 'BL'));
                    blRef = f?.value ? String(f.value) : null;
                }
                docOut.extraction = blRef ? { bl_reference: blRef } : null;
            }
            return res.status(200).json({ success: true, document: docOut });
        }
        catch (error) {
            return handleControllerError(res, error, 'Get document');
        }
    }
    // ===============================
    // LISTING METHODS
    // ===============================
    static async listMyDocuments(req, res) {
        try {
            const userId = (0, request_user_1.getAuthUserId)(req);
            const userRole = (0, request_user_1.getAuthUserRole)(req);
            if (!userId)
                return res.status(401).json({ message: 'Unauthorized' });
            const filters = listDocumentsSchema.parse(req.query);
            const result = await documents_service_1.DocumentsService.listDocuments({ ...filters, userId }, userId, userRole);
            return res.status(200).json({ success: true, documents: result.documents, count: result.count });
        }
        catch (error) {
            return handleControllerError(res, error, 'List documents');
        }
    }
    static async listAll(req, res) {
        try {
            const userId = (0, request_user_1.getAuthUserId)(req);
            const userRole = (0, request_user_1.getAuthUserRole)(req);
            if (!userId)
                return res.status(401).json({ message: 'Unauthorized' });
            const filters = listDocumentsSchema.parse(req.query);
            const result = await documents_service_1.DocumentsService.listDocuments(filters, userId, userRole);
            return res.status(200).json({ success: true, documents: result.documents, count: result.count });
        }
        catch (error) {
            return handleControllerError(res, error, 'List all documents');
        }
    }
    static async delete(req, res) {
        try {
            const userId = (0, request_user_1.getAuthUserId)(req);
            const userRole = (0, request_user_1.getAuthUserRole)(req);
            if (!userId)
                return res.status(401).json({ message: 'Unauthorized' });
            await documents_service_1.DocumentsService.deleteDocument(req.params.id, userId, userRole);
            return res.status(200).json({ success: true, message: 'Document deleted' });
        }
        catch (error) {
            return handleControllerError(res, error, 'Delete document');
        }
    }
}
exports.DocumentsController = DocumentsController;
//# sourceMappingURL=documents.controller.js.map