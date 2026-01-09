"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.adminModule = void 0;
const express_1 = require("express");
const admin_controller_1 = require("./admin.controller");
const auth_middleware_1 = require("../../middlewares/auth.middleware");
const role_middleware_1 = require("../../middlewares/role.middleware");
const request_user_1 = require("../../utils/request-user");
const logger_1 = require("../../utils/logger");
const upload_middleware_1 = require("../../middlewares/upload.middleware");
const adminModule = () => {
    const router = (0, express_1.Router)();
    // Apply module-wide protection: only ADMIN or SYSTEM
    // Add a short logging middleware after auth to capture attempts for diagnosis
    router.use(auth_middleware_1.authMiddleware, (req, _res, next) => {
        try {
            const uid = (0, request_user_1.getAuthUserId)(req);
            const role = (0, request_user_1.getAuthUserRole)(req);
            logger_1.logger.info('Admin route access attempt', { path: req.path, userId: uid, role });
        }
        catch (e) {
            logger_1.logger.warn('Failed to log admin access attempt', { error: e });
        }
        next();
    }, (0, role_middleware_1.requireRole)(['ADMIN', 'SYSTEM']));
    // Users
    router.get('/users', admin_controller_1.AdminController.listUsers);
    router.get('/users/:id', admin_controller_1.AdminController.getUserById);
    router.patch('/users/:id/role', admin_controller_1.AdminController.updateUserRole);
    router.patch('/users/:id/status', (_req, res) => res.status(501).json({ message: 'Not implemented' }));
    // Requests
    router.get('/requests', admin_controller_1.AdminController.listRequests);
    router.get('/requests/:id', admin_controller_1.AdminController.getRequestById);
    router.post('/requests/:id/under-review', admin_controller_1.AdminController.markUnderReview);
    router.patch('/requests/:id/status', admin_controller_1.AdminController.forceUpdateRequestStatus);
    router.post('/requests/:id/publish', admin_controller_1.AdminController.publishFinalDocuments);
    router.post('/requests/:id/confirm-payment', admin_controller_1.AdminController.confirmPayment);
    router.post('/requests/:id/generate-feri', admin_controller_1.AdminController.generateFeri);
    router.post('/requests/:id/generate-ad', admin_controller_1.AdminController.generateAd);
    // ADMIN upload draft/proforma
    router.post('/requests/:id/upload-draft', upload_middleware_1.uploadMiddleware.array('files'), admin_controller_1.AdminController.uploadDraft);
    // Documents
    router.get('/documents', admin_controller_1.AdminController.listDocuments);
    router.get('/documents/:id', admin_controller_1.AdminController.getDocumentById);
    router.delete('/documents/:id', admin_controller_1.AdminController.deleteDocument);
    return router;
};
exports.adminModule = adminModule;
//# sourceMappingURL=admin.module.js.map