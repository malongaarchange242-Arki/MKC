"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NotificationsController = void 0;
const supabase_1 = require("../../config/supabase");
class NotificationsController {
    static async listMyNotifications(req, res) {
        try {
            // prefer canonical authUserId set by middleware, fall back to legacy req.user
            const userId = (req.authUserId) ? req.authUserId : (req.user ? req.user.id : null);
            if (!userId)
                return res.status(401).json({ success: false, message: 'Unauthorized' });

            const { data, error, count } = await supabase_1.supabase
                .from('notifications')
                .select('\n          id,\n          type,\n          title,\n          message,\n          entity_type,\n          entity_id,\n          is_read,\n          created_at\n          ', { count: 'exact' })
                .eq('user_id', userId)
                .order('created_at', { ascending: false })
                .range(0, 49);

            if (error) {
                // do not expose 500 to the frontend when upstream (Supabase) is down
                console.error('Notifications fetch error', error);
                return res.status(200).json({ success: true, data: [], pagination: { page: 1, limit: 20, total: 0 }, warning: 'Notifications temporarily unavailable' });
            }

            return res.json({ success: true, data: data || [], pagination: { page: 1, limit: 20, total: count || (data ? data.length : 0) } });
        }
        catch (err) {
            console.error('List notifications failed', err && err.stack ? err.stack : err);
            return res.status(200).json({ success: true, data: [], pagination: { page: 1, limit: 20, total: 0 }, warning: 'Notifications temporarily unavailable' });
        }
    }
    static async markAsRead(req, res) {
        try {
            if (!req.user)
                return res.status(401).json({ success: false, message: 'Unauthorized' });
            const userId = req.user.id;
            const notificationId = req.params.id;
            await supabase_1.supabase
                .from('notifications')
                .update({ is_read: true })
                .eq('id', notificationId)
                .eq('user_id', userId);
            return res.json({ success: true });
        }
        catch (err) {
            return res.status(500).json({ success: false });
        }
    }
}
exports.NotificationsController = NotificationsController;
//# sourceMappingURL=notifications.controller.js.map