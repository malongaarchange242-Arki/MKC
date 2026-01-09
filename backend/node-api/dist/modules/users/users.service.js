"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UsersService = void 0;
// modules/users/users.service.ts
const supabase_1 = require("../../config/supabase");
const logger_1 = require("../../utils/logger");
// ===============================
// USERS SERVICE
// ===============================
class UsersService {
    // ===============================
    // GET MY PROFILE
    // ===============================
    static async getMe(userId) {
        logger_1.logger.info('Fetching user profile', { userId });
        // Utiliser le service role (contourne RLS) pour éviter la récursion infinie
        // Le client supabase est déjà configuré avec SERVICE_ROLE_KEY
        const { data, error } = await supabase_1.supabase
            .from('profiles')
            .select('id, email, nom, prenom, role, created_at')
            .eq('id', userId)
            .single();
        if (error || !data) {
            logger_1.logger.error('Profile not found', { userId, error });
            // Si erreur de récursion RLS, donner plus d'infos
            if (error?.code === '42P17') {
                logger_1.logger.error('RLS recursion detected - check Supabase policies', { userId });
                throw new Error('Database policy error - please contact administrator');
            }
            throw new Error('Profile not found');
        }
        return data;
    }
    // ===============================
    // UPDATE MY PROFILE
    // ===============================
    static async updateMe(userId, input) {
        logger_1.logger.info('Updating user profile', { userId, input });
        // Vérifier d'abord si le profil existe
        let existingProfile = null;
        try {
            existingProfile = await this.getMe(userId);
        }
        catch (error) {
            logger_1.logger.warn('Profile does not exist, will create it', { userId });
        }
        // Si le profil n'existe pas, le créer d'abord
        if (!existingProfile) {
            // Récupérer les infos de l'utilisateur depuis auth.users
            const { data: authUser, error: authError } = await supabase_1.supabase.auth.admin.getUserById(userId);
            if (authError || !authUser.user) {
                logger_1.logger.error('Cannot fetch user from auth', { userId, authError });
                throw new Error('User not found in authentication system');
            }
            // Créer le profil avec les données disponibles
            const newProfileData = {
                id: userId,
                email: authUser.user.email ?? '',
                nom: input.nom || authUser.user.user_metadata?.nom || null,
                prenom: input.prenom || authUser.user.user_metadata?.prenom || null,
                role: authUser.user.user_metadata?.role || 'CLIENT'
            };
            const { data: createdProfile, error: createError } = await supabase_1.supabase
                .from('profiles')
                .insert(newProfileData)
                .select('id, email, nom, prenom, role, created_at')
                .single();
            if (createError || !createdProfile) {
                logger_1.logger.error('Failed to create profile', { userId, createError });
                throw new Error('Failed to create profile');
            }
            logger_1.logger.info('Profile created successfully', { userId });
            return createdProfile;
        }
        // Le profil existe, effectuer la mise à jour
        const updateData = {};
        if (input.nom !== undefined)
            updateData.nom = input.nom;
        if (input.prenom !== undefined)
            updateData.prenom = input.prenom;
        // Si aucun champ à mettre à jour, retourner le profil existant
        if (Object.keys(updateData).length === 0) {
            return existingProfile;
        }
        // Effectuer la mise à jour
        const { data, error } = await supabase_1.supabase
            .from('profiles')
            .update(updateData)
            .eq('id', userId)
            .select('id, email, nom, prenom, role, created_at')
            .single();
        if (error) {
            logger_1.logger.error('Profile update failed', { userId, error });
            // Si aucune ligne affectée, le profil n'existe peut-être pas
            if (error.code === 'PGRST116' || error.message?.includes('0 rows')) {
                throw new Error('Profile not found or cannot be updated');
            }
            throw new Error('Profile update failed');
        }
        if (!data) {
            logger_1.logger.error('Profile update returned no data', { userId });
            throw new Error('Profile update failed - no data returned');
        }
        return data;
    }
    // ===============================
    // GET USER BY ID (ADMIN ONLY)
    // ===============================
    static async getUserById(userId) {
        logger_1.logger.info('Fetching user by ID', { userId });
        const { data, error } = await supabase_1.supabase
            .from('profiles')
            .select('id, email, nom, prenom, role, created_at')
            .eq('id', userId)
            .single();
        if (error || !data) {
            logger_1.logger.error('User not found', { userId, error });
            throw new Error('User not found');
        }
        return data;
    }
    // ===============================
    // LIST ALL USERS (ADMIN ONLY)
    // ===============================
    static async listUsers(limit = 50, offset = 0) {
        logger_1.logger.info('Listing users', { limit, offset });
        const { data, error } = await supabase_1.supabase
            .from('profiles')
            .select('id, email, nom, prenom, role, created_at')
            .order('created_at', { ascending: false })
            .range(offset, offset + limit - 1);
        if (error) {
            logger_1.logger.error('Failed to list users', { error });
            throw new Error('Failed to list users');
        }
        return (data || []);
    }
    // ===============================
    // UPDATE USER ROLE (ADMIN ONLY)
    // ===============================
    static async updateUserRole(userId, role) {
        logger_1.logger.info('Updating user role', { userId, role });
        const { data, error } = await supabase_1.supabase
            .from('profiles')
            .update({ role })
            .eq('id', userId)
            .select('id, email, nom, prenom, role, created_at')
            .single();
        if (error || !data) {
            logger_1.logger.error('Role update failed', { userId, error });
            throw new Error('Role update failed');
        }
        // Mettre à jour aussi les metadata Supabase Auth
        await supabase_1.supabase.auth.admin.updateUserById(userId, {
            user_metadata: {
                role
            }
        });
        return data;
    }
}
exports.UsersService = UsersService;
//# sourceMappingURL=users.service.js.map