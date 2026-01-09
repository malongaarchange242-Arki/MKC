"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthService = void 0;
// modules/auth/auth.service.ts
const supabase_1 = require("../../config/supabase");
const logger_1 = require("../../utils/logger");
const jwt_1 = require("../../utils/jwt");
class AuthService {
    // ===============================
    // REGISTER (CLIENT UNIQUEMENT)
    // ===============================
    static async register(input) {
        const { email, password, nom, prenom } = input;
        logger_1.logger.info('Registering new CLIENT user', { email });
        const { data, error } = await supabase_1.supabase.auth.admin.createUser({
            email,
            password,
            email_confirm: true, // 🔥 pas de confirmation email
            user_metadata: {
                nom,
                prenom,
                role: 'CLIENT' // 🔒 FORCÉ
            }
        });
        if (error || !data.user) {
            logger_1.logger.error('Register failed', { error });
            throw new Error(error?.message || 'Registration failed');
        }
        // ✅ profil créé automatiquement par trigger
        return {
            user: data.user
        };
    }
    // ===============================
    // LOGIN
    // ===============================
    static async login(input) {
        const { email, password } = input;
        logger_1.logger.info('User login attempt', { email });
        const { data, error } = await supabase_1.supabase.auth.signInWithPassword({
            email,
            password
        });
        if (error || !data.session) {
            logger_1.logger.warn('Login failed', { email, error });
            throw new Error('Invalid email or password');
        }
        // Récupérer le rôle depuis user_metadata (évite la récursion RLS)
        // On évite d'appeler getProfile() qui peut déclencher une récursion infinie dans RLS
        let role = 'CLIENT';
        // Utiliser d'abord user_metadata (déjà disponible, pas besoin de requête DB)
        if (data.user.user_metadata?.role) {
            role = data.user.user_metadata.role;
            logger_1.logger.info('Role from user_metadata', { userId: data.user.id, role });
        }
        else {
            // Si pas dans metadata, utiliser CLIENT par défaut
            // Le rôle sera mis à jour lors de la prochaine connexion si le profil existe
            logger_1.logger.warn('Role not found in user_metadata, using default CLIENT', {
                userId: data.user.id
            });
        }
        // Générer un token JWT personnalisé avec expiration de 24h
        const customToken = jwt_1.JWTUtils.generateToken({
            sub: data.user.id,
            email: data.user.email ?? email,
            role
        });
        // Créer une session personnalisée avec le token de 24h
        const customSession = {
            access_token: customToken,
            refresh_token: data.session.refresh_token,
            expires_in: 86400, // 24 heures en secondes
            expires_at: Math.floor(Date.now() / 1000) + 86400,
            token_type: 'bearer',
            user: data.user
        };
        return {
            user: data.user,
            session: customSession
        };
    }
    // ===============================
    // GET PROFILE (ME)
    // ===============================
    static async getProfile(authUserId: string) {
    if (!authUserId) {
        throw new Error('authUserId is required');
    }

    logger.info('Fetching user profile', { userId: authUserId });

    const { data, error } = await supabase_1.supabase
        .from('profiles')
        .select('id, email, nom, prenom, role, created_at')
        .eq('id', authUserId)
        .maybeSingle();

    if (error) throw error;
    if (!data) {
        throw new Error('Profile not found');
    }

    return data;
    }

}
exports.AuthService = AuthService;
//# sourceMappingURL=auth.service.js.map