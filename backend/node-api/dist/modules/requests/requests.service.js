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
exports.RequestsService = void 0;
// modules/requests/requests.service.ts
const supabase_1 = require("../../config/supabase");
const logger_1 = require("../../utils/logger");
const request_state_machine_1 = require("./request.state-machine");
const uuid_1 = require("uuid");
const audit_service_1 = require("../audit/audit.service");
// ===============================
// REQUEST SERVICE
// ===============================
class RequestsService {
    // ===============================
    // CREATE REQUEST
    // ===============================
    static async createRequest(input) {
        logger_1.logger.info('Creating new request', { input });
        const { data, error } = await supabase_1.supabase
            .from('requests')
            .insert({
            id: (0, uuid_1.v4)(),
            client_id: input.clientId,
            type: input.type,
            status: 'CREATED'
        })
            .select()
            .single();
        if (error || !data) {
            logger_1.logger.error('Failed to create request', { error });
            throw new Error('Unable to create request');
        }
        logger_1.logger.info('Request created', { requestId: data.id });
        return data;
    }
    // ===============================
    // LIST REQUESTS (ADMIN)
    // ===============================
    static async listRequests(filters) {
        logger_1.logger.info('Listing requests (admin)', { filters });
        let query = supabase_1.supabase.from('requests').select('*');
        if (filters.status)
            query = query.eq('status', filters.status);
        if (filters.type)
            query = query.eq('type', filters.type);
        if (filters.userId)
            query = query.eq('client_id', filters.userId);
        query = query.order('created_at', { ascending: false }).limit(100);
        const { data, error } = await query;
        if (error) {
            logger_1.logger.error('Failed to list requests', { error });
            throw new Error('Failed to list requests');
        }
        return (data || []);
    }
    // ===============================
    // GET REQUEST BY ID (ADMIN)
    // ===============================
    static async getRequestById(requestId) {
        logger_1.logger.info('Fetching request by id (admin)', { requestId });
        const { data, error } = await supabase_1.supabase
            .from('requests')
            .select('*')
            .eq('id', requestId)
            .single();
        if (error || !data) {
            logger_1.logger.error('Request not found', { requestId, error });
            throw new Error('Request not found');
        }
        return data;
    }
    // ===============================
    // FORCE UPDATE STATUS (ADMIN)
    // ===============================
    static async forceUpdateStatus(requestId, status) {
        logger_1.logger.warn('Force updating request status (admin)', { requestId, status });
        const { data, error } = await supabase_1.supabase
            .from('requests')
            .update({ status })
            .eq('id', requestId)
            .select('*')
            .single();
        if (error || !data) {
            logger_1.logger.error('Failed to force update status', { requestId, status, error });
            throw new Error('Failed to update request status');
        }
        // Notify user (best-effort) for forced updates
        (async () => {
            try {
                const { NotificationsService } = await Promise.resolve().then(() => __importStar(require('../notifications/notifications.service')));
                const clientId = data.client_id;
                // Try to resolve client profile (best-effort)
                let client_name;
                let client_email;
                try {
                    const prof = await supabase_1.supabase.from('profiles').select('prenom,email').eq('id', clientId).single();
                    client_name = prof.data?.prenom;
                    client_email = prof.data?.email;
                }
                catch (e) {
                    logger_1.logger.warn('Failed to load client profile for forced update notification', { e, clientId });
                }
                await NotificationsService.send({
                    userId: clientId,
                    type: 'REQUEST_STATUS_CHANGED',
                    title: `Request status updated to ${status}`,
                    message: `Your request ${requestId} status was set to ${status}`,
                    entityType: 'request',
                    entityId: requestId,
                    channels: ['in_app', 'email'],
                    // Admin template fields
                    client_name,
                    client_email,
                    status,
                    date: new Date().toISOString(),
                    admin_dashboard_url: process.env.ADMIN_DASHBOARD_URL
                });
            }
            catch (e) {
                logger_1.logger.warn('Failed to send notification for forced status update', { requestId, status, err: e });
            }
        })();
        return data;
    }
    // ===============================
    // TRANSITION STATUS
    // ===============================
    static async transitionStatus(input) {
        const { requestId, to, actorRole, actorId } = input;
        logger_1.logger.info('Request status transition attempt', {
            requestId,
            to,
            actorRole
        });
        // 🔍 Fetch current state
        const { data: request, error } = await supabase_1.supabase
            .from('requests')
            .select('status')
            .eq('id', requestId)
            .single();
        if (error || !request) {
            logger_1.logger.error('Request not found', { requestId });
            throw new Error('Request not found');
        }
        const from = request.status;
        if ((0, request_state_machine_1.isFinalState)(from)) {
            throw new Error('Request is in a final state');
        }
        // 🔒 Rule enforcement
        (0, request_state_machine_1.assertTransitionAllowed)(from, to, actorRole);
        // 🔄 Perform update: do NOT rely on DB-side status filtering.
        // Business rules are enforced above via `assertTransitionAllowed(from, to, actorRole)`.
        const { data: updated, error: updateError } = await supabase_1.supabase
            .from('requests')
            .update({ status: to })
            .eq('id', requestId)
            .select('*')
            .single();
        if (updateError || !updated) {
            // Provide clearer diagnostics for common Postgres enum errors
            if (updateError && updateError.code === '22P02') {
                logger_1.logger.error('Supabase update failed invalid input value for enum', { updateError, attemptedStatus: to });
                throw new Error(`Database does not accept status value '${to}'. Add this value to the request_status enum in the DB.`);
            }
            logger_1.logger.error('Status transition failed', { updateError });
            throw new Error('Unable to transition request');
        }
        logger_1.logger.info('Request status updated', { requestId, from, to });
        // Write an audit entry (best-effort)
        try {
            await audit_service_1.AuditService.log({
                actor_id: actorId,
                action: `TRANSITION_${from}_TO_${to}`,
                entity: 'request',
                entity_id: requestId,
                metadata: { from, to, actorRole }
            });
        }
        catch (e) {
            logger_1.logger.warn('Failed to persist audit log for transition', { e });
        }
        // Notify user (best-effort) — dynamic import to avoid circular deps
        (async () => {
            try {
                const { NotificationsService } = await Promise.resolve().then(() => __importStar(require('../notifications/notifications.service')));
                // Resolve client id and profile separately and do not fail the notification if Supabase errors
                let clientId;
                let client_name;
                let client_email;
                if (actorRole === 'CLIENT') {
                    clientId = actorId;
                }
                else {
                    try {
                        const resp = await supabase_1.supabase.from('requests').select('client_id').eq('id', requestId).single();
                        clientId = resp.data?.client_id;
                    }
                    catch (e) {
                        logger_1.logger.warn('Failed to resolve client_id for notification (supabase)', { e, requestId });
                    }
                }
                if (clientId) {
                    try {
                        const prof = await supabase_1.supabase.from('profiles').select('prenom,email').eq('id', clientId).single();
                        client_name = prof.data?.prenom;
                        client_email = prof.data?.email;
                    }
                    catch (e) {
                        logger_1.logger.warn('Failed to fetch client profile for notification', { e, clientId });
                    }
                }
                await NotificationsService.send({
                    userId: clientId ?? '',
                    type: 'REQUEST_STATUS_CHANGED',
                    title: `Request status updated to ${to}`,
                    message: `Your request ${requestId} status changed from ${from} to ${to}`,
                    entityType: 'request',
                    entityId: requestId,
                    channels: ['in_app', 'email'],
                    client_name,
                    client_email,
                    status: to,
                    date: new Date().toISOString(),
                    admin_dashboard_url: process.env.ADMIN_DASHBOARD_URL
                });
            }
            catch (e) {
                logger_1.logger.warn('Failed to send notification for status transition', { e });
            }
        })();
        return { requestId, status: to };
    }
    // ===============================
    // CHECK IF CLIENT CAN SUBMIT
    // ===============================
    static async canClientSubmit(requestId, clientId) {
        // Fetch request
        const { data: request, error } = await supabase_1.supabase
            .from('requests')
            .select('id, client_id, status, type')
            .eq('id', requestId)
            .single();
        if (error || !request) {
            throw new Error('Request not found');
        }
        if (request.client_id !== clientId) {
            throw new Error('Access denied: not the owner of the request');
        }
        // Only allow from CREATED or AWAITING_DOCUMENTS
        if (!['CREATED', 'AWAITING_DOCUMENTS'].includes(request.status)) {
            throw new Error(`Cannot submit request when status is: ${request.status}`);
        }
        // Require at least one uploaded document
        const { data: docs, error: docsErr, count } = await supabase_1.supabase
            .from('documents')
            .select('id', { count: 'exact' })
            .eq('request_id', requestId);
        if (docsErr) {
            logger_1.logger.warn('Failed to check documents for submit', { docsErr });
            throw new Error('Unable to validate documents');
        }
        if (!docs || (count || 0) === 0) {
            throw new Error('At least one document must be uploaded before submitting');
        }
        return true;
    }
}
exports.RequestsService = RequestsService;
//# sourceMappingURL=requests.service.js.map