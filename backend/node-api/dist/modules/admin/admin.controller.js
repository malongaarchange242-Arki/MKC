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
Object.defineProperty(exports, "__esModule", { value: true });
exports.AdminController = void 0;
const zod_1 = require("zod");
const admin_service_1 = require("./admin.service");
const requests_service_1 = require("../requests/requests.service");
const audit_service_1 = require("../audit/audit.service");
const documents_service_1 = require("../documents/documents.service");
const logger_1 = require("../../utils/logger");
const handleControllerError = (res, error, context = '') => {
    logger_1.logger.error(`${context} failed`, { error });
    if (error instanceof zod_1.ZodError) {
        return res.status(422).json({ message: 'Invalid payload', errors: error.flatten().fieldErrors });
    }
    if (error instanceof Error) {
        return res.status(400).json({ message: error.message });
    }
    return res.status(500).json({ message: 'Unexpected error' });
};
class AdminController {
    static async listUsers(req, res) {
        try {
            const limit = Number(req.query.limit ?? 50) || 50;
            const offset = Number(req.query.offset ?? 0) || 0;
            const users = await admin_service_1.AdminService.listUsers(limit, offset);
            return res.status(200).json(users);
        }
        catch (error) {
            return handleControllerError(res, error, 'List users');
        }
    }
    static async getUserById(req, res) {
        try {
            const userId = req.params.id;
            const user = await admin_service_1.AdminService.getUserById(userId);
            return res.status(200).json(user);
        }
        catch (error) {
            return handleControllerError(res, error, 'Get user');
        }
    }
    static async updateUserRole(req, res) {
        try {
            const schema = zod_1.z.object({ role: zod_1.z.enum(['CLIENT', 'ADMIN', 'SYSTEM']) });
            const body = schema.parse(req.body);
            const userId = req.params.id;
            const updated = await admin_service_1.AdminService.updateUserRole(userId, body.role);
            return res.status(200).json(updated);
        }
        catch (error) {
            return handleControllerError(res, error, 'Update user role');
        }
    }
    static async listRequests(req, res) {
        try {
            const filters = {
                status: req.query.status,
                type: req.query.type,
                userId: req.query.userId
            };
            const data = await admin_service_1.AdminService.listRequests(filters);
            return res.status(200).json(data);
        }
        catch (error) {
            return handleControllerError(res, error, 'List requests');
        }
    }
    static async getRequestById(req, res) {
        try {
            const requestId = req.params.id;
            const data = await admin_service_1.AdminService.getRequestById(requestId);
            return res.status(200).json({ success: true, data });
        }
        catch (error) {
            return handleControllerError(res, error, 'Get request');
        }
    }
    static async markUnderReview(req, res) {
        try {
            if (!req.user)
                return res.status(401).json({ message: 'Unauthorized' });
            const requestId = req.params.id;
            // transition to UNDER_REVIEW
            const result = await requests_service_1.RequestsService.transitionStatus({
                requestId,
                to: 'UNDER_REVIEW',
                actorRole: 'ADMIN',
                actorId: req.user.id
            });
            return res.status(200).json({ success: true, result });
        }
        catch (error) {
            return handleControllerError(res, error, 'Mark under review');
        }
    }
    static async forceUpdateRequestStatus(req, res) {
        try {
            const schema = zod_1.z.object({ status: zod_1.z.string() });
            const body = schema.parse(req.body);
            if (!req.user)
                return res.status(401).json({ message: 'Unauthorized' });
            const requestId = req.params.id;
            const result = await admin_service_1.AdminService.forceUpdateRequestStatus(requestId, body.status, req.user.id);
            return res.status(200).json(result);
        }
        catch (error) {
            return handleControllerError(res, error, 'Force update request status');
        }
    }
    static async listDocuments(req, res) {
        try {
            const filters = {
                requestId: req.query.requestId,
                userId: req.query.userId,
                limit: req.query.limit ? Number(req.query.limit) : undefined,
                offset: req.query.offset ? Number(req.query.offset) : undefined
            };
            const adminId = req.user?.id ?? '';
            const docs = await admin_service_1.AdminService.listDocuments(adminId, filters);
            return res.status(200).json(docs);
        }
        catch (error) {
            return handleControllerError(res, error, 'List documents');
        }
    }
    static async getDocumentById(req, res) {
        try {
            const documentId = req.params.id;
            const adminId = req.user?.id ?? '';
            const doc = await admin_service_1.AdminService.getDocumentById(documentId, adminId);
            return res.status(200).json(doc);
        }
        catch (error) {
            return handleControllerError(res, error, 'Get document');
        }
    }
    static async deleteDocument(req, res) {
        try {
            if (!req.user)
                return res.status(401).json({ message: 'Unauthorized' });
            const documentId = req.params.id;
            const result = await admin_service_1.AdminService.deleteDocument(documentId, req.user.id);
            return res.status(200).json(result);
        }
        catch (error) {
            return handleControllerError(res, error, 'Delete document');
        }
    }
    static async publishFinalDocuments(req, res) {
        try {
            if (!req.user)
                return res.status(401).json({ message: 'Unauthorized' });
            const requestId = req.params.id;
            const opts = req.body || {};
            const result = await admin_service_1.AdminService.publishFinalDocuments(requestId, req.user.id, opts);
            return res.status(200).json({ success: true, ...result });
        }
        catch (error) {
            return handleControllerError(res, error, 'Publish final documents');
        }
    }
    static async uploadDraft(req, res) {
        try {
            if (!req.user)
                return res.status(401).json({ message: 'Unauthorized' });
            const requestId = req.params.id;
            const adminId = req.user.id;
            // Validate documentType
            const docType = (req.body.documentType || req.body.documentType?.toString());
            if (!docType || !['DRAFT_FERI', 'PROFORMA'].includes(docType)) {
                return res.status(422).json({ message: 'documentType is required and must be DRAFT_FERI or PROFORMA' });
            }
            // Ensure files present
            const files = req.files || [];
            if (!files || files.length === 0) {
                return res.status(400).json({ message: 'No files provided' });
            }
            // Fetch request and ensure status is UNDER_REVIEW
            const request = await requests_service_1.RequestsService.getRequestById(requestId);
            if (!request)
                return res.status(404).json({ message: 'Request not found' });
            if (request.status !== 'UNDER_REVIEW')
                return res.status(400).json({ message: 'Cannot upload draft unless request is UNDER_REVIEW' });
            // Only ADMIN allowed (module guard exists but double-check)
            if (req.user.role !== 'ADMIN' && req.user.role !== 'SYSTEM')
                return res.status(403).json({ message: 'Forbidden' });
            const createdDocs = [];
            for (const f of files) {
                const doc = await AdminController._createAdminDocumentInternal(requestId, adminId, docType, f);
                createdDocs.push(doc);
            }
            // Transition to DRAFT_SENT (single transition)
            await requests_service_1.RequestsService.transitionStatus({
                requestId,
                to: 'DRAFT_SENT',
                actorRole: 'ADMIN',
                actorId: adminId
            });
            // Audit
            await audit_service_1.AuditService.log({
                actor_id: adminId,
                action: 'UPLOAD_DRAFT',
                entity: 'request',
                entity_id: requestId,
                metadata: { documents: createdDocs.map(d => d.id), type: docType }
            });
            // Prepare attachments for email + in-app links
            const attachments = [];
            for (const d of createdDocs) {
                try {
                    const { file: fileBuffer, document } = await documents_service_1.DocumentsService.downloadDocument(d.id, adminId, 'ADMIN');
                    attachments.push({ name: document.file_name, mime: document.mime_type, base64: fileBuffer.toString('base64') });
                }
                catch (e) {
                    logger_1.logger.warn('Failed to fetch file for attachment', { docId: d.id, e });
                }
            }
            // Send notification + email
            try {
                const { NotificationsService } = await Promise.resolve().then(() => __importStar(require('../notifications/notifications.service')));
                await NotificationsService.send({
                    userId: request.client_id,
                    type: 'DRAFT_AVAILABLE',
                    title: 'Documents provisoires disponibles',
                    message: 'Votre draft et/ou proforma est disponible. Merci de vérifier et procéder au paiement.',
                    entityType: 'request',
                    entityId: requestId,
                    channels: ['in_app', 'email'],
                    attachments,
                    links: [{ name: 'Voir la demande', url: `${process.env.FRONTEND_URL || 'https://app.example.com'}/requests/${requestId}`, expires_in: 3600 }]
                });
            }
            catch (e) {
                logger_1.logger.warn('Failed to send draft notification', { e });
            }
            return res.status(200).json({ success: true, documents: createdDocs });
        }
        catch (error) {
            return handleControllerError(res, error, 'Upload draft');
        }
    }
    static async confirmPayment(req, res) {
        try {
            if (!req.user)
                return res.status(401).json({ message: 'Unauthorized' });
            const requestId = req.params.id;
            const request = await requests_service_1.RequestsService.getRequestById(requestId);
            if (!request)
                return res.status(404).json({ message: 'Request not found' });
            if (request.status !== 'PAYMENT_PROOF_UPLOADED')
                return res.status(400).json({ message: 'No payment proof to confirm' });
            // Transition to PAYMENT_CONFIRMED
            await requests_service_1.RequestsService.transitionStatus({
                requestId,
                to: 'PAYMENT_CONFIRMED',
                actorRole: 'ADMIN',
                actorId: req.user.id
            });
            // Audit
            await audit_service_1.AuditService.log({
                actor_id: req.user.id,
                action: 'CONFIRM_PAYMENT',
                entity: 'request',
                entity_id: requestId
            });
            // Notify client
            try {
                const { NotificationsService } = await Promise.resolve().then(() => __importStar(require('../notifications/notifications.service')));
                await NotificationsService.send({
                    userId: request.client_id,
                    type: 'PAYMENT_CONFIRMED',
                    title: 'Paiement confirmé',
                    message: 'Votre paiement a été confirmé par l\'administration. La génération des documents finaux sera lancée.',
                    entityType: 'request',
                    entityId: requestId,
                    channels: ['in_app', 'email']
                });
            }
            catch (e) {
                logger_1.logger.warn('Failed to send payment confirmed notification', { e });
            }
            return res.status(200).json({ success: true });
        }
        catch (error) {
            return handleControllerError(res, error, 'Confirm payment');
        }
    }
    static async generateFeri(req, res) {
        try {
            if (!req.user)
                return res.status(401).json({ message: 'Unauthorized' });
            const requestId = req.params.id;
            const doc = await admin_service_1.AdminService.generateFinalDocument(requestId, req.user.id, 'FERI');
            return res.status(200).json({ success: true, document: doc });
        }
        catch (error) {
            return handleControllerError(res, error, 'Generate FERI');
        }
    }
    static async generateAd(req, res) {
        try {
            if (!req.user)
                return res.status(401).json({ message: 'Unauthorized' });
            const requestId = req.params.id;
            const doc = await admin_service_1.AdminService.generateFinalDocument(requestId, req.user.id, 'AD');
            return res.status(200).json({ success: true, document: doc });
        }
        catch (error) {
            return handleControllerError(res, error, 'Generate AD');
        }
    }
    // Internal helper to create admin document and return saved document
    static async _createAdminDocumentInternal(requestId, adminId, docType, file) {
        return await (await Promise.resolve().then(() => __importStar(require('../documents/documents.service')))).DocumentsService.createAdminDocument({
            requestId,
            file,
            uploadedBy: adminId,
            type: docType,
            visibility: 'CLIENT'
        });
    }
}
exports.AdminController = AdminController;
//# sourceMappingURL=admin.controller.js.map