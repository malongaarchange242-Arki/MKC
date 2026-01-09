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
const request_user_1 = require("../../utils/request-user");
const request_state_machine_1 = require("./request.state-machine");
const logger_1 = require("../../utils/logger");
const documents_service_1 = require("../documents/documents.service");
// ===============================
// SCHEMAS
// ===============================
const createRequestSchema = zod_1.z.object({
    type: zod_1.z.enum(['FERI_ONLY', 'AD_ONLY', 'FERI_AND_AD'])
});
const statusEnum = [...request_state_machine_1.REQUEST_STATUSES];
const transitionSchema = zod_1.z.object({
    requestId: zod_1.z.string().uuid(),
    to: zod_1.z.enum(statusEnum)
});
// ===============================
// ERROR HANDLER
// ===============================
const handleControllerError = (res, error, context = '') => {
    logger_1.logger.error(`${context} failed`, { error });
    if (error instanceof zod_1.ZodError) {
        return res.status(422).json({
            message: 'Invalid payload',
            errors: error.flatten().fieldErrors
        });
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
    // CREATE REQUEST (CLIENT)
    // ===============================
    static async create(req, res) {
        try {
            const userId = (0, request_user_1.getAuthUserId)(req);
            if (!userId)
                return res.status(401).json({ message: 'Unauthorized' });
            const body = createRequestSchema.parse(req.body);
            const request = await requests_service_1.RequestsService.createRequest({
                clientId: userId,
                type: body.type
            });
            return res.status(201).json(request);
        }
        catch (error) {
            return handleControllerError(res, error, 'Create request');
        }
    }
    // ===============================
    // LIST REQUESTS (CLIENT ONLY)
    // ===============================
    static async list(req, res) {
        try {
            const userId = (0, request_user_1.getAuthUserId)(req);
            const role = (0, request_user_1.getAuthUserRole)(req);
            if (!userId)
                return res.status(401).json({ message: 'Unauthorized' });
            if (role !== 'CLIENT') {
                logger_1.logger.warn('Forbidden access to client list', { userId, role });
                return res.status(403).json({ message: 'Forbidden' });
            }
            const rows = await requests_service_1.RequestsService.listRequests({ userId });
            return res.status(200).json(rows ?? []);
        }
        catch (error) {
            return handleControllerError(res, error, 'List requests');
        }
    }
    // ===============================
    // TRANSITION STATUS (ADMIN / SYSTEM / CLIENT via rules)
    // ===============================
    static async transition(req, res) {
        try {
            const userId = (0, request_user_1.getAuthUserId)(req);
            const userRole = (0, request_user_1.getAuthUserRole)(req);
            if (!userId)
                return res.status(401).json({ message: 'Unauthorized' });
            const body = transitionSchema.parse(req.body);
            const result = await requests_service_1.RequestsService.transitionStatus({
                requestId: body.requestId,
                to: body.to,
                actorRole: userRole,
                actorId: userId
            });
            return res.status(200).json(result);
        }
        catch (error) {
            return handleControllerError(res, error, 'Transition');
        }
    }
    // ===============================
    // CLIENT SUBMIT REQUEST
    // ===============================
    static async submit(req, res) {
        try {
            const userId = (0, request_user_1.getAuthUserId)(req);
            if (!userId)
                return res.status(401).json({ message: 'Unauthorized' });
            const { requestId } = req.params;
            if (!requestId) {
                return res.status(400).json({ message: 'requestId is required' });
            }
            await requests_service_1.RequestsService.canClientSubmit(requestId, userId);
            const result = await requests_service_1.RequestsService.transitionStatus({
                requestId,
                to: 'SUBMITTED',
                actorRole: 'CLIENT',
                actorId: userId
            });
            return res.status(200).json(result);
        }
        catch (error) {
            return handleControllerError(res, error, 'Submit request');
        }
    }
    // ===============================
    // CLIENT UPLOAD PAYMENT PROOF
    // ===============================
    static async submitPaymentProof(req, res) {
        try {
            const userId = (0, request_user_1.getAuthUserId)(req);
            if (!userId)
                return res.status(401).json({ message: 'Unauthorized' });
            const { requestId } = req.params;
            const file = req.file;
            if (!file)
                return res.status(400).json({ message: 'No file provided' });
            const request = await requests_service_1.RequestsService.getRequestById(requestId);
            if (!request)
                return res.status(404).json({ message: 'Request not found' });
            if (request.status !== 'DRAFT_SENT') {
                return res.status(400).json({
                    message: 'Payment proof can only be uploaded after draft is sent'
                });
            }
            const document = await documents_service_1.DocumentsService.createClientDocument({
                requestId,
                file,
                uploadedBy: userId,
                type: 'PAYMENT_PROOF',
                visibility: 'ADMIN'
            });
            await requests_service_1.RequestsService.transitionStatus({
                requestId,
                to: 'PAYMENT_PROOF_UPLOADED',
                actorRole: 'CLIENT',
                actorId: userId
            });
            // 🔔 Notify client
            try {
                const { NotificationsService } = await Promise.resolve().then(() => __importStar(require('../notifications/notifications.service')));
                await NotificationsService.send({
                    userId: request.client_id,
                    type: 'PAYMENT_PROOF_UPLOADED',
                    title: 'Preuve de paiement reçue',
                    message: 'Votre preuve de paiement a été reçue et est en attente de validation par un administrateur.',
                    entityType: 'request',
                    entityId: requestId,
                    channels: ['in_app', 'email']
                });
            }
            catch (e) {
                logger_1.logger.warn('Client notification failed', { e });
            }
            return res.status(200).json({
                success: true,
                document
            });
        }
        catch (error) {
            return handleControllerError(res, error, 'Submit payment proof');
        }
    }
}
exports.RequestsController = RequestsController;
//# sourceMappingURL=requests.controller.js.map