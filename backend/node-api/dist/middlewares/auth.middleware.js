"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.authMiddleware = void 0;
const supabase_1 = require("../config/supabase");
const logger_1 = require("../utils/logger");
const jwt_1 = require("../utils/jwt");
// ===============================
// AUTH MIDDLEWARE
// ===============================
const authMiddleware = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            logger_1.logger.warn('Missing or malformed Authorization header');
            res.status(401).json({ message: 'Unauthorized' });
            return;
        }
        const token = authHeader.replace('Bearer ', '').trim();
        // ===============================
        // VERIFY TOKEN (JWT personnalisé ou Supabase)
        // ===============================
        try {
            // Essayer d'abord avec notre JWT personnalisé (24h)
            const jwtPayload = jwt_1.JWTUtils.verifyToken(token);
            // Token JWT personnalisé valide
            req.user = {
                id: jwtPayload.sub,
                email: jwtPayload.email,
                role: jwtPayload.role
            };
        }
        catch (jwtError) {
            // Si le token JWT personnalisé échoue, essayer avec Supabase
            try {
                const { data: { user }, error } = await supabase_1.supabase.auth.getUser(token);
                if (error || !user) {
                    logger_1.logger.warn('Invalid token (both JWT and Supabase failed)', {
                        jwtError: jwtError instanceof Error ? jwtError.message : jwtError,
                        supabaseError: error
                    });
                    res.status(401).json({ message: 'Invalid token' });
                    return;
                }
                // Token Supabase valide
                const role = user.user_metadata?.role === 'ADMIN' ? 'ADMIN' : 'CLIENT';
                req.user = {
                    id: user.id,
                    email: user.email ?? '',
                    role
                };
            }
            catch (supabaseError) {
                logger_1.logger.warn('Token verification failed', {
                    jwtError: jwtError instanceof Error ? jwtError.message : jwtError,
                    supabaseError: supabaseError instanceof Error ? supabaseError.message : supabaseError
                });
                res.status(401).json({ message: 'Invalid token' });
                return;
            }
        }
        next();
    }
    catch (error) {
        logger_1.logger.error('Authentication middleware failed', { error });
        res.status(500).json({ message: 'Authentication error' });
    }
};
exports.authMiddleware = authMiddleware;
//# sourceMappingURL=auth.middleware.js.map