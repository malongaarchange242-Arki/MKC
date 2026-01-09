"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.authModule = void 0;
// modules/auth/auth.module.ts
const express_1 = require("express");
const auth_controller_1 = require("./auth.controller");
const auth_middleware_1 = require("../../middlewares/auth.middleware");
// ===============================
// Helper pour gérer les erreurs async
// ===============================
const asyncHandler = (fn) => (req, res, next) => {
    Promise.resolve(fn(req, res)).catch(next);
};
// ===============================
// AUTH MODULE
// ===============================
const authModule = () => {
    const router = (0, express_1.Router)();
    // ===============================
    // PUBLIC ROUTES
    // ===============================
    router.post('/register', asyncHandler(auth_controller_1.AuthController.register));
    router.post('/login', asyncHandler(auth_controller_1.AuthController.login));
    // ===============================
    // PROTECTED ROUTES
    // ===============================
    router.post('/logout', auth_middleware_1.authMiddleware, asyncHandler(auth_controller_1.AuthController.logout));
    router.get('/me', auth_middleware_1.authMiddleware, asyncHandler(auth_controller_1.AuthController.profile));
    return router;
};
exports.authModule = authModule;
//# sourceMappingURL=auth.module.js.map