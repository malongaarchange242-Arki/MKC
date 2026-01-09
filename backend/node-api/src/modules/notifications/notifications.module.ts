// modules/notifications/notifications.module.ts

import { Router, Request, Response } from 'express';
import { authMiddleware } from '../../middlewares/auth.middleware';
import { NotificationsController } from './notifications.controller';
import { logger } from '../../utils/logger';

const router = Router();

/* ===============================
   AUTHENTICATION
================================ */

router.use(authMiddleware);

/* ===============================
   ROUTES
================================ */

/**
 * 📬 Lister mes notifications
 * ⚠️ Toujours retourner 200 même en cas d’erreur
 * pour éviter les crashs frontend
 */
router.get('/', async (req: Request, res: Response) => {
	try {
		await NotificationsController.listMyNotifications(
			req as any,
			res as any
		);
	} catch (err) {
		logger.error('List notifications failed', { err });

		return res.status(200).json({
			success: true,
			data: [],
			pagination: {
				page: 1,
				limit: 20,
				total: 0
			},
			warning: 'Notifications temporarily unavailable'
		});
	}
});

/**
 * ✅ Marquer une notification comme lue
 */
router.patch('/:id/read', async (req: Request, res: Response) => {
	try {
		await NotificationsController.markAsRead(
			req as any,
			res as any
		);
	} catch (err) {
		logger.error('Mark notification as read failed', {
			err,
			notificationId: req.params.id
		});

		return res.status(200).json({
			success: false,
			message: 'Unable to mark notification as read'
		});
	}
});

export default router;
