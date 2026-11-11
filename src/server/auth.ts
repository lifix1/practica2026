import bcrypt from 'bcryptjs';
import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { db } from '../db/index.ts';
import { refreshTokens, users } from '../db/schema.ts';
import { and, eq, lt } from 'drizzle-orm';

const JWT_SECRET = process.env.JWT_SECRET || 'university-inventory-system-secret-key-2026';
const ACCESS_TOKEN_EXPIRY = 120 * 60; // 120 minutes in seconds (as specified in PDF)
const REFRESH_TOKEN_EXPIRY_DAYS = 10; // 10 days (as specified in PDF)

export interface AuthenticatedUser {
  id: number;
  login: string;
  role: 'ADMIN' | 'ENGINEER' | 'USER';
}

export interface AuthRequest extends Request {
  user?: AuthenticatedUser;
}

export function generateAccessToken(user: AuthenticatedUser): string {
  return jwt.sign(
    { id: user.id, login: user.login, role: user.role },
    JWT_SECRET,
    { expiresIn: '120m' }
  );
}

export function generateRefreshToken(user: AuthenticatedUser): string {
  return jwt.sign(
    { id: user.id, login: user.login, role: user.role, type: 'refresh' },
    JWT_SECRET,
    { expiresIn: '10d' }
  );
}

export function setAuthCookies(res: Response, accessToken: string, refreshToken?: string) {
  // In cloud iframe / preview environments, cookies require SameSite=None and Secure=true.
  // On local development (http://localhost), browsers reject SameSite=None without Secure, and reject Secure over plain HTTP.
  const isHttps = !!process.env.APP_URL?.startsWith('https') || process.env.NODE_ENV === 'production';
  const sameSite = isHttps ? 'none' : 'lax';

  res.cookie('access_token', accessToken, {
    httpOnly: true,
    maxAge: ACCESS_TOKEN_EXPIRY * 1000,
    sameSite: sameSite as 'none' | 'lax',
    path: '/',
    secure: isHttps,
  });

  if (refreshToken) {
    res.cookie('refresh_token', refreshToken, {
      httpOnly: true,
      maxAge: REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
      sameSite: sameSite as 'none' | 'lax',
      path: '/',
      secure: isHttps,
    });
  }
}

export function clearAuthCookies(res: Response) {
  const isHttps = !!process.env.APP_URL?.startsWith('https') || process.env.NODE_ENV === 'production';
  const sameSite = isHttps ? 'none' : 'lax';
  res.clearCookie('access_token', { path: '/', sameSite: sameSite as 'none' | 'lax', secure: isHttps });
  res.clearCookie('refresh_token', { path: '/', sameSite: sameSite as 'none' | 'lax', secure: isHttps });
}

function extractToken(req: Request): string | null {
  if (req.cookies?.access_token) {
    return req.cookies.access_token;
  }
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const raw = authHeader.slice(7).trim();
    if (raw && raw !== 'null' && raw !== 'undefined') {
      return raw;
    }
  }
  if (typeof req.query?.token === 'string' && req.query.token.trim()) {
    return req.query.token.trim();
  }
  return null;
}

export const requireAuth = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  const token = extractToken(req);

  if (!token) {
    return res.status(401).json({ error: 'Необходима авторизация' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as AuthenticatedUser;
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Сессия истекла или токен недействителен' });
  }
};

export const optionalAuth = async (
  req: AuthRequest,
  _res: Response,
  next: NextFunction
) => {
  const token = extractToken(req);

  if (token) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET) as AuthenticatedUser;
      req.user = decoded;
    } catch {
      // Ignore invalid token in optionalAuth
    }
  }
  next();
};

export const requireRole = (...allowedRoles: Array<'ADMIN' | 'ENGINEER' | 'USER'>) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Необходима авторизация' });
    }
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Недостаточно прав для выполнения действия' });
    }
    next();
  };
};

export async function cleanupExpiredTokens() {
  try {
    await db.delete(refreshTokens).where(lt(refreshTokens.valid_until, new Date()));
  } catch (e) {
    console.error('Error cleaning up expired refresh tokens:', e);
  }
}
