import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';
import { JWTUtils } from '../utils/jwt';

// AUTH MIDDLEWARE (STRICT)
// - Decode JWT (no Supabase call)
// - Set ONLY `req.authUserId` from JWT.sub
// - Remove any legacy `req.user` to discourage its usage
export const authMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      logger.warn('Missing or malformed Authorization header');
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }

    const token = authHeader.replace('Bearer ', '').trim();

    let payload;
    try {
      // Verify the token signature to ensure authenticity
      payload = JWTUtils.verifyToken(token);
    } catch (verifyErr) {
      logger.warn('JWT verify failed', { error: verifyErr instanceof Error ? verifyErr.message : verifyErr });
      res.status(401).json({ message: 'Invalid or expired token' });
      return;
    }

    if (!payload || !payload.sub) {
      logger.warn('JWT payload missing subject after verify');
      res.status(401).json({ message: 'Invalid token' });
      return;
    }

    // Canonical auth id (auth.users.id) exposed for handlers
    (req as any).authUserId = payload.sub;
    // Attach role from JWT payload as canonical role
    (req as any).authUserRole = payload.role ?? null;

    // Explicitly remove legacy `req.user` if present to avoid accidental use
    try {
      if ((req as any).user) delete (req as any).user;
    } catch (e) {
      // no-op
    }

    logger.debug('Auth middleware set authUserId and authUserRole', { authUserId: payload.sub, authUserRole: payload.role ?? null });

    next();
  } catch (error) {
    logger.error('Authentication middleware failed', { error });
    res.status(500).json({ message: 'Authentication error' });
  }
};
