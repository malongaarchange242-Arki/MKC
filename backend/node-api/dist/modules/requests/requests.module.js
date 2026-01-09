"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requestsModule = void 0;
// modules/requests/requests.module.ts
const express_1 = require("express");
const requests_controller_1 = require("./requests.controller");
const auth_middleware_1 = require("../../middlewares/auth.middleware");
const role_middleware_1 = require("../../middlewares/role.middleware");
const upload_middleware_1 = require("../../middlewares/upload.middleware");
// ===============================
// REQUESTS MODULE
// ===============================
const requestsModule = () => {
    const router = (0, express_1.Router)();
    // ===============================
    // LIST REQUESTS (CLIENT) - explicit /me route
    // ===============================
    router.get('/me', auth_middleware_1.authMiddleware, (0, role_middleware_1.requireRole)(['CLIENT']), requests_controller_1.RequestsController.list);
    // ===============================
    // CREATE REQUEST (CLIENT ONLY)
    // ===============================
    router.post('/', auth_middleware_1.authMiddleware, (0, role_middleware_1.requireRole)(['CLIENT']), requests_controller_1.RequestsController.create);
    // ===============================
    // UPLOAD PAYMENT PROOF (CLIENT)
    // ===============================
    router.post('/:requestId/payment-proof', auth_middleware_1.authMiddleware, (0, role_middleware_1.requireRole)(['CLIENT']), upload_middleware_1.uploadMiddleware.single('file'), requests_controller_1.RequestsController.submitPaymentProof);
    // ===============================
    // TRANSITION STATUS (AUTHENTICATED)
    // ===============================
    router.post('/transition', auth_middleware_1.authMiddleware, requests_controller_1.RequestsController.transition);
    // ===============================
    // CLIENT SUBMIT (manual)
    // ===============================
    router.post('/:requestId/submit', auth_middleware_1.authMiddleware, (0, role_middleware_1.requireRole)(['CLIENT']), requests_controller_1.RequestsController.submit);
    return router;
};
exports.requestsModule = requestsModule;
//# sourceMappingURL=requests.module.js.map