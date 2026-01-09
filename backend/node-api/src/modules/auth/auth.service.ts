// modules/auth/auth.service.ts
import { supabase } from '../../config/supabase';
import { logger } from '../../utils/logger';
import { JWTUtils } from '../../utils/jwt';
import { UsersService } from '../users/users.service';

export type AuthRole = 'CLIENT' | 'ADMIN' | 'SYSTEM';

export interface RegisterInput {
  email: string;
  password: string;
  nom: string;
  prenom: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export class AuthService {
  // ===============================
  // REGISTER (CLIENT UNIQUEMENT)
  // ===============================
  static async register(input: RegisterInput) {
    const { email, password, nom, prenom } = input;

    logger.info('Registering new CLIENT user', { email });

    const { data, error } = await supabase.auth.admin.createUser({
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
      logger.error('Register failed', { error });
      const msg = error?.message || '';
      if (msg.toLowerCase().includes('already') || msg.toLowerCase().includes('email')) {
        // Do not treat as server error; inform client that email exists
        throw new Error('Email already registered');
      }
      throw new Error(error?.message || 'Registration failed');
    }

    // Ensure a profile row exists in `profiles` table. Use UsersService.ensureProfile
    // to perform an idempotent upsert. In production there may be a DB trigger that
    // creates the profile automatically; this code guarantees the profile exists
    // even if the trigger/migration is absent.
    try {
      await UsersService.ensureProfile(data.user.id, {
        email: data.user.email ?? email,
        nom: nom || data.user.user_metadata?.nom || null,
        prenom: prenom || data.user.user_metadata?.prenom || null,
        role: (data.user.user_metadata?.role as AuthRole) || 'CLIENT'
      });
      logger.info('Ensured profile after register', { userId: data.user.id });
    } catch (e) {
      logger.warn('Ensure profile exists failed', { error: e });
    }
    // ✅ profil créé automatiquement par trigger

    return {
      user: data.user
    };
  }

  // ===============================
  // LOGIN
  // ===============================
  static async login(input: LoginInput) {
    const { email, password } = input;

    logger.info('User login attempt', { email });

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (error || !data.session) {
      logger.warn('Login failed', { email, error });
      throw new Error('Invalid email or password');
    }

    // Ensure profile exists (in case DB trigger is missing). Use UsersService.ensureProfile
    // which performs an idempotent upsert and avoids race conditions.
    try {
      await UsersService.ensureProfile(data.user.id, {
        email: data.user.email ?? email,
        nom: data.user.user_metadata?.nom || null,
        prenom: data.user.user_metadata?.prenom || null,
        role: (data.user.user_metadata?.role as AuthRole) || 'CLIENT'
      });
    } catch (e) {
      logger.warn('Ensure profile on login failed', { error: e });
    }

    // Récupérer le rôle depuis user_metadata (évite la récursion RLS)
    // On évite d'appeler getProfile() qui peut déclencher une récursion infinie dans RLS
    let role: 'CLIENT' | 'ADMIN' | 'SYSTEM' = 'CLIENT';
    
    // Utiliser d'abord user_metadata (déjà disponible, pas besoin de requête DB)
    if (data.user.user_metadata?.role) {
      role = data.user.user_metadata.role as 'CLIENT' | 'ADMIN' | 'SYSTEM';
      logger.info('Role from user_metadata', { userId: data.user.id, role });
    } else {
      // Si pas dans metadata, utiliser CLIENT par défaut
      // Le rôle sera mis à jour lors de la prochaine connexion si le profil existe
      logger.warn('Role not found in user_metadata, using default CLIENT', { 
        userId: data.user.id 
      });
    }

    // Générer un token JWT personnalisé avec expiration de 24h
    const customToken = JWTUtils.generateToken({
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

    const profile = await UsersService.getMe(authUserId);
    return profile;
  }

}
