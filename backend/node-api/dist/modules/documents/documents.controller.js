"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DocumentsController = void 0;
const zod_1 = require("zod");
const documents_service_1 = require("./documents.service");
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
            if (!req.user) {
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
                    uploadedBy: req.user.id,
                    docType: docType
                }, req.user.role);
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
                            const { error: updateErr } = await supabase_1.supabase
                                .from('requests')
                                .update({
                                bl_number: blValue,
                                bl_confidence: blConfidence,
                                status: 'PROCESSING'
                            })
                                .eq('id', requestId);
                            if (updateErr)
                                logger_1.logger.error('Supabase update failed', updateErr);
                        }
                        // Sauvegarde systématique du JSON complet
                        await documents_service_1.DocumentsService.saveExtractionResult(document.id, extraction, 'python');
                    }
                }
                catch (err) {
                    logger_1.logger.error('Python service error', { message: err.message, documentId: document.id });
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
            if (!req.user)
                return res.status(401).json({ message: 'Unauthorized' });
            const documentId = req.params.id;
            const { file, document } = await documents_service_1.DocumentsService.downloadDocument(documentId, req.user.id, req.user.role);
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
            if (!req.user)
                return res.status(401).json({ message: 'Unauthorized' });
            const documentId = req.params.id;
            const document = await documents_service_1.DocumentsService.getDocumentById(documentId, req.user.id, req.user.role);
            const docOut = { ...document };
            if (req.user.role === 'CLIENT') {
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
            if (!req.user)
                return res.status(401).json({ message: 'Unauthorized' });
            const filters = listDocumentsSchema.parse(req.query);
            const result = await documents_service_1.DocumentsService.listDocuments({ ...filters, userId: req.user.id }, req.user.id, req.user.role);
            return res.status(200).json({ success: true, documents: result.documents, count: result.count });
        }
        catch (error) {
            return handleControllerError(res, error, 'List documents');
        }
    }
    static async listAll(req, res) {
        try {
            if (!req.user)
                return res.status(401).json({ message: 'Unauthorized' });
            const filters = listDocumentsSchema.parse(req.query);
            const result = await documents_service_1.DocumentsService.listDocuments(filters, req.user.id, req.user.role);
            return res.status(200).json({ success: true, documents: result.documents, count: result.count });
        }
        catch (error) {
            return handleControllerError(res, error, 'List all documents');
        }
    }
    static async delete(req, res) {
        try {
            if (!req.user)
                return res.status(401).json({ message: 'Unauthorized' });
            await documents_service_1.DocumentsService.deleteDocument(req.params.id, req.user.id, req.user.role);
            return res.status(200).json({ success: true, message: 'Document deleted' });
        }
        catch (error) {
            return handleControllerError(res, error, 'Delete document');
        }
    }
}
exports.DocumentsController = DocumentsController;
//# sourceMappingURL=documents.controller.js.map