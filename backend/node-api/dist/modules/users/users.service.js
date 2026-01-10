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
            .maybeSingle();
        if (error) {
            logger_1.logger.error('Error fetching profile', { userId, error });
            if (error?.code === '42P17') {
                logger_1.logger.error('RLS recursion detected - check Supabase policies', { userId });
                throw new Error('Database policy error - please contact administrator');
            }
            throw new Error('Failed to fetch profile');
        }
        if (!data) {
            logger_1.logger.warn('Profile not found', { userId });
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
            .maybeSingle();
        if (error) {
            logger_1.logger.error('Error fetching user by id', { userId, error });
            throw new Error('User not found');
        }
        if (!data) {
            logger_1.logger.error('User not found', { userId });
            throw new Error('User not found');
        }
        return data;
    }
    // Ensure that a profile exists for a given auth user id.
    // This function is idempotent and uses upsert to avoid race conditions.
    static async ensureProfile(userId, opts) {
        logger_1.logger.info('Ensuring profile exists', { userId });
        // Check if profile already exists using maybeSingle() to avoid throwing on 0 rows
        const { data: existing, error: checkError } = await supabase_1.supabase
            .from('profiles')
            .select('id, email, nom, prenom, role, created_at')
            .eq('id', userId)
            .maybeSingle();
        if (checkError) {
            logger_1.logger.warn('Error checking existing profile', { userId, checkError });
        }
        if (existing) {
            return existing;
        }
        // Build payload from provided opts. Try to be compatible with different
        // database schemas: some installations use `id` as PK (matching auth.uid()),
        // others may use a `user_id` column. We'll try both strategies and log
        // detailed errors to help debug schema mismatches in production.
        const basePayload = {
            email: opts?.email || null,
            nom: opts?.nom ?? null,
            prenom: opts?.prenom ?? null,
            role: opts?.role || 'CLIENT'
        };
        // First attempt: upsert using `id` column (recommended schema).
        try {
            const payloadId = { id: userId, ...basePayload };
            const { data: created, error: insertError } = await supabase_1.supabase
                .from('profiles')
                .upsert(payloadId, { onConflict: 'id' })
                .select('id, email, nom, prenom, role, created_at')
                .maybeSingle();
            if (!insertError && created) {
                logger_1.logger.info('Profile ensured using `id` column', { userId });
                return created;
            }
            if (insertError) {
                logger_1.logger.warn('Upsert using `id` failed, will try `user_id` fallback', { userId, insertError });
            }
        }
        catch (e) {
            logger_1.logger.warn('Upsert with `id` raised unexpected error, will try fallback', { userId, error: e });
        }
        // Second attempt: some schemas use `user_id` column as an alternate PK.
        try {
            const payloadUserId = { user_id: userId, ...basePayload };
            // Try upsert on user_id first
            const { data: created2, error: insertError2 } = await supabase_1.supabase
                .from('profiles')
                .upsert(payloadUserId, { onConflict: 'user_id' })
                .select('user_id as id, email, nom, prenom, role, created_at')
                .maybeSingle();
            if (!insertError2 && created2) {
                logger_1.logger.info('Profile ensured using `user_id` column', { userId });
                const normalized = { id: created2.id || userId, email: created2.email, nom: created2.nom, prenom: created2.prenom, role: created2.role, created_at: created2.created_at };
                return normalized;
            }
            if (insertError2) {
                logger_1.logger.warn('Upsert using `user_id` failed', { userId, insertError2 });
                throw new Error('Failed to ensure profile using both id and user_id');
            }
        }
        catch (e) {
            logger_1.logger.error('ensureProfile fallback error', { userId, error: e });
            throw e;
        }
        throw new Error('Unable to ensure profile');
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