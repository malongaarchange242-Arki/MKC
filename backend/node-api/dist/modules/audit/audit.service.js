"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuditService = void 0;
const supabase_1 = require("../../config/supabase");
const uuid_1 = require("uuid");
const logger_1 = require("../../utils/logger");
class AuditService {
    static async log(input) {
        try {
            const record = {
                id: (0, uuid_1.v4)(),
                actor_id: input.actor_id,
                action: input.action,
                entity: input.entity,
                entity_id: input.entity_id || null,
                metadata: input.metadata || {},
                created_at: new Date().toISOString()
            };
            const { data, error } = await supabase_1.supabase.from('audit_logs').insert(record).select().single();
            if (error || !data) {
                logger_1.logger.warn('Failed to write audit log', { error });
                return null;
            }
            return data;
        }
        catch (err) {
            logger_1.logger.error('AuditService.log failed', { err });
            return null;
        }
    }
}
exports.AuditService = AuditService;
//# sourceMappingURL=audit.service.js.map