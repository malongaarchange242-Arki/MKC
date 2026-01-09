"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAuthUserId = getAuthUserId;
exports.requireAuthUserId = requireAuthUserId;
exports.getAuthUserRole = getAuthUserRole;
exports.requireAuthUserRole = requireAuthUserRole;
const logger_1 = require("./logger");
// Central helper to extract the authenticated user's id from the request.
// Production requirement: always use the auth.users.id (JWT.sub) as the source
// of truth. The authentication middleware sets `req.authUserId` and
// `req.authUserRole` based on the verified token. This module exposes
// small helpers to consistently read those values across the codebase.
function getAuthUserId(req) {
    const anyReq = req;
    if (anyReq.authUserId)
        return anyReq.authUserId;
    // Backwards-compat: fall back to req.user?.id if middleware still sets it
    if (anyReq.user && anyReq.user.id) {
        logger_1.logger.warn('Using fallback req.user.id; prefer req.authUserId (JWT.sub)');
        return anyReq.user.id;
    }
    return null;
}
function requireAuthUserId(req) {
    const id = getAuthUserId(req);
    if (!id)
        throw new Error('Unauthorized');
    return id;
}
function getAuthUserRole(req) {
    const anyReq = req;
    if (anyReq.authUserRole)
        return anyReq.authUserRole;
    if (anyReq.user && anyReq.user.role)
        return anyReq.user.role;
    return null;
}
function requireAuthUserRole(req) {
    const r = getAuthUserRole(req);
    if (!r)
        throw new Error('Unauthorized');
    return r;
}
//# sourceMappingURL=request-user.js.map