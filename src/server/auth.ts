import type { NextFunction, Request, Response } from 'express';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { db } from '../db/index.ts';
import { refreshTokens, users } from '../db/schema.ts';
import { eq, lt } from 'drizzle-orm';

const EPHEMERAL_FALLBACK_SECRET = crypto.randomBytes(64).toString('hex');

function getJwtSecret(): string {
  const envSecret = process.env.JWT_SECRET?.trim();
  if (envSecret && envSecret.length >= 16) {
    return envSecret;
  }
  return EPHEMERAL_FALLBACK_SECRET;
}

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.trim().length < 32) {
  console.warn(
    '[SECURITY] JWT_SECRET is missing or shorter than 32 characters. Using secure cryptographic runtime fallback; set JWT_SECRET (>=32 chars) in environment variables for persistent sessions across restarts.'
  );
}

const ACCESS_TOKEN_EXPIRY = 60 * 60; // 60 minutes in seconds
const REFRESH_TOKEN_EXPIRY_DAYS = 10; // 10 days

export interface AuthenticatedUser {
  id: number;
  login: string;
  role: 'ADMIN' | 'ENGINEER' | 'USER';
}

interface JwtTokenPayload extends AuthenticatedUser {
  tokenType: 'access' | 'refresh';
  jti?: string;
}

export interface AuthRequest extends Request {
  user?: AuthenticatedUser;
}

export function generateAccessToken(user: AuthenticatedUser): string {
  return jwt.sign(
    {
      id: user.id,
      login: user.login,
      role: user.role,
      tokenType: 'access',
    },
    getJwtSecret(),
    { algorithm: 'HS256', expiresIn: `${ACCESS_TOKEN_EXPIRY}s` }
  );
}

export function generateRefreshToken(user: AuthenticatedUser): string {
  return jwt.sign(
    {
      id: user.id,
      login: user.login,
      role: user.role,
      tokenType: 'refresh',
      jti: crypto.randomUUID(),
    },
    getJwtSecret(),
    { algorithm: 'HS256', expiresIn: `${REFRESH_TOKEN_EXPIRY_DAYS}d` }
  );
}

export function verifyRefreshJwt(token: string): JwtTokenPayload | null {
  try {
    const decoded = jwt.verify(token, getJwtSecret(), {
      algorithms: ['HS256'],
    }) as JwtTokenPayload;
    if (!decoded || decoded.tokenType !== 'refresh' || !decoded.id) {
      return null;
    }
    return decoded;
  } catch {
    return null;
  }
}

export function hashTokenForStorage(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function isRequestHttps(req?: Request): boolean {
  if (req) {
    if (req.secure || req.protocol === 'https') return true;
    const xfProto = req.get('x-forwarded-proto');
    if (xfProto) {
      return xfProto.split(',')[0].trim().toLowerCase() === 'https';
    }
    return false;
  }
  return (
    !!process.env.APP_URL?.startsWith('https') ||
    process.env.NODE_ENV === 'production'
  );
}

export function setAuthCookies(
  res: Response,
  accessToken: string,
  refreshToken?: string,
  req?: Request
) {
  const isHttps = isRequestHttps(req);
  const sameSite: 'none' | 'lax' = isHttps ? 'none' : 'lax';

  res.cookie('access_token', accessToken, {
    httpOnly: true,
    maxAge: ACCESS_TOKEN_EXPIRY * 1000,
    sameSite,
    path: '/',
    secure: isHttps,
  });

  if (refreshToken) {
    res.cookie('refresh_token', refreshToken, {
      httpOnly: true,
      maxAge: REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
      sameSite,
      path: '/',
      secure: isHttps,
    });
  }
}

export function clearAuthCookies(res: Response, req?: Request) {
  const isHttps = isRequestHttps(req);
  const sameSite: 'none' | 'lax' = isHttps ? 'none' : 'lax';
  res.clearCookie('access_token', { path: '/', sameSite, secure: isHttps });
  res.clearCookie('refresh_token', { path: '/', sameSite, secure: isHttps });
}

function extractAccessToken(req: Request): string | null {
  // Prefer Authorization header over cookie when explicitly passed by client, fallback to HttpOnly cookie
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const raw = authHeader.slice(7).trim();
    if (raw && raw !== 'null' && raw !== 'undefined') {
      return raw;
    }
  }
  if (req.cookies?.access_token) {
    return req.cookies.access_token;
  }
  return null;
}

async function resolveVerifiedUserFromToken(
  token: string
): Promise<AuthenticatedUser | null> {
  const decoded = jwt.verify(token, getJwtSecret(), {
    algorithms: ['HS256'],
  }) as JwtTokenPayload;

  if (!decoded || !decoded.id || decoded.tokenType === 'refresh') {
    return null;
  }

  // Always verify user still exists in DB and fetch authoritative role
  const [dbUser] = await db
    .select({
      id: users.id,
      login: users.login,
      role: users.role,
    })
    .from(users)
    .where(eq(users.id, Number(decoded.id)))
    .limit(1);

  if (!dbUser) {
    return null;
  }

  return {
    id: dbUser.id,
    login: dbUser.login,
    role: dbUser.role as 'ADMIN' | 'ENGINEER' | 'USER',
  };
}

export const requireAuth = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  const token = extractAccessToken(req);

  if (!token) {
    return res.status(401).json({ error: 'Необходима авторизация' });
  }

  try {
    const verifiedUser = await resolveVerifiedUserFromToken(token);
    if (!verifiedUser) {
      return res.status(401).json({ error: 'Сессия недействительна. Выполните вход повторно.' });
    }
    req.user = verifiedUser;
    next();
  } catch {
    return res.status(401).json({ error: 'Сессия истекла или токен недействителен' });
  }
};

export const optionalAuth = async (
  req: AuthRequest,
  _res: Response,
  next: NextFunction
) => {
  const token = extractAccessToken(req);

  if (token) {
    try {
      const verifiedUser = await resolveVerifiedUserFromToken(token);
      if (verifiedUser) {
        req.user = verifiedUser;
      }
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

const WEAK_PASSWORDS = new Set([
  '123456',
  '1234567',
  '12345678',
  '123456789',
  '1234567890',
  'password',
  'qwerty',
  'qwerty123',
  'admin123',
  'engineer123',
  'user123',
  'admin',
  '11111111',
]);

export function validateLoginFormat(login: string): string | null {
  const trimmed = login.trim();
  if (trimmed.length < 3 || trimmed.length > 64) {
    return 'Логин должен содержать от 3 до 64 символов';
  }
  if (!/^[a-zA-Z0-9._-]+$/.test(trimmed)) {
    return 'Логин может содержать только латинские буквы, цифры, точку, дефис и подчёркивание';
  }
  return null;
}

export function validatePasswordStrength(
  password: string,
  login?: string
): string | null {
  if (!password || password.length < 8) {
    return 'Пароль должен содержать не менее 8 символов';
  }
  if (password.length > 128) {
    return 'Пароль слишком длинный (максимум 128 символов)';
  }
  if (!/[a-zA-Zа-яА-ЯёЁ]/.test(password) || !/[0-9]/.test(password)) {
    return 'Пароль должен содержать как минимум одну букву и одну цифру';
  }
  const lower = password.toLowerCase();
  if (WEAK_PASSWORDS.has(lower)) {
    return 'Этот пароль слишком простой и входит в список запрещённых. Выберите более надёжный пароль.';
  }
  if (login && lower === login.trim().toLowerCase()) {
    return 'Пароль не должен совпадать с логином';
  }
  return null;
}

export async function cleanupExpiredTokens() {
  try {
    await db.delete(refreshTokens).where(lt(refreshTokens.valid_until, new Date()));
  } catch (e) {
    console.error('Error cleaning up expired refresh tokens:', e);
  }
}
