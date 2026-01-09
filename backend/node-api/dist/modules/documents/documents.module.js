"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.documentsModule = void 0;
// modules/documents/documents.module.ts
const express_1 = require("express");
const documents_controller_1 = require("./documents.controller");
const auth_middleware_1 = require("../../middlewares/auth.middleware");
const role_middleware_1 = require("../../middlewares/role.middleware");
const upload_middleware_1 = require("../../middlewares/upload.middleware");
// ===============================
// DOCUMENTS MODULE
// ===============================
const documentsModule = () => {
    const router = (0, express_1.Router)();
    // ===============================
    // UPLOAD DOCUMENT (AUTHENTICATED)
    // ===============================
    router.post('/:requestId/upload', auth_middleware_1.authMiddleware, upload_middleware_1.uploadMiddleware.array('files'), documents_controller_1.DocumentsController.upload);
    // ===============================
    // LIST MY DOCUMENTS (AUTHENTICATED)
    // ===============================
    router.get('/me', auth_middleware_1.authMiddleware, documents_controller_1.DocumentsController.listMyDocuments);
    // ===============================
    // GET DOCUMENT BY ID (AUTHENTICATED)
    // ===============================
    router.get('/:id', auth_middleware_1.authMiddleware, documents_controller_1.DocumentsController.getById);
    // ===============================
    // DOWNLOAD DOCUMENT (AUTHENTICATED)
    // ===============================
    router.get('/:id/download', auth_middleware_1.authMiddleware, documents_controller_1.DocumentsController.download);
    // ===============================
    // DELETE DOCUMENT (AUTHENTICATED)
    // ===============================
    router.delete('/:id', auth_middleware_1.authMiddleware, documents_controller_1.DocumentsController.delete);
    // ===============================
    // LIST ALL DOCUMENTS (ADMIN ONLY)
    // ===============================
    router.get('/', auth_middleware_1.authMiddleware, (0, role_middleware_1.requireRole)(['ADMIN']), documents_controller_1.DocumentsController.listAll);
    return router;
};
exports.documentsModule = documentsModule;
//# sourceMappingURL=documents.module.js.map