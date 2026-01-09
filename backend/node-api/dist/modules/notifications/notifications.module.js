"use strict";
// modules/notifications/notifications.module.ts
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_middleware_1 = require("../../middlewares/auth.middleware");
const notifications_controller_1 = require("./notifications.controller");
const logger_1 = require("../../utils/logger");
const router = (0, express_1.Router)();
/* ===============================
   AUTHENTICATION
================================ */
router.use(auth_middleware_1.authMiddleware);
/* ===============================
   ROUTES
================================ */
/**
 * 📬 Lister mes notifications
 * ⚠️ Toujours retourner 200 même en cas d’erreur
 * pour éviter les crashs frontend
 */
router.get('/', async (req, res) => {
    try {
        return await notifications_controller_1.NotificationsController.listMyNotifications(req, res);
    }
    catch (err) {
        logger_1.logger.error('List notifications failed', { err });
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
router.patch('/:id/read', async (req, res) => {
    try {
        return await notifications_controller_1.NotificationsController.markAsRead(req, res);
    }
    catch (err) {
        logger_1.logger.error('Mark notification as read failed', {
            err,
            notificationId: req.params.id
        });
        return res.status(200).json({
            success: false,
            message: 'Unable to mark notification as read'
        });
    }
});
exports.default = router;
//# sourceMappingURL=notifications.module.js.map