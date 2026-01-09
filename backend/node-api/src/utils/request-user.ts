import { Request } from 'express';
import { logger } from './logger';

// Central helper to extract the authenticated user's id from the request.
// Production requirement: always use the auth.users.id (JWT.sub) as the source
// of truth. The authentication middleware sets `req.authUserId` and
// `req.authUserRole` based on the verified token. This module exposes
// small helpers to consistently read those values across the codebase.

export function getAuthUserId(req: Request): string | null {
  const anyReq = req as any;
  if (anyReq.authUserId) return anyReq.authUserId;
  // Backwards-compat: fall back to req.user?.id if middleware still sets it
  if (anyReq.user && anyReq.user.id) {
    logger.warn('Using fallback req.user.id; prefer req.authUserId (JWT.sub)');
    return anyReq.user.id;
  }
  return null;
}

export function requireAuthUserId(req: Request): string {
  const id = getAuthUserId(req);
  if (!id) throw new Error('Unauthorized');
  return id;
}

export function getAuthUserRole(req: Request): string | null {
  const anyReq = req as any;
  if (anyReq.authUserRole) return anyReq.authUserRole;
  if (anyReq.user && anyReq.user.role) return anyReq.user.role;
  return null;
}

export function requireAuthUserRole(req: Request): string {
  const r = getAuthUserRole(req);
  if (!r) throw new Error('Unauthorized');
  return r;
}
