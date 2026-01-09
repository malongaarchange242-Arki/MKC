"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.authMiddleware = void 0;
const logger_1 = require("../utils/logger");
const jwt_1 = require("../utils/jwt");
// AUTH MIDDLEWARE (STRICT)
// - Decode JWT (no Supabase call)
// - Set ONLY `req.authUserId` from JWT.sub
// - Remove any legacy `req.user` to discourage its usage
const authMiddleware = (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            logger_1.logger.warn('Missing or malformed Authorization header');
            res.status(401).json({ message: 'Unauthorized' });
            return;
        }
        const token = authHeader.replace('Bearer ', '').trim();
        let payload;
        try {
            // Verify the token signature to ensure authenticity
            payload = jwt_1.JWTUtils.verifyToken(token);
        }
        catch (verifyErr) {
            logger_1.logger.warn('JWT verify failed', { error: verifyErr instanceof Error ? verifyErr.message : verifyErr });
            res.status(401).json({ message: 'Invalid or expired token' });
            return;
        }
        if (!payload || !payload.sub) {
            logger_1.logger.warn('JWT payload missing subject after verify');
            res.status(401).json({ message: 'Invalid token' });
            return;
        }
        // Canonical auth id (auth.users.id) exposed for handlers
        req.authUserId = payload.sub;
        // Attach role from JWT payload as canonical role
        req.authUserRole = payload.role ?? null;
        // Explicitly remove legacy `req.user` if present to avoid accidental use
        try {
            if (req.user)
                delete req.user;
        }
        catch (e) {
            // no-op
        }
        logger_1.logger.debug('Auth middleware set authUserId and authUserRole', { authUserId: payload.sub, authUserRole: payload.role ?? null });
        next();
    }
    catch (error) {
        logger_1.logger.error('Authentication middleware failed', { error });
        res.status(500).json({ message: 'Authentication error' });
    }
};
exports.authMiddleware = authMiddleware;
//# sourceMappingURL=auth.middleware.js.map