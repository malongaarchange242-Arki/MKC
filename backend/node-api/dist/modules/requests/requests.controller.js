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
exports.RequestsController = void 0;
const zod_1 = require("zod");
const requests_service_1 = require("./requests.service");
const request_state_machine_1 = require("./request.state-machine");
const logger_1 = require("../../utils/logger");
const documents_service_1 = require("../documents/documents.service");
// ===============================
// SCHEMAS
// ===============================
// Création de demande
const createRequestSchema = zod_1.z.object({
    type: zod_1.z.enum(['FERI_ONLY', 'AD_ONLY', 'FERI_AND_AD'])
});
// Transition de status
const statusEnum = [...request_state_machine_1.REQUEST_STATUSES];
const transitionSchema = zod_1.z.object({
    requestId: zod_1.z.string().uuid(),
    to: zod_1.z.enum(statusEnum)
});
// ===============================
// HELPER pour gérer les erreurs
// ===============================
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
// ===============================
// CONTROLLER
// ===============================
class RequestsController {
    // ===============================
    // CREATE REQUEST
    // ===============================
    static async create(req, res) {
        try {
            if (!req.user) {
                return res.status(401).json({ message: 'Unauthorized' });
            }
            const body = createRequestSchema.parse(req.body);
            const request = await requests_service_1.RequestsService.createRequest({
                clientId: req.user.id,
                type: body.type
            });
            return res.status(201).json(request);
        }
        catch (error) {
            return handleControllerError(res, error, 'Create request');
        }
    }
    // ===============================
    // LIST REQUESTS (CLIENT)
    // ===============================
    static async list(req, res) {
        try {
            if (!req.user)
                return res.status(401).json({ message: 'Unauthorized' });
            const rows = await requests_service_1.RequestsService.listRequests({ userId: req.user.id });
            return res.status(200).json(rows || []);
        }
        catch (error) {
            return handleControllerError(res, error, 'List requests');
        }
    }
    // ===============================
    // TRANSITION STATUS
    // ===============================
    static async transition(req, res) {
        try {
            if (!req.user) {
                return res.status(401).json({ message: 'Unauthorized' });
            }
            const body = transitionSchema.parse(req.body);
            const result = await requests_service_1.RequestsService.transitionStatus({
                requestId: body.requestId,
                to: body.to,
                actorRole: req.user.role,
                actorId: req.user.id
            });
            return res.status(200).json(result);
        }
        catch (error) {
            return handleControllerError(res, error, 'Transition');
        }
    }
    // ===============================
    // CLIENT SUBMIT (manual)
    // ===============================
    static async submit(req, res) {
        try {
            if (!req.user) {
                return res.status(401).json({ message: 'Unauthorized' });
            }
            const requestId = req.params.requestId;
            if (!requestId) {
                return res.status(400).json({ message: 'requestId is required' });
            }
            // Validate that client can submit (ownership, state, documents)
            await requests_service_1.RequestsService.canClientSubmit(requestId, req.user.id);
            const result = await requests_service_1.RequestsService.transitionStatus({
                requestId,
                to: 'SUBMITTED',
                actorRole: 'CLIENT',
                actorId: req.user.id
            });
            return res.status(200).json(result);
        }
        catch (error) {
            return handleControllerError(res, error, 'Submit');
        }
    }
    // ===============================
    // CLIENT: UPLOAD PAYMENT PROOF
    // ===============================
    static async submitPaymentProof(req, res) {
        try {
            if (!req.user)
                return res.status(401).json({ message: 'Unauthorized' });
            const requestId = req.params.requestId;
            const file = req.file;
            if (!file)
                return res.status(400).json({ message: 'No file provided' });
            // Validate request exists and status
            const request = await requests_service_1.RequestsService.getRequestById(requestId);
            if (!request)
                return res.status(404).json({ message: 'Request not found' });
            if (request.status !== 'DRAFT_SENT')
                return res.status(400).json({ message: 'Cannot upload payment proof unless request is DRAFT_SENT' });
            // Create client document (PAYMENT_PROOF)
            const doc = await documents_service_1.DocumentsService.createClientDocument({
                requestId,
                file,
                uploadedBy: req.user.id,
                type: 'PAYMENT_PROOF',
                visibility: 'ADMIN'
            });
            // Transition to PAYMENT_PROOF_UPLOADED
            await requests_service_1.RequestsService.transitionStatus({
                requestId,
                to: 'PAYMENT_PROOF_UPLOADED',
                actorRole: 'CLIENT',
                actorId: req.user.id
            });
            // Audit
            try {
                const { AuditService } = await Promise.resolve().then(() => __importStar(require('../audit/audit.service')));
                await AuditService.log({
                    actor_id: req.user.id,
                    action: 'UPLOAD_PAYMENT_PROOF',
                    entity: 'request',
                    entity_id: requestId,
                    metadata: { documentId: doc.id }
                });
            }
            catch (e) {
                logger_1.logger.warn('Failed to write audit for payment proof', { e });
            }
            // Notify client (and admins) using NotificationsService
            try {
                const { NotificationsService } = await Promise.resolve().then(() => __importStar(require('../notifications/notifications.service')));
                await NotificationsService.send({
                    userId: request.client_id,
                    type: 'PAYMENT_PROOF_UPLOADED',
                    title: 'Preuve de paiement reçue',
                    message: 'Votre preuve de paiement a été reçue et est en attente de vérification par un administrateur.',
                    entityType: 'request',
                    entityId: requestId,
                    channels: ['in_app', 'email']
                });
            }
            catch (e) {
                logger_1.logger.warn('Failed to send payment proof notification', { e });
            }
            return res.status(200).json({ success: true, document: doc });
        }
        catch (error) {
            return handleControllerError(res, error, 'Submit payment proof');
        }
    }
}
exports.RequestsController = RequestsController;
//# sourceMappingURL=requests.controller.js.map