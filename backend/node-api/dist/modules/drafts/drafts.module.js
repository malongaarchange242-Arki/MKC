"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.draftsModule = void 0;
const express_1 = require("express");
const auth_middleware_1 = require("../../middlewares/auth.middleware");
const drafts_controller_1 = require("./drafts.controller");
const draftsModule = () => {
    const router = (0, express_1.Router)();
    // Auth required for downloads; ownership checked in controller
    router.get('/:id/download', auth_middleware_1.authMiddleware, drafts_controller_1.DraftsController.download);
    return router;
};
exports.draftsModule = draftsModule;
//# sourceMappingURL=drafts.module.js.map