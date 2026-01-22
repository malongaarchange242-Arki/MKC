// utils/jwt.ts
import jwt from 'jsonwebtoken';
import { logger } from './logger';

// ===============================
// TYPES
// ===============================
export interface JWTPayload {
  sub: string; // user id
  email: string;
  role: 'CLIENT' | 'ADMIN' | 'SYSTEM';
  iat?: number;
  exp?: number;
}

// ===============================
// JWT UTILS
// ===============================
export class JWTUtils {
  private static readonly JWT_SECRET = process.env.JWT_SECRET;
  private static readonly JWT_EXPIRES_IN = '24h'; // 24 heures

  // ===============================
  // GENERATE TOKEN
  // ===============================
  static generateToken(payload: Omit<JWTPayload, 'iat' | 'exp'>): string {
    if (!this.JWT_SECRET) {
      logger.error('JWT_SECRET is not configured');
      throw new Error('JWT_SECRET is not configured');
    }

    const tokenPayload: JWTPayload = {
      sub: payload.sub,
      email: payload.email,
      role: payload.role
    };

    const token = jwt.sign(tokenPayload, this.JWT_SECRET, {
      expiresIn: this.JWT_EXPIRES_IN,
      issuer: 'feri-ad-backend',
      audience: 'feri-ad-client'
    });

    logger.info('JWT token generated', {
      userId: payload.sub,
      expiresIn: this.JWT_EXPIRES_IN
    });

    return token;
  }

  // ===============================
  // VERIFY TOKEN
  // ===============================
  static verifyToken(token: string): JWTPayload {
    if (!this.JWT_SECRET) {
      logger.error('JWT_SECRET is not configured');
      throw new Error('JWT_SECRET is not configured');
    }

    try {
      const decoded = jwt.verify(token, this.JWT_SECRET, {
        issuer: 'feri-ad-backend',
        audience: 'feri-ad-client'
      }) as JWTPayload;

      return decoded;
    } catch (error) {
      logger.warn('JWT token verification failed', { error });
      throw new Error('Invalid or expired token');
    }
  }

  // ===============================
  // DECODE TOKEN (without verification)
  // ===============================
  static decodeToken(token: string): JWTPayload | null {
    try {
      return jwt.decode(token) as JWTPayload;
    } catch (error) {
      logger.warn('JWT token decode failed', { error });
      return null;
    }
  }
}

