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

    let data: any = null;
    try {
      const resp = await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true, // 🔥 pas de confirmation email
        user_metadata: {
          nom,
          prenom,
          role: 'CLIENT' // 🔒 FORCÉ
        }
      });
      data = resp.data;

      // supabase-js may return an object with `.error`
      if ((resp as any).error) {
        throw (resp as any).error;
      }
      if (!data?.user) {
        throw new Error('No user returned from supabase admin.createUser');
      }
    } catch (err: any) {
      // Capture richer error details for diagnosis
      const errMeta: any = {
        message: err?.message || 'Unknown error',
        name: err?.name,
        code: err?.code,
        status: err?.status || (err?.response?.status ?? null),
        response: err?.response?.data ?? err?.response ?? null
      };
      logger.error('Register failed (detailed)', { error: errMeta });

      const msg = (err?.message || '').toString();
      if (msg.toLowerCase().includes('already') || msg.toLowerCase().includes('email') || (errMeta.code && String(errMeta.code).toLowerCase().includes('email'))) {
        throw new Error('Email already registered');
      }

      throw new Error(err?.message || 'Registration failed');
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

    // The profiles table is the authoritative source for authorization roles.
    let role: 'CLIENT' | 'ADMIN' | 'SYSTEM' = 'CLIENT';
    try {
      const profile = await UsersService.getMe(data.user.id);
      if (['CLIENT', 'ADMIN', 'SYSTEM'].includes(profile.role)) {
        role = profile.role;
      }
      logger.info('Role from user profile', { userId: data.user.id, role });
    } catch (profileError) {
      const metadataRole = data.user.user_metadata?.role;
      if (['CLIENT', 'ADMIN', 'SYSTEM'].includes(metadataRole)) {
        role = metadataRole as AuthRole;
        logger.warn('Using auth metadata role because profile role lookup failed', {
          userId: data.user.id,
          profileError
        });
      } else {
        logger.warn('Role not found in profile or auth metadata; using default CLIENT', {
          userId: data.user.id,
          profileError
        });
      }
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
      role,
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
    // ===============================
    // CHANGE PASSWORD (ADMIN via service role)
    // ===============================
    static async changePassword(userId: string, newPassword: string) {
      if (!userId) throw new Error('userId is required');
      if (!newPassword || newPassword.length < 8) throw new Error('Password must be at least 8 characters');

      try {
        const resp = await supabase.auth.admin.updateUserById(userId, { password: newPassword });
        if ((resp as any).error) {
          throw (resp as any).error;
        }
        return resp.data;
      } catch (err: any) {
        const meta = { message: err?.message || String(err) };
        throw new Error('Failed to update password');
      }
    }

  }
