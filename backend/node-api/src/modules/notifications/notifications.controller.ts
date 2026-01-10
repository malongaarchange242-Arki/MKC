// modules/notifications/notifications.controller.ts

import { Request, Response } from 'express';
import { supabase } from '../../config/supabase';
import { getAuthUserId } from '../../utils/request-user';
import { logger } from '../../utils/logger';

type AuthRequest = Request & { user?: { id: string } };

export class NotificationsController {

	/**
	 * 📬 GET /notifications?page=1&limit=20
	 * ⚠️ Jamais de 500 pour le frontend
	 */
	static async listMyNotifications(req: AuthRequest, res: Response) {
		const page = Math.max(1, Number(req.query.page) || 1);
		const limit = Math.min(50, Number(req.query.limit) || 20);
		const from = (page - 1) * limit;
		const to = from + limit - 1;

		try {
			const userId = getAuthUserId(req);

			if (!userId) {
				return res.status(200).json({
					success: false,
					data: [],
					pagination: { page, limit, total: 0 },
					warning: 'Unauthorized'
				});
			}

			const { data, error, count } = await supabase
				.from('notifications')
				.select(
					`
						id,
						type,
						title,
						message,
						entity_type,
						entity_id,
						is_read,
						created_at
					`,
					{ count: 'exact' }
				)
				.eq('user_id', userId)
				.order('created_at', { ascending: false })
				.range(from, to);

			if (error) {
				logger.error('[notifications] Supabase list error', {
					error,
					userId
				});

				return res.status(200).json({
					success: true,
					data: [],
					pagination: { page, limit, total: 0 },
					warning: 'Notifications temporarily unavailable'
				});
			}

			const safeData = (data ?? []).map(n => ({
				id: n.id,
				type: n.type ?? 'REQUEST_STATUS_CHANGED',
				title: n.title ?? 'Notification',
				message: n.message ?? 'You have a new notification.',
				entity_type: n.entity_type ?? null,
				entity_id: n.entity_id ?? null,
				is_read: n.is_read ?? false,
				created_at: n.created_at
			}));

			return res.status(200).json({
				success: true,
				data: safeData,
				pagination: {
					page,
					limit,
					total: count ?? safeData.length
				}
			});
		} catch (err) {
			logger.error('[notifications] List failed (catch)', { err });

			return res.status(200).json({
				success: true,
				data: [],
				pagination: { page, limit, total: 0 },
				warning: 'Notifications temporarily unavailable'
			});
		}
	}

	/**
	 * ✅ PATCH /notifications/:id/read
	 */
	static async markAsRead(req: AuthRequest, res: Response) {
		try {
			const userId = getAuthUserId(req);

			if (!userId) {
				return res.status(401).json({
					success: false,
					message: 'Unauthorized'
				});
			}

			const notificationId = req.params.id;

			if (!notificationId || !/^[0-9a-f-]{36}$/i.test(notificationId)) {
				return res.status(400).json({
					success: false,
					message: 'Invalid notification id'
				});
			}

			const { data, error } = await supabase
				.from('notifications')
				.update({
					is_read: true,
					updated_at: new Date().toISOString()
				})
				.eq('id', notificationId)
				.eq('user_id', userId)
				.select('id')
				.single();

			if (error || !data) {
				logger.warn('[notifications] Mark as read - not found or supabase error', {
					notificationId,
					userId,
					error
				});

				// Be resilient: treat "not found" or temporary Supabase errors as
				// idempotent success for the frontend UX. The frontend expects a 200
				// and will silently continue. We still log the condition for ops.
				return res.status(200).json({
					success: true,
					warning: 'Notification not found or temporarily unavailable'
				});
			}

			return res.status(200).json({ success: true });
		} catch (err) {
			logger.error('[notifications] Mark as read failed', { err });

			return res.status(200).json({
				success: false,
				message: 'Unable to mark notification as read'
			});
		}
	}
}
