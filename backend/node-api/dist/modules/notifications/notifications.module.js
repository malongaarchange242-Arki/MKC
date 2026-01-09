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
// modules/notifications/notifications.module.ts
const express_1 = require("express");
const auth_middleware_1 = require("../../middlewares/auth.middleware");
const logger_1 = require("../../utils/logger");
const router = (0, express_1.Router)();
// apply auth middleware
router.use(auth_middleware_1.authMiddleware);
// Client - dynamic import of controller to avoid static resolution issues
router.get('/', async (req, res, next) => {
    try {
        const mod = await Promise.resolve().then(() => __importStar(require('./notifications.controller')));
        return mod.NotificationsController.listMyNotifications(req, res);
    }
    catch (err) {
        logger_1.logger.error('Notifications route import/list failed', { err });
        return res.status(200).json({
            success: true,
            data: [],
            pagination: { page: 1, limit: 20, total: 0 },
            warning: 'Notifications temporarily unavailable'
        });
    }
});
router.patch('/:id/read', async (req, res, next) => {
    try {
        const mod = await Promise.resolve().then(() => __importStar(require('./notifications.controller')));
        return mod.NotificationsController.markAsRead(req, res);
    }
    catch (err) {
        logger_1.logger.error('Notifications markAsRead import/exec failed', { err });
        return res.status(500).json({ success: false, message: 'Internal server error' });
    }
});
exports.default = router;
//# sourceMappingURL=notifications.module.js.map