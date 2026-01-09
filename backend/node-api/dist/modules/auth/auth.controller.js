"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthController = void 0;
const zod_1 = require("zod");
const auth_service_1 = require("./auth.service");
const request_user_1 = require("../../utils/request-user");
const logger_1 = require("../../utils/logger");
// ===============================
// SCHEMAS (ZOD)
// ===============================
const registerSchema = zod_1.z.object({
    email: zod_1.z.string().email(),
    password: zod_1.z.string().min(8),
    nom: zod_1.z.string().min(2),
    prenom: zod_1.z.string().min(2),
    role: zod_1.z.enum(['CLIENT', 'ADMIN', 'SYSTEM']).optional()
});
const loginSchema = zod_1.z.object({
    email: zod_1.z.string().email(),
    password: zod_1.z.string().min(8)
});
// ===============================
// HELPER ERROR HANDLER
// ===============================
const handleControllerError = (res, error, context = '') => {
    // Normalize error logging so the message and stack are visible in logs
    if (error instanceof zod_1.ZodError) {
        logger_1.logger.error(`${context} failed`, { message: 'Validation error', details: error.format() });
        return res.status(422).json({
            success: false,
            message: 'Invalid payload',
            errors: error.format()
        });
    }
    if (error instanceof Error) {
        logger_1.logger.error(`${context} failed`, { message: error.message, stack: error.stack });
        // Map common business errors to more appropriate status codes
        const msg = error.message || '';
        if (msg.toLowerCase().includes('already') || msg.toLowerCase().includes('exists') || msg.toLowerCase().includes('email')) {
            return res.status(409).json({ success: false, message: msg });
        }
        return res.status(400).json({
            success: false,
            message: msg
        });
    }
    logger_1.logger.error(`${context} failed`, { error });
    return res.status(500).json({
        success: false,
        message: 'Unexpected error'
    });
};
// ===============================
// CONTROLLER
// ===============================
class AuthController {
    // ===============================
    // REGISTER
    // ===============================
    static async register(req, res) {
        try {
            const body = registerSchema.parse(req.body);
            const result = await auth_service_1.AuthService.register(body);
            return res.status(201).json({
                success: true,
                user: result.user
            });
        }
        catch (error) {
            return handleControllerError(res, error, 'Register');
        }
    }
    // ===============================
    // LOGIN
    // ===============================
    static async login(req, res) {
        try {
            const body = loginSchema.parse(req.body);
            const result = await auth_service_1.AuthService.login(body);
            return res.status(200).json({
                success: true,
                user: result.user,
                session: result.session
            });
        }
        catch (error) {
            return handleControllerError(res, error, 'Login');
        }
    }
    // ===============================
    // LOGOUT
    // ===============================
    static async logout(req, res) {
        try {
            // Le logout côté client consiste simplement à supprimer le token
            // Ici on peut ajouter une logique de blacklist si nécessaire
            return res.status(200).json({
                success: true,
                message: 'Logged out successfully'
            });
        }
        catch (error) {
            return handleControllerError(res, error, 'Logout');
        }
    }
    // ===============================
    // GET PROFILE
    // ===============================
    // ===============================
    // GET PROFILE (ME)
    // ===============================
    static async profile(req, res) {
        try {
            const authUserId = (0, request_user_1.getAuthUserId)(req);
            if (!authUserId) {
                return res.status(401).json({
                    success: false,
                    message: 'Unauthorized'
                });
            }
            logger_1.logger.info('Controller get profile', { userId: authUserId });
            const profile = await auth_service_1.AuthService.getProfile(authUserId);
            return res.status(200).json({
                success: true,
                profile
            });
        }
        catch (error) {
            return handleControllerError(res, error, 'Get profile');
        }
    }
}
exports.AuthController = AuthController;
//# sourceMappingURL=auth.controller.js.map