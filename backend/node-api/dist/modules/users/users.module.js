"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.usersModule = void 0;
// modules/users/users.module.ts
const express_1 = require("express");
const users_controller_1 = require("./users.controller");
const auth_middleware_1 = require("../../middlewares/auth.middleware");
const role_middleware_1 = require("../../middlewares/role.middleware");
// ===============================
// USERS MODULE
// ===============================
const usersModule = () => {
    const router = (0, express_1.Router)();
    // ===============================
    // MY PROFILE (AUTHENTICATED)
    // ===============================
    router.get('/me', auth_middleware_1.authMiddleware, users_controller_1.UsersController.getMe);
    router.patch('/me', auth_middleware_1.authMiddleware, users_controller_1.UsersController.updateMe);
    // ===============================
    // ADMIN ROUTES
    // ===============================
    router.get('/', auth_middleware_1.authMiddleware, (0, role_middleware_1.requireRole)(['ADMIN']), users_controller_1.UsersController.listUsers);
    router.get('/:id', auth_middleware_1.authMiddleware, (0, role_middleware_1.requireRole)(['ADMIN']), users_controller_1.UsersController.getUserById);
    router.patch('/:id/role', auth_middleware_1.authMiddleware, (0, role_middleware_1.requireRole)(['ADMIN']), users_controller_1.UsersController.updateUserRole);
    return router;
};
exports.usersModule = usersModule;
//# sourceMappingURL=users.module.js.map