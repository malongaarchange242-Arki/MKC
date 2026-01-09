"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UsersController = void 0;
const zod_1 = require("zod");
const users_service_1 = require("./users.service");
const logger_1 = require("../../utils/logger");
// ===============================
// SCHEMAS
// ===============================
const updateProfileSchema = zod_1.z.object({
    nom: zod_1.z.string().min(2).optional(),
    prenom: zod_1.z.string().min(2).optional()
});
const updateRoleSchema = zod_1.z.object({
    role: zod_1.z.enum(['CLIENT', 'ADMIN', 'SYSTEM'])
});
// ===============================
// HELPER ERROR HANDLER
// ===============================
const handleControllerError = (res, error, context = '') => {
    logger_1.logger.error(`${context} failed`, { error });
    if (error instanceof zod_1.ZodError) {
        return res.status(422).json({
            message: 'Invalid payload',
            errors: error.flatten().fieldErrors
        });
    }
    if (error instanceof Error) {
        return res.status(400).json({
            message: error.message
        });
    }
    return res.status(500).json({
        message: 'Unexpected error'
    });
};
// ===============================
// CONTROLLER
// ===============================
class UsersController {
    // ===============================
    // GET MY PROFILE
    // ===============================
    static async getMe(req, res) {
        try {
            if (!req.user) {
                return res.status(401).json({ message: 'Unauthorized' });
            }
            const profile = await users_service_1.UsersService.getMe(req.user.id);
            return res.status(200).json({
                success: true,
                profile
            });
        }
        catch (error) {
            return handleControllerError(res, error, 'Get profile');
        }
    }
    // ===============================
    // UPDATE MY PROFILE
    // ===============================
    static async updateMe(req, res) {
        try {
            if (!req.user) {
                return res.status(401).json({ message: 'Unauthorized' });
            }
            const body = updateProfileSchema.parse(req.body);
            const profile = await users_service_1.UsersService.updateMe(req.user.id, body);
            return res.status(200).json({
                success: true,
                profile
            });
        }
        catch (error) {
            return handleControllerError(res, error, 'Update profile');
        }
    }
    // ===============================
    // GET USER BY ID (ADMIN ONLY)
    // ===============================
    static async getUserById(req, res) {
        try {
            if (!req.user) {
                return res.status(401).json({ message: 'Unauthorized' });
            }
            const userId = req.params.id;
            const profile = await users_service_1.UsersService.getUserById(userId);
            return res.status(200).json({
                success: true,
                profile
            });
        }
        catch (error) {
            return handleControllerError(res, error, 'Get user by ID');
        }
    }
    // ===============================
    // LIST ALL USERS (ADMIN ONLY)
    // ===============================
    static async listUsers(req, res) {
        try {
            if (!req.user) {
                return res.status(401).json({ message: 'Unauthorized' });
            }
            const limit = Number(req.query.limit) || 50;
            const offset = Number(req.query.offset) || 0;
            const users = await users_service_1.UsersService.listUsers(limit, offset);
            return res.status(200).json({
                success: true,
                users,
                count: users.length
            });
        }
        catch (error) {
            return handleControllerError(res, error, 'List users');
        }
    }
    // ===============================
    // UPDATE USER ROLE (ADMIN ONLY)
    // ===============================
    static async updateUserRole(req, res) {
        try {
            if (!req.user) {
                return res.status(401).json({ message: 'Unauthorized' });
            }
            const userId = req.params.id;
            const body = updateRoleSchema.parse(req.body);
            const profile = await users_service_1.UsersService.updateUserRole(userId, body.role);
            return res.status(200).json({
                success: true,
                profile
            });
        }
        catch (error) {
            return handleControllerError(res, error, 'Update user role');
        }
    }
}
exports.UsersController = UsersController;
//# sourceMappingURL=users.controller.js.map