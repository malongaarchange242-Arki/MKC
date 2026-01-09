"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireRole = void 0;
const logger_1 = require("../utils/logger");
const request_user_1 = require("../utils/request-user");
// ===============================
// ROLES MIDDLEWARE
// ===============================
const requireRole = (allowedRoles) => (req, res, next) => {
    try {
        const role = (0, request_user_1.getAuthUserRole)(req);
        if (!role) {
            logger_1.logger.warn('User role not found on request');
            res.status(403).json({ message: 'Forbidden' });
            return;
        }
        if (!allowedRoles.includes(role)) {
            logger_1.logger.warn('User role not allowed', { role, allowedRoles });
            res.status(403).json({ message: 'Forbidden' });
            return;
        }
        next();
    }
    catch (error) {
        logger_1.logger.error('Role middleware failed', { error });
        res.status(500).json({ message: 'Role validation error' });
    }
};
exports.requireRole = requireRole;
//# sourceMappingURL=role.middleware.js.map