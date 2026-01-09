"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.JWTUtils = void 0;
// utils/jwt.ts
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const logger_1 = require("./logger");
// ===============================
// JWT UTILS
// ===============================
class JWTUtils {
    static JWT_SECRET = process.env.JWT_SECRET;
    static JWT_EXPIRES_IN = '24h'; // 24 heures
    // ===============================
    // GENERATE TOKEN
    // ===============================
    static generateToken(payload) {
        if (!this.JWT_SECRET) {
            logger_1.logger.error('JWT_SECRET is not configured');
            throw new Error('JWT_SECRET is not configured');
        }
        const tokenPayload = {
            sub: payload.sub,
            email: payload.email,
            role: payload.role
        };
        const token = jsonwebtoken_1.default.sign(tokenPayload, this.JWT_SECRET, {
            expiresIn: this.JWT_EXPIRES_IN,
            issuer: 'feri-ad-backend',
            audience: 'feri-ad-client'
        });
        logger_1.logger.info('JWT token generated', {
            userId: payload.sub,
            expiresIn: this.JWT_EXPIRES_IN
        });
        return token;
    }
    // ===============================
    // VERIFY TOKEN
    // ===============================
    static verifyToken(token) {
        if (!this.JWT_SECRET) {
            logger_1.logger.error('JWT_SECRET is not configured');
            throw new Error('JWT_SECRET is not configured');
        }
        try {
            const decoded = jsonwebtoken_1.default.verify(token, this.JWT_SECRET, {
                issuer: 'feri-ad-backend',
                audience: 'feri-ad-client'
            });
            return decoded;
        }
        catch (error) {
            logger_1.logger.warn('JWT token verification failed', { error });
            throw new Error('Invalid or expired token');
        }
    }
    // ===============================
    // DECODE TOKEN (without verification)
    // ===============================
    static decodeToken(token) {
        try {
            return jsonwebtoken_1.default.decode(token);
        }
        catch (error) {
            logger_1.logger.warn('JWT token decode failed', { error });
            return null;
        }
    }
}
exports.JWTUtils = JWTUtils;
//# sourceMappingURL=jwt.js.map