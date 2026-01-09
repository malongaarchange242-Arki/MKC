import { supabase } from '../../config/supabase';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../../utils/logger';

export interface AuditLogInput {
	actor_id: string;
	action: string;
	entity: string;
	entity_id?: string;
	metadata?: any;
}

export class AuditService {
	static async log(input: AuditLogInput) {
		try {
			const record = {
				id: uuidv4(),
				actor_id: input.actor_id,
				action: input.action,
				entity: input.entity,
				entity_id: input.entity_id || null,
				metadata: input.metadata || {},
				created_at: new Date().toISOString()
			};

			const { data, error } = await supabase.from('audit_logs').insert(record).select().single();

			if (error || !data) {
				logger.warn('Failed to write audit log', { error });
				return null;
			}

			return data;
		} catch (err) {
			logger.error('AuditService.log failed', { err });
			return null;
		}
	}
}