import express from 'express';
import cookieParser from 'cookie-parser';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import * as XLSX from 'xlsx';
import { db } from './src/db/index.ts';
import {
  additionalFields,
  auditLogs,
  equipment,
  equipmentIssues,
  equipmentTransfers,
  equipmentTypes,
  equipmentWriteoffs,
  inventories,
  notifications,
  refreshTokens,
  rooms,
  users,
  verifications,
  equipmentBatches,
} from './src/db/schema.ts';
import {
  clearAuthCookies,
  generateAccessToken,
  generateRefreshToken,
  hashTokenForStorage,
  optionalAuth,
  requireAuth,
  requireRole,
  setAuthCookies,
  validateLoginFormat,
  validatePasswordStrength,
  verifyRefreshJwt,
  type AuthRequest,
} from './src/server/auth.ts';
import {
  ENGINEER_ALLOWED_CATEGORIES,
  extractClientIp,
  getRoleLogCapabilities,
  logAuditEvent,
} from './src/server/audit-logger.ts';
import {
  detectEquipmentWriteoffCase,
  generateQrDocx,
  generateGroupQrDocx,
  generateEditableTemplateDocx,
  renderWriteoffActsFromTemplates,
  renderInvoicesFromTemplates,
} from './src/server/docx-generator.ts';
import {
  clearCustomTemplateDocx,
  getAllWriteoffTemplates,
  getWriteoffTemplate,
  isValidWriteoffTemplateKey,
  saveCustomTemplateDocx,
  saveTemplateRequisites,
  WRITEOFF_TEMPLATE_DEFINITIONS,
  type LoadedTemplateState,
  type WriteoffTemplateKey,
} from './src/server/writeoff-templates.ts';
import { validateDocxBuffer } from './src/server/docx-template-engine.ts';
import {
  getAllAdditionalFieldsForType,
  validateAdditionalFields,
} from './src/server/validation.ts';
import {
  decodeOpaqueQrToken,
  encodeEquipmentQrToken,
  encodeGroupQrToken,
} from './src/server/qr-token.ts';
import { seedDatabaseIfEmpty } from './src/db/seed.ts';
import { and, asc, desc, eq, gte, ilike, inArray, isNull, lt, lte, ne, or, sql } from 'drizzle-orm';
import path from 'path';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const isDev = process.env.NODE_ENV !== 'production';

// Trust Render / reverse-proxy headers (X-Forwarded-Proto, X-Forwarded-Host) so req.protocol === 'https'
app.set('trust proxy', 1);
app.disable('x-powered-by');

// Security Headers Middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  res.setHeader('X-DNS-Prefetch-Control', 'off');
  const isHttps = req.secure || req.get('x-forwarded-proto') === 'https';
  if (isHttps) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  if (req.path.startsWith('/api/')) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');
  }
  next();
});

// In-memory Rate Limiters & Brute-Force Protection
interface RateEntry {
  count: number;
  resetAt: number;
}

const apiRateStore = new Map<string, RateEntry>();
const authRateStore = new Map<string, RateEntry>();
const failedLoginStore = new Map<string, RateEntry>();
const qrGatewayRateStore = new Map<string, RateEntry>();
const qrProbeLogStore = new Map<string, RateEntry>();

// Periodic cleanup of expired rate-limit entries
setInterval(() => {
  const now = Date.now();
  for (const store of [
    apiRateStore,
    authRateStore,
    failedLoginStore,
    qrGatewayRateStore,
    qrProbeLogStore,
  ]) {
    for (const [key, entry] of store.entries()) {
      if (entry.resetAt <= now) {
        store.delete(key);
      }
    }
  }
}, 5 * 60 * 1000).unref();

function checkRateLimit(
  store: Map<string, RateEntry>,
  key: string,
  maxRequests: number,
  windowMs: number
): { allowed: boolean; retryAfterSec: number } {
  const now = Date.now();
  const existing = store.get(key);
  if (!existing || existing.resetAt <= now) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterSec: 0 };
  }
  if (existing.count >= maxRequests) {
    return {
      allowed: false,
      retryAfterSec: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
    };
  }
  existing.count += 1;
  return { allowed: true, retryAfterSec: 0 };
}

function recordFailedLoginAttempt(key: string): { locked: boolean; attempts: number } {
  const now = Date.now();
  const windowMs = 15 * 60 * 1000;
  const existing = failedLoginStore.get(key);
  if (!existing || existing.resetAt <= now) {
    failedLoginStore.set(key, { count: 1, resetAt: now + windowMs });
    return { locked: false, attempts: 1 };
  }
  existing.count += 1;
  return { locked: existing.count >= 5, attempts: existing.count };
}

function isLoginBruteforceLocked(key: string): { locked: boolean; retryAfterMin: number } {
  const now = Date.now();
  const existing = failedLoginStore.get(key);
  if (!existing || existing.resetAt <= now) return { locked: false, retryAfterMin: 0 };
  if (existing.count >= 5) {
    return {
      locked: true,
      retryAfterMin: Math.max(1, Math.ceil((existing.resetAt - now) / 60000)),
    };
  }
  return { locked: false, retryAfterMin: 0 };
}

function sanitizeSpreadsheetCell(val: any): string {
  const str = val === null || val === undefined ? '' : String(val);
  if (/^[=+\-@\t\r]/.test(str)) {
    return `'${str}`;
  }
  return str;
}

// Global API rate limit (400 requests/min per IP)
app.use('/api', (req, res, next) => {
  const ip = extractClientIp(req) || 'unknown';
  const check = checkRateLimit(apiRateStore, ip, 400, 60 * 1000);
  if (!check.allowed) {
    return res.status(429).json({
      error: `Превышен лимит запросов. Повторите попытку через ${check.retryAfterSec} сек.`,
    });
  }
  next();
});

// CSRF / Cross-Origin protection on state-changing API requests
app.use('/api', (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next();
  }
  const origin = req.get('origin');
  if (origin) {
    try {
      const originHost = new URL(origin).host.toLowerCase();
      const requestHost = (req.get('x-forwarded-host') || req.get('host') || '').toLowerCase();
      const appUrlHost = process.env.APP_URL
        ? new URL(process.env.APP_URL).host.toLowerCase()
        : '';
      const allowedHosts = new Set([requestHost, appUrlHost].filter(Boolean));
      if (allowedHosts.size > 0 && !allowedHosts.has(originHost)) {
        return res.status(403).json({
          error: 'Запрос отклонён политикой безопасности источника (CSRF Origin check)',
        });
      }
    } catch {
      return res.status(403).json({ error: 'Некорректный заголовок Origin' });
    }
  }
  next();
});

app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));
app.use(cookieParser());

function getPublicBaseUrl(req: express.Request): string {
  const host = req.get('x-forwarded-host') || req.get('host');
  if (host) {
    return `${req.protocol}://${host}`;
  }
  return (process.env.APP_URL || '').replace(/\/+$/, '');
}

// Health check endpoint for Render.com and Neon.tech connectivity monitoring
app.get('/api/health', async (_req, res) => {
  try {
    await db.execute(sql`SELECT 1`);
    res.json({ ok: true, database: 'connected' });
  } catch (err: any) {
    console.error('Health check DB error:', err?.message || err);
    res.status(503).json({ ok: false, database: 'disconnected' });
  }
});

// ==========================================
// 1. AUTHENTICATION & USER MANAGEMENT ROUTES
// ==========================================

// Rate limiter for auth endpoints (40 requests per 15 min per IP)
app.use('/api/auth', (req, res, next) => {
  if (req.path === '/me') return next();
  const ip = extractClientIp(req) || 'unknown';
  const check = checkRateLimit(authRateStore, ip, 40, 15 * 60 * 1000);
  if (!check.allowed) {
    return res.status(429).json({
      error: `Слишком много запросов авторизации. Повторите через ${Math.ceil(
        check.retryAfterSec / 60
      )} мин.`,
    });
  }
  next();
});

// Login
app.post('/api/auth/login', async (req, res) => {
  try {
    const rawLogin = typeof req.body?.login === 'string' ? req.body.login.trim() : '';
    const rawPassword = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!rawLogin || !rawPassword) {
      return res.status(400).json({ error: 'Логин и пароль обязательны' });
    }

    const clientIp = extractClientIp(req) || 'unknown';
    const bruteKey = `${clientIp}::${rawLogin.toLowerCase()}`;
    const lockState = isLoginBruteforceLocked(bruteKey);
    if (lockState.locked) {
      await logAuditEvent({
        req,
        actor: { login: rawLogin, role: 'ANONYMOUS' },
        action: 'AUTH_BRUTEFORCE_BLOCKED',
        category: 'SECURITY',
        severity: 'CRITICAL',
        entityType: 'auth',
        summary: `Вход временно заблокирован из-за превышения числа неудачных попыток для «${rawLogin}»`,
        details: { attemptedLogin: rawLogin, retryAfterMin: lockState.retryAfterMin },
      });
      return res.status(429).json({
        error: `Слишком много неудачных попыток входа. Повторите через ${lockState.retryAfterMin} мин.`,
      });
    }

    const [foundUser] = await db
      .select()
      .from(users)
      .where(eq(users.login, rawLogin))
      .limit(1);

    if (!foundUser) {
      recordFailedLoginAttempt(bruteKey);
      await logAuditEvent({
        req,
        actor: { login: rawLogin, role: 'ANONYMOUS' },
        action: 'AUTH_LOGIN_FAILED',
        category: 'SECURITY',
        severity: 'WARNING',
        entityType: 'auth',
        summary: `Неудачная попытка входа для несуществующего логина «${rawLogin}»`,
        details: { attemptedLogin: rawLogin, reason: 'user_not_found' },
      });
      return res.status(401).json({ error: 'Неверный логин или пароль' });
    }

    const passwordMatch = await bcrypt.compare(rawPassword, foundUser.password_hash);
    if (!passwordMatch) {
      const failRes = recordFailedLoginAttempt(bruteKey);
      await logAuditEvent({
        req,
        actor: { id: foundUser.id, login: foundUser.login, role: foundUser.role },
        action: 'AUTH_LOGIN_FAILED',
        category: 'SECURITY',
        severity: failRes.locked ? 'CRITICAL' : 'WARNING',
        entityType: 'user',
        entityId: foundUser.id,
        entityLabel: foundUser.login,
        summary: `Неудачная попытка входа (неверный пароль) для «${foundUser.login}» (попытка ${failRes.attempts}/5)`,
        details: { reason: 'invalid_password', attempts: failRes.attempts },
      });
      return res.status(401).json({ error: 'Неверный логин или пароль' });
    }

    // Clear failed login counter on successful authentication
    failedLoginStore.delete(bruteKey);

    const userPayload = {
      id: foundUser.id,
      login: foundUser.login,
      role: foundUser.role as 'ADMIN' | 'ENGINEER' | 'USER',
    };

    const accessToken = generateAccessToken(userPayload);
    const refreshToken = generateRefreshToken(userPayload);
    const hashedRefresh = hashTokenForStorage(refreshToken);

    // Refresh token valid for 10 days (stored as SHA-256 hash in DB)
    const validUntil = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);

    await db
      .insert(refreshTokens)
      .values({
        id: foundUser.id,
        token: hashedRefresh,
        valid_until: validUntil,
      })
      .onConflictDoUpdate({
        target: refreshTokens.id,
        set: {
          token: hashedRefresh,
          valid_until: validUntil,
          created_at: new Date(),
        },
      });

    setAuthCookies(res, accessToken, refreshToken, req);

    await logAuditEvent({
      req,
      actor: userPayload,
      action: 'AUTH_LOGIN',
      category: 'AUTH',
      severity: 'INFO',
      entityType: 'user',
      entityId: foundUser.id,
      entityLabel: foundUser.login,
      summary: `Успешный вход в систему («${foundUser.login}», роль ${foundUser.role})`,
    });

    res.json({
      success: true,
      user: userPayload,
      accessToken,
    });
  } catch (error: any) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Ошибка сервера при авторизации' });
  }
});

// Refresh token
app.post('/api/auth/refresh', async (req, res) => {
  try {
    const token = req.cookies?.refresh_token;

    if (!token || typeof token !== 'string') {
      return res.status(401).json({ error: 'Отсутствует refresh-токен' });
    }

    const decoded = verifyRefreshJwt(token);
    if (!decoded) {
      clearAuthCookies(res, req);
      return res.status(401).json({ error: 'Недействительный refresh-токен' });
    }

    const hashedToken = hashTokenForStorage(token);

    // Find hashed token in DB
    const [storedToken] = await db
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.token, hashedToken))
      .limit(1);

    if (!storedToken) {
      clearAuthCookies(res, req);
      return res.status(401).json({ error: 'Сессия была завершена или отозвана' });
    }

    // Check expiration
    if (new Date(storedToken.valid_until) < new Date()) {
      await db.delete(refreshTokens).where(eq(refreshTokens.id, storedToken.id));
      clearAuthCookies(res, req);
      return res.status(401).json({ error: 'Срок действия refresh-токена истек' });
    }

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, storedToken.id))
      .limit(1);

    if (!user) {
      await db.delete(refreshTokens).where(eq(refreshTokens.id, storedToken.id));
      clearAuthCookies(res, req);
      return res.status(401).json({ error: 'Пользователь не найден' });
    }

    const userPayload = {
      id: user.id,
      login: user.login,
      role: user.role as 'ADMIN' | 'ENGINEER' | 'USER',
    };

    const newAccessToken = generateAccessToken(userPayload);
    const newRefreshToken = generateRefreshToken(userPayload);
    const newHashedRefresh = hashTokenForStorage(newRefreshToken);
    const validUntil = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);

    await db
      .update(refreshTokens)
      .set({
        token: newHashedRefresh,
        valid_until: validUntil,
        created_at: new Date(),
      })
      .where(eq(refreshTokens.id, user.id));

    setAuthCookies(res, newAccessToken, newRefreshToken, req);

    res.json({
      success: true,
      user: userPayload,
      accessToken: newAccessToken,
    });
  } catch (error) {
    console.error('Refresh token error:', error);
    res.status(500).json({ error: 'Ошибка при обновлении токена' });
  }
});

// Change own password (Authenticated user)
app.post('/api/auth/change-password', requireAuth, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const currentPassword =
      typeof req.body?.currentPassword === 'string' ? req.body.currentPassword : '';
    const newPassword =
      typeof req.body?.newPassword === 'string' ? req.body.newPassword : '';

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Укажите текущий и новый пароли' });
    }
    if (currentPassword === newPassword) {
      return res.status(400).json({ error: 'Новый пароль должен отличаться от текущего' });
    }

    const [foundUser] = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!foundUser) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }

    const matches = await bcrypt.compare(currentPassword, foundUser.password_hash);
    if (!matches) {
      await logAuditEvent({
        req,
        action: 'AUTH_PASSWORD_CHANGE_FAILED',
        category: 'SECURITY',
        severity: 'WARNING',
        entityType: 'user',
        entityId: foundUser.id,
        entityLabel: foundUser.login,
        summary: `Неудачная попытка смены пароля (неверный текущий пароль) для «${foundUser.login}»`,
      });
      return res.status(400).json({ error: 'Текущий пароль указан неверно' });
    }

    const strengthError = validatePasswordStrength(newPassword, foundUser.login);
    if (strengthError) {
      return res.status(400).json({ error: strengthError });
    }

    const newHash = await bcrypt.hash(newPassword, 12);
    await db
      .update(users)
      .set({ password_hash: newHash })
      .where(eq(users.id, userId));

    // Rotate session tokens on password change
    const userPayload = {
      id: foundUser.id,
      login: foundUser.login,
      role: foundUser.role as 'ADMIN' | 'ENGINEER' | 'USER',
    };
    const accessToken = generateAccessToken(userPayload);
    const refreshToken = generateRefreshToken(userPayload);
    const hashedRefresh = hashTokenForStorage(refreshToken);
    const validUntil = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);

    await db
      .insert(refreshTokens)
      .values({ id: foundUser.id, token: hashedRefresh, valid_until: validUntil })
      .onConflictDoUpdate({
        target: refreshTokens.id,
        set: { token: hashedRefresh, valid_until: validUntil, created_at: new Date() },
      });

    setAuthCookies(res, accessToken, refreshToken, req);

    await logAuditEvent({
      req,
      action: 'AUTH_PASSWORD_CHANGE',
      category: 'SECURITY',
      severity: 'WARNING',
      entityType: 'user',
      entityId: foundUser.id,
      entityLabel: foundUser.login,
      summary: `Пользователь «${foundUser.login}» изменил свой пароль`,
    });

    res.json({
      success: true,
      accessToken,
      message: 'Пароль успешно обновлён',
    });
  } catch (error: any) {
    console.error('Change password error:', error);
    res.status(500).json({ error: 'Ошибка сервера при смене пароля' });
  }
});

// Logout
app.post('/api/auth/logout', optionalAuth, async (req: AuthRequest, res) => {
  try {
    if (req.user) {
      await db.delete(refreshTokens).where(eq(refreshTokens.id, req.user.id));
      await logAuditEvent({
        req,
        actor: req.user,
        action: 'AUTH_LOGOUT',
        category: 'AUTH',
        severity: 'INFO',
        entityType: 'user',
        entityId: req.user.id,
        entityLabel: req.user.login,
        summary: `Выход из системы («${req.user.login}»)`,
      });
    }
    clearAuthCookies(res, req);
    res.json({ success: true });
  } catch (error) {
    console.error('Logout error:', error);
    res.json({ success: true });
  }
});

// Current User
app.get('/api/auth/me', optionalAuth, async (req: AuthRequest, res) => {
  if (!req.user) {
    return res.json({ user: null });
  }
  res.json({ user: req.user });
});

// Users list (Admin only)
app.get('/api/users', requireAuth, requireRole('ADMIN'), async (_req, res) => {
  try {
    const allUsers = await db
      .select({
        id: users.id,
        login: users.login,
        role: users.role,
      })
      .from(users)
      .orderBy(users.id);
    res.json(allUsers);
  } catch (error: any) {
    console.error('Fetch users error:', error);
    res.status(500).json({ error: 'Ошибка загрузки списка пользователей' });
  }
});

// Create User (Admin only)
app.post('/api/users', requireAuth, requireRole('ADMIN'), async (req, res) => {
  try {
    const rawLogin = typeof req.body?.login === 'string' ? req.body.login.trim() : '';
    const rawPassword = typeof req.body?.password === 'string' ? req.body.password : '';
    const role = req.body?.role;
    if (!rawLogin || !rawPassword || !role) {
      return res.status(400).json({ error: 'Логин, пароль и роль обязательны' });
    }
    if (!['ADMIN', 'ENGINEER', 'USER'].includes(role)) {
      return res.status(400).json({ error: 'Недопустимая роль пользователя' });
    }

    const loginError = validateLoginFormat(rawLogin);
    if (loginError) {
      return res.status(400).json({ error: loginError });
    }

    const passError = validatePasswordStrength(rawPassword, rawLogin);
    if (passError) {
      return res.status(400).json({ error: passError });
    }

    const existing = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.login, rawLogin))
      .limit(1);

    if (existing.length > 0) {
      return res.status(400).json({ error: `Пользователь с логином "${rawLogin}" уже существует` });
    }

    const passwordHash = await bcrypt.hash(rawPassword, 12);
    const [created] = await db
      .insert(users)
      .values({
        login: rawLogin,
        password_hash: passwordHash,
        role: role as 'ADMIN' | 'ENGINEER' | 'USER',
      })
      .returning({ id: users.id, login: users.login, role: users.role });

    await logAuditEvent({
      req,
      action: 'USER_CREATE',
      category: 'ADMIN',
      severity: 'WARNING',
      entityType: 'user',
      entityId: created.id,
      entityLabel: created.login,
      summary: `Создана учётная запись «${created.login}» с ролью ${created.role}`,
      details: { userId: created.id, login: created.login, role: created.role },
    });

    res.status(201).json(created);
  } catch (error: any) {
    console.error('Create user error:', error);
    res.status(500).json({ error: 'Ошибка создания пользователя' });
  }
});

// Admin reset password for a user
app.put('/api/users/:id/password', requireAuth, requireRole('ADMIN'), async (req: AuthRequest, res) => {
  try {
    const targetId = Number(req.params.id);
    if (!Number.isInteger(targetId) || targetId <= 0) {
      return res.status(400).json({ error: 'Некорректный ID пользователя' });
    }

    const newPassword = typeof req.body?.newPassword === 'string' ? req.body.newPassword : '';
    const [targetUser] = await db
      .select({ id: users.id, login: users.login, role: users.role })
      .from(users)
      .where(eq(users.id, targetId))
      .limit(1);

    if (!targetUser) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }

    const passError = validatePasswordStrength(newPassword, targetUser.login);
    if (passError) {
      return res.status(400).json({ error: passError });
    }

    const newHash = await bcrypt.hash(newPassword, 12);
    await db
      .update(users)
      .set({ password_hash: newHash })
      .where(eq(users.id, targetId));

    // Revoke active refresh token so target user must re-authenticate with new password
    await db.delete(refreshTokens).where(eq(refreshTokens.id, targetId));

    await logAuditEvent({
      req,
      action: 'USER_PASSWORD_RESET',
      category: 'SECURITY',
      severity: 'WARNING',
      entityType: 'user',
      entityId: targetUser.id,
      entityLabel: targetUser.login,
      summary: `Администратор сбросил пароль пользователя «${targetUser.login}»`,
      details: { targetUserId: targetUser.id, targetLogin: targetUser.login },
    });

    res.json({ success: true, message: `Пароль для «${targetUser.login}» обновлён` });
  } catch (error: any) {
    console.error('Reset user password error:', error);
    res.status(500).json({ error: 'Ошибка сброса пароля' });
  }
});

// Delete user (Admin only, cannot delete own account)
app.delete('/api/users/:id', requireAuth, requireRole('ADMIN'), async (req: AuthRequest, res) => {
  try {
    const targetId = Number(req.params.id);
    if (!Number.isInteger(targetId) || targetId <= 0) {
      return res.status(400).json({ error: 'Некорректный ID пользователя' });
    }
    if (targetId === req.user!.id) {
      return res.status(400).json({ error: 'Нельзя удалить собственную учётную запись администратора' });
    }

    const [targetUser] = await db
      .select({ id: users.id, login: users.login, role: users.role })
      .from(users)
      .where(eq(users.id, targetId))
      .limit(1);

    if (!targetUser) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }

    await db.delete(refreshTokens).where(eq(refreshTokens.id, targetId));
    await db.delete(notifications).where(eq(notifications.user_id, targetId));
    await db.delete(users).where(eq(users.id, targetId));

    await logAuditEvent({
      req,
      action: 'USER_DELETE',
      category: 'SECURITY',
      severity: 'CRITICAL',
      entityType: 'user',
      entityId: targetUser.id,
      entityLabel: targetUser.login,
      summary: `Удалена учётная запись «${targetUser.login}» (роль ${targetUser.role})`,
      details: { deletedUserId: targetUser.id, deletedLogin: targetUser.login, deletedRole: targetUser.role },
    });

    res.json({ success: true, deletedId: targetId });
  } catch (error: any) {
    console.error('Delete user error:', error);
    res.status(500).json({ error: 'Ошибка удаления пользователя (возможно, есть связанные инвентаризации)' });
  }
});

// ==========================================
// 2. ROOMS & TYPES ROUTES
// ==========================================

// Get Rooms
app.get('/api/rooms', requireAuth, async (_req, res) => {
  try {
    const roomList = await db.select().from(rooms).orderBy(rooms.number);
    res.json(roomList);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Create Room (Admin only)
app.post('/api/rooms', requireAuth, requireRole('ADMIN'), async (req, res) => {
  try {
    const { number, floor } = req.body;
    if (!number || floor === undefined) {
      return res.status(400).json({ error: 'Номер кабинета и этаж обязательны' });
    }

    const [newRoom] = await db
      .insert(rooms)
      .values({
        number: String(number).trim(),
        floor: Number(floor),
      })
      .returning();

    await logAuditEvent({
      req,
      action: 'ROOM_CREATE',
      category: 'ADMIN',
      severity: 'INFO',
      entityType: 'room',
      entityId: newRoom.id,
      entityLabel: `Ауд. ${newRoom.number} (${newRoom.floor} этаж)`,
      summary: `Добавлено помещение «${newRoom.number}» (${newRoom.floor} этаж)`,
      details: { roomId: newRoom.id, number: newRoom.number, floor: newRoom.floor },
    });

    res.status(201).json(newRoom);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Delete Room (Admin only)
app.delete('/api/rooms/:id', requireAuth, requireRole('ADMIN'), async (req, res) => {
  try {
    const roomId = Number(req.params.id);
    if (!Number.isInteger(roomId) || roomId <= 0) {
      return res.status(400).json({ error: 'Некорректный идентификатор кабинета' });
    }

    const [existing] = await db
      .select()
      .from(rooms)
      .where(eq(rooms.id, roomId))
      .limit(1);

    if (!existing) {
      return res.status(404).json({ error: 'Кабинет не найден' });
    }

    const [eqCount] = await db
      .select({ count: sql<number>`count(*)` })
      .from(equipment)
      .where(eq(equipment.room_id, roomId));

    if (Number(eqCount?.count || 0) > 0) {
      return res.status(400).json({
        error: `Нельзя удалить кабинет № ${existing.number}: за ним закреплено ${eqCount.count} ед. оборудования. Сначала перенесите или удалите оборудование.`,
      });
    }

    // Clear nullable room_id on any group batches that pointed to this room
    await db
      .update(equipmentBatches)
      .set({ room_id: null })
      .where(eq(equipmentBatches.room_id, roomId));

    await db.delete(rooms).where(eq(rooms.id, roomId));

    await logAuditEvent({
      req,
      action: 'ROOM_DELETE',
      category: 'ADMIN',
      severity: 'WARNING',
      entityType: 'room',
      entityId: existing.id,
      entityLabel: `Ауд. ${existing.number} (${existing.floor} этаж)`,
      summary: `Удалено помещение «${existing.number}» (${existing.floor} этаж)`,
      details: { roomId: existing.id, number: existing.number, floor: existing.floor },
    });

    res.json({ success: true, deletedId: roomId });
  } catch (error: any) {
    console.error('Delete room error:', error);
    res.status(500).json({ error: error.message || 'Ошибка удаления кабинета' });
  }
});

// Get Equipment Types (hierarchical)
app.get('/api/equipment-types', requireAuth, async (_req, res) => {
  try {
    const types = await db.select().from(equipmentTypes).orderBy(equipmentTypes.name);
    res.json(types);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

const MAX_TYPE_DEPTH = 10;

function getTypeDepth(
  typeId: number,
  typeMap: Map<number, { id: number; parent_id: number | null }>
): number {
  let depth = 0;
  let curr: number | null = typeId;
  const visited = new Set<number>();

  while (curr !== null && !visited.has(curr)) {
    const rec = typeMap.get(curr);
    if (!rec) break;
    visited.add(curr);
    depth += 1;
    curr =
      rec.parent_id !== null && rec.parent_id !== undefined
        ? Number(rec.parent_id)
        : null;
  }

  return depth;
}

function getSubtreeHeight(
  typeId: number,
  childrenMap: Map<number, number[]>,
  visited = new Set<number>()
): number {
  if (visited.has(typeId)) return 1;
  visited.add(typeId);
  const children = childrenMap.get(typeId) || [];
  let maxChild = 0;
  for (const childId of children) {
    const h = getSubtreeHeight(childId, childrenMap, visited);
    if (h > maxChild) maxChild = h;
  }
  visited.delete(typeId);
  return 1 + maxChild;
}

// Create Equipment Type (Admin only)
app.post('/api/equipment-types', requireAuth, requireRole('ADMIN'), async (req, res) => {
  try {
    const { name, parent_id } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Название типа оборудования обязательно' });
    }

    const parsedParentId =
      parent_id !== undefined && parent_id !== '' && parent_id !== null
        ? Number(parent_id)
        : null;

    if (parsedParentId !== null) {
      if (!Number.isInteger(parsedParentId) || parsedParentId <= 0) {
        return res.status(400).json({ error: 'Некорректный идентификатор родительского типа' });
      }

      const allTypes = await db
        .select({ id: equipmentTypes.id, parent_id: equipmentTypes.parent_id })
        .from(equipmentTypes);
      const typeMap = new Map<number, { id: number; parent_id: number | null }>();
      for (const t of allTypes) {
        typeMap.set(Number(t.id), {
          id: Number(t.id),
          parent_id: t.parent_id !== null && t.parent_id !== undefined ? Number(t.parent_id) : null,
        });
      }

      if (!typeMap.has(parsedParentId)) {
        return res.status(400).json({ error: 'Выбранный родительский тип оборудования не найден' });
      }

      const parentDepth = getTypeDepth(parsedParentId, typeMap);
      if (parentDepth >= MAX_TYPE_DEPTH) {
        return res.status(400).json({
          error: `Достигнута максимальная глубина вложения типов (${MAX_TYPE_DEPTH} уровней)`,
        });
      }
    }

    const [newType] = await db
      .insert(equipmentTypes)
      .values({
        name: name.trim(),
        parent_id: parsedParentId,
      })
      .returning();

    await logAuditEvent({
      req,
      action: 'TYPE_CREATE',
      category: 'ADMIN',
      severity: 'INFO',
      entityType: 'equipment_type',
      entityId: newType.id,
      entityLabel: newType.name,
      summary: `Создан тип оборудования «${newType.name}»`,
      details: { parent_id: newType.parent_id },
    });

    res.status(201).json(newType);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Update Equipment Type (Admin only)
app.put('/api/equipment-types/:id', requireAuth, requireRole('ADMIN'), async (req, res) => {
  try {
    const typeId = Number(req.params.id);
    if (!Number.isInteger(typeId) || typeId <= 0) {
      return res.status(400).json({ error: 'Некорректный идентификатор типа оборудования' });
    }
    const { name, parent_id } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Название типа оборудования обязательно' });
    }

    const [existing] = await db
      .select()
      .from(equipmentTypes)
      .where(eq(equipmentTypes.id, typeId))
      .limit(1);

    if (!existing) {
      return res.status(404).json({ error: 'Тип оборудования не найден' });
    }

    const newParentId =
      parent_id !== undefined && parent_id !== '' && parent_id !== null
        ? Number(parent_id)
        : null;

    if (newParentId !== null && (!Number.isInteger(newParentId) || newParentId <= 0)) {
      return res.status(400).json({ error: 'Некорректный идентификатор родительского типа' });
    }

    if (newParentId === typeId) {
      return res.status(400).json({ error: 'Тип не может быть родителем самого себя' });
    }

    if (newParentId) {
      const allTypes = await db
        .select({ id: equipmentTypes.id, parent_id: equipmentTypes.parent_id })
        .from(equipmentTypes);
      const typeMap = new Map<number, { id: number; parent_id: number | null }>();
      const childrenMap = new Map<number, number[]>();

      for (const t of allTypes) {
        const idNum = Number(t.id);
        const pidNum = t.parent_id !== null && t.parent_id !== undefined ? Number(t.parent_id) : null;
        typeMap.set(idNum, { id: idNum, parent_id: pidNum });
        if (pidNum !== null) {
          const arr = childrenMap.get(pidNum) || [];
          arr.push(idNum);
          childrenMap.set(pidNum, arr);
        }
      }

      if (!typeMap.has(newParentId)) {
        return res.status(400).json({ error: 'Выбранный родительский тип не найден' });
      }

      let curr: number | null = newParentId;
      const visited = new Set<number>();
      while (curr) {
        if (curr === typeId) {
          return res.status(400).json({
            error: 'Нельзя назначить дочерний подтип родителем (циклическая зависимость)',
          });
        }
        if (visited.has(curr)) break;
        visited.add(curr);
        const parentRecord = typeMap.get(curr);
        curr = parentRecord?.parent_id ?? null;
      }

      const newParentDepth = getTypeDepth(newParentId, typeMap);
      const subtreeHeight = getSubtreeHeight(typeId, childrenMap);
      if (newParentDepth + subtreeHeight > MAX_TYPE_DEPTH) {
        return res.status(400).json({
          error: `Невозможно назначить родительский тип: глубина вложенности с учётом дочерних подтипов превысит ${MAX_TYPE_DEPTH} уровней`,
        });
      }

      // Ensure moving this subtree under newParentId won't introduce duplicate JSON field codes across parent-child chains
      const subtreeTypeIds = new Set<number>([typeId]);
      const subQueue = [typeId];
      while (subQueue.length > 0) {
        const cur = subQueue.shift()!;
        for (const ch of childrenMap.get(cur) || []) {
          if (!subtreeTypeIds.has(ch)) {
            subtreeTypeIds.add(ch);
            subQueue.push(ch);
          }
        }
      }

      const ancestorTypeIds = new Set<number>();
      let ancCurr: number | null = newParentId;
      while (ancCurr !== null && !ancestorTypeIds.has(ancCurr)) {
        ancestorTypeIds.add(ancCurr);
        ancCurr = typeMap.get(ancCurr)?.parent_id ?? null;
      }

      const combinedIds = Array.from(new Set([...subtreeTypeIds, ...ancestorTypeIds]));
      if (combinedIds.length > 0) {
        const activeFieldsInBranch = await db
          .select({
            type_id: additionalFields.type_id,
            code: additionalFields.code,
            title: additionalFields.title,
          })
          .from(additionalFields)
          .where(
            and(
              inArray(additionalFields.type_id, combinedIds),
              eq(additionalFields.is_active, true)
            )
          );

        const ancestorCodeMap = new Map<string, { typeId: number; title: string; code: string }>();
        for (const f of activeFieldsInBranch) {
          if (ancestorTypeIds.has(Number(f.type_id))) {
            ancestorCodeMap.set(f.code.trim().toLowerCase(), {
              typeId: Number(f.type_id),
              title: f.title,
              code: f.code,
            });
          }
        }

        for (const f of activeFieldsInBranch) {
          if (subtreeTypeIds.has(Number(f.type_id))) {
            const clash = ancestorCodeMap.get(f.code.trim().toLowerCase());
            if (clash) {
              return res.status(400).json({
                error: `Невозможно переместить тип: код JSON «${f.code}» («${f.title}») конфликтует с одноимённой характеристикой родительской ветви («${clash.title}»).`,
              });
            }
          }
        }
      }
    }

    const [updated] = await db
      .update(equipmentTypes)
      .set({
        name: name.trim(),
        parent_id: newParentId,
      })
      .where(eq(equipmentTypes.id, typeId))
      .returning();

    res.json(updated);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Delete Equipment Type (Admin only)
app.delete('/api/equipment-types/:id', requireAuth, requireRole('ADMIN'), async (req, res) => {
  try {
    const typeId = Number(req.params.id);
    if (!Number.isInteger(typeId) || typeId <= 0) {
      return res.status(400).json({ error: 'Некорректный идентификатор типа оборудования' });
    }

    const [existing] = await db
      .select()
      .from(equipmentTypes)
      .where(eq(equipmentTypes.id, typeId))
      .limit(1);

    if (!existing) {
      return res.status(404).json({ error: 'Тип оборудования не найден' });
    }

    // Check if any equipment uses this type
    const [eqCount] = await db
      .select({ count: sql<number>`count(*)` })
      .from(equipment)
      .where(eq(equipment.type_id, typeId));

    if (Number(eqCount?.count || 0) > 0) {
      return res.status(400).json({
        error: `Нельзя удалить тип «${existing.name}»: к нему привязано ${eqCount.count} ед. оборудования`,
      });
    }

    // Check if any child types exist
    const [childrenCount] = await db
      .select({ count: sql<number>`count(*)` })
      .from(equipmentTypes)
      .where(eq(equipmentTypes.parent_id, typeId));

    if (Number(childrenCount?.count || 0) > 0) {
      return res.status(400).json({
        error: `Нельзя удалить тип «${existing.name}»: у него есть дочерние подтипы (${childrenCount.count} шт.). Сначала переместите или удалите их.`,
      });
    }

    // Delete associated additional fields
    await db.delete(additionalFields).where(eq(additionalFields.type_id, typeId));

    // Delete the equipment type
    await db.delete(equipmentTypes).where(eq(equipmentTypes.id, typeId));

    res.json({ success: true, deletedId: typeId });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get Additional Fields for a type (including inherited from parents)
app.get('/api/equipment-types/:id/fields', requireAuth, async (req, res) => {
  try {
    const typeId = Number(req.params.id);
    if (!Number.isInteger(typeId) || typeId <= 0) {
      return res.status(400).json({ error: 'Некорректный идентификатор типа оборудования' });
    }
    const fields = await getAllAdditionalFieldsForType(typeId);
    res.json(fields);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

async function findFieldCodeConflictInHierarchy(
  typeId: number,
  rawCode: string,
  excludeFieldId?: number
): Promise<{
  relation: 'self' | 'ancestor' | 'descendant' | 'global';
  ownerTypeName: string;
  existingTitle: string;
  existingCode: string;
} | null> {
  const cleanLower = rawCode.trim().toLowerCase();
  const allTypes = await db
    .select({
      id: equipmentTypes.id,
      name: equipmentTypes.name,
      parent_id: equipmentTypes.parent_id,
    })
    .from(equipmentTypes);

  const byId = new Map<number, { id: number; name: string; parent_id: number | null }>();
  const childrenByParent = new Map<number, number[]>();

  for (const t of allTypes) {
    const id = Number(t.id);
    const pid = t.parent_id !== null && t.parent_id !== undefined ? Number(t.parent_id) : null;
    byId.set(id, { id, name: t.name, parent_id: pid });
    if (pid !== null) {
      const arr = childrenByParent.get(pid) || [];
      arr.push(id);
      childrenByParent.set(pid, arr);
    }
  }

  const ancestorIds = new Set<number>();
  let curr: number | null = byId.get(typeId)?.parent_id ?? null;
  while (curr !== null && !ancestorIds.has(curr) && ancestorIds.size < 25) {
    ancestorIds.add(curr);
    curr = byId.get(curr)?.parent_id ?? null;
  }

  const descendantIds = new Set<number>();
  const descQueue = [...(childrenByParent.get(typeId) || [])];
  while (descQueue.length > 0 && descendantIds.size < 500) {
    const cid = descQueue.shift()!;
    if (!descendantIds.has(cid) && cid !== typeId) {
      descendantIds.add(cid);
      for (const nextChild of childrenByParent.get(cid) || []) {
        descQueue.push(nextChild);
      }
    }
  }

  const relatedTypeIds = Array.from(new Set([typeId, ...ancestorIds, ...descendantIds]));

  const candidateFields = await db
    .select()
    .from(additionalFields)
    .where(
      and(
        eq(additionalFields.is_active, true),
        relatedTypeIds.length > 0
          ? or(isNull(additionalFields.type_id), inArray(additionalFields.type_id, relatedTypeIds))
          : isNull(additionalFields.type_id)
      )
    );

  for (const f of candidateFields) {
    if (excludeFieldId && Number(f.id) === excludeFieldId) continue;
    if (String(f.code || '').trim().toLowerCase() !== cleanLower) continue;

    if (f.type_id === null || f.type_id === undefined) {
      return {
        relation: 'global',
        ownerTypeName: 'Общая характеристика (для всех типов)',
        existingTitle: f.title,
        existingCode: f.code,
      };
    }

    const ownerId = Number(f.type_id);
    const ownerTypeName = byId.get(ownerId)?.name || `#${ownerId}`;
    const relation: 'self' | 'ancestor' | 'descendant' =
      ownerId === typeId ? 'self' : ancestorIds.has(ownerId) ? 'ancestor' : 'descendant';

    return {
      relation,
      ownerTypeName,
      existingTitle: f.title,
      existingCode: f.code,
    };
  }

  return null;
}

function formatFieldCodeConflictError(
  cleanCode: string,
  conflict: NonNullable<Awaited<ReturnType<typeof findFieldCodeConflictInHierarchy>>>
): string {
  if (conflict.relation === 'global') {
    return `Код JSON «${cleanCode}» уже занят в общей характеристике для всех типов («${conflict.existingTitle}»).`;
  }
  if (conflict.relation === 'self') {
    return `Характеристика с кодом JSON «${cleanCode}» уже существует для данного типа («${conflict.existingTitle}»).`;
  }
  if (conflict.relation === 'ancestor') {
    return `Код JSON «${cleanCode}» уже занят в родительском типе «${conflict.ownerTypeName}» («${conflict.existingTitle}»). Код должен быть уникальным в пределах типа и его родителей.`;
  }
  return `Код JSON «${cleanCode}» уже используется в дочернем подтипе «${conflict.ownerTypeName}» («${conflict.existingTitle}»). Выберите другой код.`;
}

async function findGlobalFieldCodeConflict(
  rawCode: string,
  excludeFieldId?: number
): Promise<string | null> {
  const cleanLower = rawCode.trim().toLowerCase();
  const activeFields = await db
    .select()
    .from(additionalFields)
    .where(eq(additionalFields.is_active, true));

  const colliding = activeFields.find(
    (f: any) =>
      (!excludeFieldId || Number(f.id) !== excludeFieldId) &&
      String(f.code || '').trim().toLowerCase() === cleanLower
  );

  if (!colliding) return null;

  if (colliding.type_id === null || colliding.type_id === undefined) {
    return `Общая характеристика с кодом JSON «${rawCode.trim()}» уже существует («${colliding.title}»).`;
  }

  const [ownerType] = await db
    .select({ name: equipmentTypes.name })
    .from(equipmentTypes)
    .where(eq(equipmentTypes.id, Number(colliding.type_id)))
    .limit(1);

  return `Код JSON «${rawCode.trim()}» уже используется в типе «${ownerType?.name || `#${colliding.type_id}`}» («${colliding.title}»). Выберите уникальный код для общей характеристики.`;
}

// Global Additional Fields (present on all equipment types)
app.get('/api/additional-fields/global', requireAuth, async (_req, res) => {
  try {
    const fields = await db
      .select()
      .from(additionalFields)
      .where(and(isNull(additionalFields.type_id), eq(additionalFields.is_active, true)))
      .orderBy(asc(additionalFields.id));
    res.json(fields);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/additional-fields/global', requireAuth, requireRole('ADMIN'), async (req, res) => {
  try {
    const { code, title, data_type, is_required, is_multiple, options } = req.body;
    if (!code || !String(code).trim() || !title || !String(title).trim() || !data_type) {
      return res.status(400).json({ error: 'Код, название и тип данных обязательны' });
    }

    const cleanCode = String(code).trim();
    if (data_type === 'ENUM') {
      if (!options || !Array.isArray(options) || options.length === 0) {
        return res.status(400).json({ error: 'Для типа ENUM необходимо указать хотя бы 1 вариант значений' });
      }
    }

    const conflictError = await findGlobalFieldCodeConflict(cleanCode);
    if (conflictError) {
      return res.status(400).json({ error: conflictError });
    }

    const [createdField] = await db
      .insert(additionalFields)
      .values({
        type_id: null,
        code: cleanCode,
        title: String(title).trim(),
        data_type,
        is_required: Boolean(is_required),
        is_multiple: Boolean(is_multiple),
        options: data_type === 'ENUM' ? options : null,
        is_active: true,
      })
      .returning();

    res.status(201).json(createdField);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/additional-fields/global/:fieldId', requireAuth, requireRole('ADMIN'), async (req, res) => {
  try {
    const fieldId = Number(req.params.fieldId);
    if (!Number.isInteger(fieldId) || fieldId <= 0) {
      return res.status(400).json({ error: 'Некорректный идентификатор характеристики' });
    }
    const { code, title, data_type, is_required, is_multiple, options } = req.body;
    if (!code || !String(code).trim() || !title || !String(title).trim() || !data_type) {
      return res.status(400).json({ error: 'Код, название и тип данных обязательны' });
    }

    const cleanCode = String(code).trim();
    if (data_type === 'ENUM') {
      if (!options || !Array.isArray(options) || options.length === 0) {
        return res.status(400).json({ error: 'Для типа ENUM необходимо указать хотя бы 1 вариант значений' });
      }
    }

    const [existing] = await db
      .select()
      .from(additionalFields)
      .where(and(eq(additionalFields.id, fieldId), isNull(additionalFields.type_id)))
      .limit(1);

    if (!existing) {
      return res.status(404).json({ error: 'Общая характеристика не найдена' });
    }

    const conflictError = await findGlobalFieldCodeConflict(cleanCode, fieldId);
    if (conflictError) {
      return res.status(400).json({ error: conflictError });
    }

    const [updatedField] = await db
      .update(additionalFields)
      .set({
        code: cleanCode,
        title: String(title).trim(),
        data_type,
        is_required: Boolean(is_required),
        is_multiple: Boolean(is_multiple),
        options: data_type === 'ENUM' ? options : null,
      })
      .where(eq(additionalFields.id, fieldId))
      .returning();

    res.json(updatedField);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/additional-fields/global/:fieldId', requireAuth, requireRole('ADMIN'), async (req, res) => {
  try {
    const fieldId = Number(req.params.fieldId);
    if (!Number.isInteger(fieldId) || fieldId <= 0) {
      return res.status(400).json({ error: 'Некорректный идентификатор характеристики' });
    }
    await db
      .update(additionalFields)
      .set({ is_active: false })
      .where(and(eq(additionalFields.id, fieldId), isNull(additionalFields.type_id)));

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Create Additional Field (Admin only)
// Spec: "Если тип ENUM, то в options обязательно хотя бы 1 значение; иначе NULL. code поля должен быть уникальным в пределах type_id и всей его ветви предков/потомков."
app.post('/api/equipment-types/:id/fields', requireAuth, requireRole('ADMIN'), async (req, res) => {
  try {
    const typeId = Number(req.params.id);
    if (!Number.isInteger(typeId) || typeId <= 0) {
      return res.status(400).json({ error: 'Некорректный идентификатор типа оборудования' });
    }
    const { code, title, data_type, is_required, is_multiple, options } = req.body;

    if (!code || !String(code).trim() || !title || !String(title).trim() || !data_type) {
      return res.status(400).json({ error: 'Код, название и тип данных обязательны' });
    }

    const cleanCode = String(code).trim();

    if (data_type === 'ENUM') {
      if (!options || !Array.isArray(options) || options.length === 0) {
        return res.status(400).json({ error: 'Для типа ENUM необходимо указать хотя бы 1 вариант значений' });
      }
    }

    const conflict = await findFieldCodeConflictInHierarchy(typeId, cleanCode);
    if (conflict) {
      return res.status(400).json({
        error: formatFieldCodeConflictError(cleanCode, conflict),
      });
    }

    const [createdField] = await db
      .insert(additionalFields)
      .values({
        type_id: typeId,
        code: cleanCode,
        title: String(title).trim(),
        data_type: data_type,
        is_required: Boolean(is_required),
        is_multiple: Boolean(is_multiple),
        options: data_type === 'ENUM' ? options : null,
        is_active: true,
      })
      .returning();

    res.status(201).json(createdField);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Update Additional Field (Admin only)
app.put('/api/equipment-types/:typeId/fields/:fieldId', requireAuth, requireRole('ADMIN'), async (req, res) => {
  try {
    const typeId = Number(req.params.typeId);
    const fieldId = Number(req.params.fieldId);
    if (!Number.isInteger(typeId) || typeId <= 0 || !Number.isInteger(fieldId) || fieldId <= 0) {
      return res.status(400).json({ error: 'Некорректный идентификатор типа или характеристики' });
    }
    const { code, title, data_type, is_required, is_multiple, options } = req.body;

    if (!code || !String(code).trim() || !title || !String(title).trim() || !data_type) {
      return res.status(400).json({ error: 'Код, название и тип данных обязательны' });
    }

    const cleanCode = String(code).trim();

    if (data_type === 'ENUM') {
      if (!options || !Array.isArray(options) || options.length === 0) {
        return res.status(400).json({ error: 'Для типа ENUM необходимо указать хотя бы 1 вариант значений' });
      }
    }

    // Check existing field
    const [existing] = await db
      .select()
      .from(additionalFields)
      .where(and(eq(additionalFields.id, fieldId), eq(additionalFields.type_id, typeId)))
      .limit(1);

    if (!existing) {
      return res.status(404).json({ error: 'Характеристика не найдена' });
    }

    // Check unique code across this type, ancestors and descendants
    const conflict = await findFieldCodeConflictInHierarchy(typeId, cleanCode, fieldId);
    if (conflict) {
      return res.status(400).json({
        error: formatFieldCodeConflictError(cleanCode, conflict),
      });
    }

    const [updatedField] = await db
      .update(additionalFields)
      .set({
        code: cleanCode,
        title: String(title).trim(),
        data_type: data_type,
        is_required: Boolean(is_required),
        is_multiple: Boolean(is_multiple),
        options: data_type === 'ENUM' ? options : null,
      })
      .where(eq(additionalFields.id, fieldId))
      .returning();

    res.json(updatedField);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Delete Additional Field (Admin only)
// Spec: "При удалении поля выставляется флаг is_active = false. Такие поля не попадают в выборку"
app.delete('/api/equipment-types/:typeId/fields/:fieldId', requireAuth, requireRole('ADMIN'), async (req, res) => {
  try {
    const fieldId = Number(req.params.fieldId);
    if (!Number.isInteger(fieldId) || fieldId <= 0) {
      return res.status(400).json({ error: 'Некорректный идентификатор характеристики' });
    }
    await db
      .update(additionalFields)
      .set({ is_active: false })
      .where(eq(additionalFields.id, fieldId));

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// 3. EQUIPMENT ROUTES (CRUD, Filter, Search, QR)
// ==========================================

// Helper to normalize warranty_until and parse dimensions
function normalizeWarrantyUntilDate(rawWarrantyUntil: any): string | null {
  if (!rawWarrantyUntil) return null;
  if (typeof rawWarrantyUntil === 'string') {
    const trimmed = rawWarrantyUntil.trim();
    if (!trimmed) return null;
    const ruMatch = trimmed.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
    if (ruMatch) {
      return `${ruMatch[3]}-${ruMatch[2].padStart(2, '0')}-${ruMatch[1].padStart(2, '0')}`;
    }
    const isoMatch = trimmed.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})/);
    if (isoMatch && Number(isoMatch[1]) >= 1900 && Number(isoMatch[1]) <= 2150) {
      return `${isoMatch[1]}-${isoMatch[2].padStart(2, '0')}-${isoMatch[3].padStart(2, '0')}`;
    }
    if (/^\d{5}(\.\d+)?$/.test(trimmed)) {
      const serial = parseFloat(trimmed);
      if (serial >= 15000 && serial <= 80000) {
        const d = new Date(Math.round((serial - 25569) * 86400 * 1000));
        if (!isNaN(d.getTime())) {
          return d.toISOString().split('T')[0];
        }
      }
    }
    const d = new Date(trimmed);
    if (!isNaN(d.getTime()) && d.getFullYear() >= 1900 && d.getFullYear() <= 2150) {
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }
    return null;
  }
  if (rawWarrantyUntil instanceof Date && !isNaN(rawWarrantyUntil.getTime())) {
    return `${rawWarrantyUntil.getFullYear()}-${String(rawWarrantyUntil.getMonth() + 1).padStart(2, '0')}-${String(rawWarrantyUntil.getDate()).padStart(2, '0')}`;
  }
  return null;
}

function parseDimensionsForStorage(fields: any = {}) {
  const rawDim = fields.dimensions || fields['Размеры (Д*Ш*В), см'];
  let length_cm: number | null = fields.length_cm ? Number(fields.length_cm) : null;
  let width_cm: number | null = fields.width_cm ? Number(fields.width_cm) : null;
  let height_cm: number | null = fields.height_cm ? Number(fields.height_cm) : null;

  if (rawDim && String(rawDim).trim()) {
    const parts = String(rawDim)
      .split(/[*xхXХ×]/)
      .map((s: string) => parseFloat(s.trim().replace(',', '.')))
      .filter((n: number) => !isNaN(n));
    length_cm = parts.length >= 1 ? parts[0] : null;
    width_cm = parts.length >= 2 ? parts[1] : null;
    height_cm = parts.length >= 3 ? parts[2] : null;
  } else if (rawDim === '' || rawDim === null) {
    length_cm = fields.length_cm ? Number(fields.length_cm) : null;
    width_cm = fields.width_cm ? Number(fields.width_cm) : null;
    height_cm = fields.height_cm ? Number(fields.height_cm) : null;
  }

  return {
    dimensions:
      (rawDim && String(rawDim).trim()) ||
      (length_cm && width_cm && height_cm ? `${length_cm}*${width_cm}*${height_cm}` : null),
    length_cm,
    width_cm,
    height_cm,
  };
}

// Store only warranty_until (warranty status is derived dynamically on read)
function prepareAdditionalFieldsForStorage(fields: any = {}) {
  const clean: Record<string, any> = { ...fields };
  const rawWarrantyUntil = clean.warranty_until || clean['Гарантия истекает'];
  const formattedUntilStr = normalizeWarrantyUntilDate(rawWarrantyUntil);

  delete clean.is_under_warranty;
  delete clean.warranty_status_ru;
  delete clean.warranty_expired;
  delete clean['Оборудование на гарантии'];
  delete clean['Гарантия истекает'];

  const dimData = parseDimensionsForStorage(clean);

  return {
    ...clean,
    ...dimData,
    warranty_until: formattedUntilStr,
  };
}

// Compute warranty status strictly from warranty_until + parsed dimensions on read
function computeDynamicWarranty(fields: any = {}) {
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  const rawWarrantyUntil = fields.warranty_until || fields['Гарантия истекает'];
  const formattedUntilStr = normalizeWarrantyUntilDate(rawWarrantyUntil);

  let isUnderWarranty = false;
  let warrantyExpired = false;

  if (formattedUntilStr) {
    // Active when expiration date >= current date; not under warranty if < current date
    if (formattedUntilStr < todayStr) {
      isUnderWarranty = false;
      warrantyExpired = true;
    } else {
      isUnderWarranty = true;
      warrantyExpired = false;
    }
  } else {
    isUnderWarranty = false;
    warrantyExpired = false;
  }

  const dimData = parseDimensionsForStorage(fields);

  return {
    ...fields,
    ...dimData,
    warranty_until: formattedUntilStr || null,
    is_under_warranty: isUnderWarranty,
    warranty_status_ru: isUnderWarranty ? 'Да' : 'Нет',
    warranty_expired: warrantyExpired,
  };
}

// Equipment List (strictly authenticated + USER role privacy filter)
app.get('/api/equipment', requireAuth, async (req: AuthRequest, res) => {
  try {
    const isRegularUser = req.user?.role === 'USER';
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.max(1, Math.min(200, Number(req.query.limit) || 15));
    const offset = (page - 1) * limit;

    const search = req.query.search ? String(req.query.search).trim() : '';
    const typeId = req.query.type_id ? Number(req.query.type_id) : undefined;
    const roomId = req.query.room_id ? Number(req.query.room_id) : undefined;
    const receivedFrom = req.query.received_from ? new Date(String(req.query.received_from)) : undefined;
    const receivedTo = req.query.received_to ? new Date(String(req.query.received_to)) : undefined;
    const includeWrittenOff = !isRegularUser && req.query.include_written_off === 'true';
    const writeoffState = !isRegularUser && req.query.writeoff_state ? String(req.query.writeoff_state) : undefined;
    const hasUnrepairedIssue = req.query.has_unrepaired_issue === 'true';
    const activeTransferOnly = !isRegularUser && req.query.active_transfer === 'true';
    const transferredTo = !isRegularUser && req.query.transferred_to ? String(req.query.transferred_to).trim() : undefined;
    const customFieldCode = req.query.custom_field_code ? String(req.query.custom_field_code).trim() : undefined;
    const customFieldValue = req.query.custom_field_value ? String(req.query.custom_field_value).trim() : undefined;
    const customFieldMin = req.query.custom_field_min ? String(req.query.custom_field_min).trim() : undefined;
    const customFieldMax = req.query.custom_field_max ? String(req.query.custom_field_max).trim() : undefined;

    // Additional department filters
    const colorFilter = req.query.color ? String(req.query.color).trim().toLowerCase() : undefined;
    const statusFilter = req.query.status ? String(req.query.status).trim() : undefined;
    const conditionFilter = req.query.condition ? String(req.query.condition).trim() : undefined;
    const categoryFilter = req.query.accounting_category ? String(req.query.accounting_category).trim() : undefined;
    const preciousMetalsFilter = req.query.precious_metals ? String(req.query.precious_metals).trim() : undefined;
    const warrantyFilter = req.query.is_under_warranty ? String(req.query.is_under_warranty).trim() : undefined;

    // Dimensions filters for furniture (length, width, height)
    const lengthMin = req.query.length_min ? Number(req.query.length_min) : undefined;
    const lengthMax = req.query.length_max ? Number(req.query.length_max) : undefined;
    const widthMin = req.query.width_min ? Number(req.query.width_min) : undefined;
    const widthMax = req.query.width_max ? Number(req.query.width_max) : undefined;
    const heightMin = req.query.height_min ? Number(req.query.height_min) : undefined;
    const heightMax = req.query.height_max ? Number(req.query.height_max) : undefined;

    // Fetch equipment items with joins (leftJoin rooms/types so items without a room remain visible)
    let query = db
      .select({
        id: equipment.id,
        inventory_number: equipment.inventory_number,
        name: equipment.name,
        type_id: equipment.type_id,
        typeName: equipmentTypes.name,
        recived: equipment.recived,
        initial_cost: equipment.initial_cost,
        residual_cost: equipment.residual_cost,
        room_id: equipment.room_id,
        roomNumber: rooms.number,
        roomFloor: rooms.floor,
        additional_fields: equipment.additional_fields,
        writeoffState: equipmentWriteoffs.state,
        writeoffDate: equipmentWriteoffs.writeoff_date,
      })
      .from(equipment)
      .leftJoin(equipmentTypes, eq(equipment.type_id, equipmentTypes.id))
      .leftJoin(rooms, eq(equipment.room_id, rooms.id))
      .leftJoin(equipmentWriteoffs, eq(equipment.id, equipmentWriteoffs.equipment_id))
      .$dynamic();

    const conditions: any[] = [];

    // Search filter across name, inventory number, DB ID, and opaque QR token
    if (search) {
      const cleanIdStr = search.trim().replace(/^#/, '');
      const parsedSearchId = /^\d+$/.test(cleanIdStr) ? Number(cleanIdStr) : null;
      const decodedQr = decodeOpaqueQrToken(search);
      const searchConds: any[] = [
        ilike(equipment.name, `%${search}%`),
        ilike(equipment.inventory_number, `%${search}%`),
      ];
      if (parsedSearchId && Number.isSafeInteger(parsedSearchId) && parsedSearchId > 0) {
        searchConds.push(eq(equipment.id, parsedSearchId));
      }
      if (decodedQr?.kind === 'equipment') {
        searchConds.push(eq(equipment.id, decodedQr.id));
      }
      conditions.push(or(...searchConds));
    }

    if (typeId && Number.isInteger(typeId) && typeId > 0) {
      const allTypes = await db
        .select({ id: equipmentTypes.id, parent_id: equipmentTypes.parent_id })
        .from(equipmentTypes);

      const childrenByParent = new Map<number, number[]>();
      for (const t of allTypes) {
        if (t.parent_id !== null && t.parent_id !== undefined) {
          const pId = Number(t.parent_id);
          const list = childrenByParent.get(pId) || [];
          list.push(Number(t.id));
          childrenByParent.set(pId, list);
        }
      }

      const targetTypeIds = new Set<number>([typeId]);
      const queue = [typeId];
      while (queue.length > 0) {
        const current = queue.shift()!;
        const children = childrenByParent.get(current) || [];
        for (const childId of children) {
          if (!targetTypeIds.has(childId)) {
            targetTypeIds.add(childId);
            queue.push(childId);
          }
        }
      }

      conditions.push(inArray(equipment.type_id, Array.from(targetTypeIds)));
    }

    if (String(req.query.room_id || '').toUpperCase() === 'NONE') {
      conditions.push(isNull(equipment.room_id));
    } else if (roomId && Number.isInteger(roomId) && roomId > 0) {
      conditions.push(eq(equipment.room_id, roomId));
    }

    if (receivedFrom && !isNaN(receivedFrom.getTime())) {
      conditions.push(gte(equipment.recived, receivedFrom));
    }

    if (receivedTo && !isNaN(receivedTo.getTime())) {
      conditions.push(lte(equipment.recived, receivedTo));
    }

    // Written-off filter
    if (writeoffState) {
      conditions.push(eq(equipmentWriteoffs.state, writeoffState as any));
    } else if (!includeWrittenOff) {
      conditions.push(
        or(
          isNull(equipmentWriteoffs.state),
          sql`${equipmentWriteoffs.state} != 'WRITTEN_OFF'`
        )
      );
    }

    if (conditions.length > 0) {
      query = query.where(and(...conditions));
    }

    const allMatched = await query.orderBy(desc(equipment.id));

    // Post-filter with dynamic computed warranty and dimension attributes
    let filtered = allMatched.map((item: any) => ({
      ...item,
      additional_fields: computeDynamicWarranty(item.additional_fields),
    }));

    if (search) {
      const q = search.toLowerCase();
      const qId = q.replace(/^#/, '');
      const decodedQr = decodeOpaqueQrToken(search);
      filtered = filtered.filter((item: any) => {
        if (decodedQr?.kind === 'equipment' && item.id === decodedQr.id) return true;
        if (String(item.id) === qId) return true;
        if (item.name?.toLowerCase().includes(q)) return true;
        if (item.inventory_number?.toLowerCase().includes(q)) return true;
        if (item.additional_fields?.description?.toLowerCase().includes(q)) return true;
        if (item.additional_fields?.location_place?.toLowerCase().includes(q)) return true;
        if (item.additional_fields?.color?.toLowerCase().includes(q)) return true;
        if (item.additional_fields?.notes?.toLowerCase().includes(q)) return true;
        return false;
      });
    }

    if (hasUnrepairedIssue) {
      const unrepairedIssues = await db
        .select({ equipment_id: equipmentIssues.equipment_id })
        .from(equipmentIssues)
        .where(isNull(equipmentIssues.repaired_at));
      const eqIdsWithIssues = new Set(unrepairedIssues.map((i: any) => i.equipment_id));
      filtered = filtered.filter((item: any) => eqIdsWithIssues.has(item.id));
    }

    if (activeTransferOnly || transferredTo) {
      const activeTransfers = await db
        .select()
        .from(equipmentTransfers)
        .where(isNull(equipmentTransfers.returned_at));

      const transferMap = new Map<number, (typeof activeTransfers)[0]>();
      activeTransfers.forEach((t: any) => transferMap.set(t.equipment_id, t));

      filtered = filtered.filter((item: any) => {
        const transfer = transferMap.get(item.id);
        if (!transfer) return false;
        if (transferredTo) {
          return transfer.issued_to.toLowerCase().includes(transferredTo.toLowerCase());
        }
        return true;
      });
    }

    // Color filter
    if (colorFilter) {
      filtered = filtered.filter((item: any) => {
        const itemColor = (item.additional_fields?.color || '').toLowerCase();
        return itemColor.includes(colorFilter);
      });
    }

    // Status filter (Действует / На хранении)
    if (statusFilter && statusFilter !== 'ALL') {
      filtered = filtered.filter((item: any) => {
        const itemStatus = (item.additional_fields?.status || '').toLowerCase();
        return itemStatus === statusFilter.toLowerCase();
      });
    }

    // Condition filter (Рабочее / Есть нюансы / Вышло из строя / Неремонтопригодно)
    if (conditionFilter && conditionFilter !== 'ALL') {
      filtered = filtered.filter((item: any) => {
        const itemCond = (item.additional_fields?.condition || '').toLowerCase();
        return itemCond.includes(conditionFilter.toLowerCase());
      });
    }

    // Accounting Category filter (Без категории / Дорогостоящее / Малоценка / Мягкий инвентарь)
    if (categoryFilter && categoryFilter !== 'ALL') {
      filtered = filtered.filter((item: any) => {
        const itemCat = (item.additional_fields?.accounting_category || 'Без категории').toLowerCase();
        return itemCat === categoryFilter.toLowerCase();
      });
    }

    // Precious Metals filter (true / false)
    if (preciousMetalsFilter && preciousMetalsFilter !== 'ALL') {
      const wantMetals = preciousMetalsFilter === 'true' || preciousMetalsFilter === 'да';
      filtered = filtered.filter((item: any) => {
        return Boolean(item.additional_fields?.precious_metals) === wantMetals;
      });
    }

    // Warranty filter (true / false with dynamic calculation)
    if (warrantyFilter && warrantyFilter !== 'ALL') {
      const wantWarranty = warrantyFilter === 'true' || warrantyFilter === 'да';
      filtered = filtered.filter((item: any) => {
        return Boolean(item.additional_fields?.is_under_warranty) === wantWarranty;
      });
    }

    // Dimensions filters (length, width, height) - can filter individually or combined!
    if (lengthMin !== undefined && !isNaN(lengthMin)) {
      filtered = filtered.filter((item: any) => {
        const len = item.additional_fields?.length_cm;
        return len !== null && len !== undefined && len >= lengthMin;
      });
    }
    if (lengthMax !== undefined && !isNaN(lengthMax)) {
      filtered = filtered.filter((item: any) => {
        const len = item.additional_fields?.length_cm;
        return len !== null && len !== undefined && len <= lengthMax;
      });
    }

    if (widthMin !== undefined && !isNaN(widthMin)) {
      filtered = filtered.filter((item: any) => {
        const w = item.additional_fields?.width_cm;
        return w !== null && w !== undefined && w >= widthMin;
      });
    }
    if (widthMax !== undefined && !isNaN(widthMax)) {
      filtered = filtered.filter((item: any) => {
        const w = item.additional_fields?.width_cm;
        return w !== null && w !== undefined && w <= widthMax;
      });
    }

    if (heightMin !== undefined && !isNaN(heightMin)) {
      filtered = filtered.filter((item: any) => {
        const h = item.additional_fields?.height_cm;
        return h !== null && h !== undefined && h >= heightMin;
      });
    }
    if (heightMax !== undefined && !isNaN(heightMax)) {
      filtered = filtered.filter((item: any) => {
        const h = item.additional_fields?.height_cm;
        return h !== null && h !== undefined && h <= heightMax;
      });
    }

    if (customFieldCode && (customFieldValue || customFieldMin || customFieldMax)) {
      let fieldDataType: string | undefined;
      if (typeId && Number.isInteger(typeId) && typeId > 0) {
        const typeDefs = await getAllAdditionalFieldsForType(typeId);
        fieldDataType = typeDefs.find((f) => f.code === customFieldCode)?.data_type;
      }
      if (!fieldDataType) {
        const [matchedDef] = await db
          .select({ data_type: additionalFields.data_type })
          .from(additionalFields)
          .where(and(eq(additionalFields.code, customFieldCode), eq(additionalFields.is_active, true)))
          .limit(1);
        fieldDataType = matchedDef?.data_type;
      }

      const parseNum = (v: any): number | null => {
        if (v === undefined || v === null || v === '' || typeof v === 'boolean') return null;
        const n = typeof v === 'number' ? v : Number(String(v).trim().replace(',', '.'));
        return Number.isFinite(n) ? n : null;
      };

      const normalizeYmd = (v: any): string | null => {
        if (v === undefined || v === null || v === '') return null;
        if (v instanceof Date && !isNaN(v.getTime())) {
          return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
        }
        const str = String(v).trim();
        const isoMatch = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
        const ruMatch = str.match(/^(\d{2})\.(\d{2})\.(\d{4})/);
        if (ruMatch) return `${ruMatch[3]}-${ruMatch[2]}-${ruMatch[1]}`;
        const parsed = new Date(str);
        if (!isNaN(parsed.getTime())) {
          return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`;
        }
        return null;
      };

      const isDateField =
        fieldDataType === 'DATE' ||
        (!fieldDataType &&
          Boolean(
            (customFieldMin && /^\d{4}-\d{2}-\d{2}$/.test(customFieldMin)) ||
              (customFieldMax && /^\d{4}-\d{2}-\d{2}$/.test(customFieldMax))
          ));
      const isNumericField =
        fieldDataType === 'NUMBER' ||
        fieldDataType === 'INTEGER' ||
        (!fieldDataType && !isDateField && Boolean(customFieldMin || customFieldMax));

      filtered = filtered.filter((item: any) => {
        const rawVal = item.additional_fields?.[customFieldCode];
        if (rawVal === undefined || rawVal === null || rawVal === '') return false;
        const values = Array.isArray(rawVal) ? rawVal : [rawVal];
        if (values.length === 0) return false;

        if (isDateField && (customFieldMin || customFieldMax)) {
          const minYmd = customFieldMin ? normalizeYmd(customFieldMin) : null;
          const maxYmd = customFieldMax ? normalizeYmd(customFieldMax) : null;
          return values.some((v: any) => {
            const itemYmd = normalizeYmd(v);
            if (!itemYmd) return false;
            if (minYmd && itemYmd < minYmd) return false;
            if (maxYmd && itemYmd > maxYmd) return false;
            return true;
          });
        }

        if (isNumericField && (customFieldMin || customFieldMax)) {
          const minNum = customFieldMin ? parseNum(customFieldMin) : null;
          const maxNum = customFieldMax ? parseNum(customFieldMax) : null;
          return values.some((v: any) => {
            const n = parseNum(v);
            if (n === null) return false;
            if (minNum !== null && n < minNum) return false;
            if (maxNum !== null && n > maxNum) return false;
            return true;
          });
        }

        if (fieldDataType === 'BOOLEAN' && customFieldValue) {
          const wantBool = customFieldValue === 'true' || customFieldValue === '1' || customFieldValue.toLowerCase() === 'да';
          return values.some((v: any) => {
            const b = v === true || v === 'true' || v === '1' || String(v).toLowerCase() === 'да';
            return b === wantBool;
          });
        }

        if (customFieldValue) {
          const needle = customFieldValue.toLowerCase();
          return values.some((v: any) => String(v).toLowerCase().includes(needle));
        }

        return true;
      });
    }

    const total = filtered.length;
    const paginatedItems = filtered.slice(offset, offset + limit).map((item: any) => {
      if (!isRegularUser) return item;
      return {
        ...item,
        writeoffState: null,
        writeoffDate: null,
      };
    });

    res.json({
      items: paginatedItems,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    });
  } catch (error: any) {
    console.error('Fetch equipment error:', error);
    res.status(500).json({ error: 'Ошибка загрузки списка оборудования' });
  }
});

// Download Department Excel Template matching accountant specification
// Must be registered BEFORE /api/equipment/:id so Express doesn't treat 'excel-template' as :id
app.get('/api/equipment/excel-template', requireAuth, (_req, res) => {
  try {
    const headers = [
      'Инвентарный номер',
      'Наименование (по бухгалтерии)',
      'Дата принятия к учету',
      'Первоначальная стоимость',
      'Остаточная стоимость',
      'Помещение',
      'Место',
      'Размеры (Д*Ш*В), см',
      'Описание',
      'Цвет',
      'Тип оборудования',
      'Статус',
      'Состояние',
      'Категория (по бухучету)',
      'Содержание драгметаллов',
      'Гарантия истекает',
      'Примечание',
    ];

    const sampleRows = [
      {
        'Инвентарный номер': 'INV-2019-011',
        'Наименование (по бухгалтерии)': 'Лазерный принтер HP LJ 1020 белый',
        'Дата принятия к учету': '2019-04-12',
        'Первоначальная стоимость': 650.0,
        'Остаточная стоимость': 185.0,
        'Помещение': '305',
        'Место': 'Стол секретаря',
        'Размеры (Д*Ш*В), см': '',
        'Описание': 'Лазерный принтер HP LJ 1020 белый',
        'Цвет': 'белый',
        'Тип оборудования': 'Периферия',
        'Статус': 'Действует',
        'Состояние': 'Рабочее',
        'Категория (по бухучету)': 'Дорогостоящее',
        'Содержание драгметаллов': 'Да',
        'Гарантия истекает': '',
        'Примечание': '',
      },
      {
        'Инвентарный номер': 'INV-2021-045',
        'Наименование (по бухгалтерии)': 'Центральный стол на 12 мест',
        'Дата принятия к учету': '2021-08-20',
        'Первоначальная стоимость': 1850.0,
        'Остаточная стоимость': 1200.0,
        'Помещение': '302',
        'Место': 'Центральный стол на 12 мест',
        'Размеры (Д*Ш*В), см': '560*200*140',
        'Описание': '',
        'Цвет': 'серый',
        'Тип оборудования': 'Корпусная мебель',
        'Статус': 'Действует',
        'Состояние': 'Рабочее',
        'Категория (по бухучету)': 'Дорогостоящее',
        'Содержание драгметаллов': 'Нет',
        'Гарантия истекает': '',
        'Примечание': '',
      },
      {
        'Инвентарный номер': 'INV-2020-032',
        'Наименование (по бухгалтерии)': 'Шкаф 3',
        'Дата принятия к учету': '2020-11-15',
        'Первоначальная стоимость': 980.0,
        'Остаточная стоимость': 590.0,
        'Помещение': '302',
        'Место': 'Шкаф 3',
        'Размеры (Д*Ш*В), см': '420*80*250',
        'Описание': '',
        'Цвет': 'серый',
        'Тип оборудования': 'Корпусная мебель',
        'Статус': 'Действует',
        'Состояние': 'Рабочее',
        'Категория (по бухучету)': 'Дорогостоящее',
        'Содержание драгметаллов': 'Нет',
        'Гарантия истекает': '',
        'Примечание': '',
      },
      {
        'Инвентарный номер': 'INV-2024-007',
        'Наименование (по бухгалтерии)': 'Компьютер преподавателя HP ProDesk',
        'Дата принятия к учету': '2024-05-12',
        'Первоначальная стоимость': 2450.0,
        'Остаточная стоимость': 2100.0,
        'Помещение': '309',
        'Место': 'Стол 7',
        'Размеры (Д*Ш*В), см': '',
        'Описание': '',
        'Цвет': '',
        'Тип оборудования': 'Компьютер',
        'Статус': 'Действует',
        'Состояние': 'Рабочее',
        'Категория (по бухучету)': 'Дорогостоящее',
        'Содержание драгметаллов': 'Да',
        'Гарантия истекает': '12.05.2027',
        'Примечание': '',
      },
      {
        'Инвентарный номер': 'INV-2020-071',
        'Наименование (по бухгалтерии)': 'Монитор рабочего места',
        'Дата принятия к учету': '2020-03-10',
        'Первоначальная стоимость': 420.0,
        'Остаточная стоимость': 160.0,
        'Помещение': '309',
        'Место': 'Стол 7',
        'Размеры (Д*Ш*В), см': '',
        'Описание': '',
        'Цвет': '',
        'Тип оборудования': 'Периферия',
        'Статус': 'Действует',
        'Состояние': 'Рабочее',
        'Категория (по бухучету)': 'Дорогостоящее',
        'Содержание драгметаллов': 'Да',
        'Гарантия истекает': '',
        'Примечание': '',
      },
      {
        'Инвентарный номер': 'INV-2022-194',
        'Наименование (по бухгалтерии)': 'Кресло офисное подъёмно-поворотное',
        'Дата принятия к учету': '2022-09-18',
        'Первоначальная стоимость': 290.0,
        'Остаточная стоимость': 165.0,
        'Помещение': '305',
        'Место': 'Стол 10',
        'Размеры (Д*Ш*В), см': '',
        'Описание': 'Кресло офисное подъёмно-поворотное',
        'Цвет': 'черный',
        'Тип оборудования': 'Стул (газлифт)',
        'Статус': 'Действует',
        'Состояние': 'Рабочее',
        'Категория (по бухучету)': 'Малоценка',
        'Содержание драгметаллов': 'Нет',
        'Гарантия истекает': '',
        'Примечание': '',
      },
    ];

    const ws = XLSX.utils.json_to_sheet(sampleRows, { header: headers });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Оборудование кафедры');
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="shablon-ucheta-kafedry.xlsx"'
    );
    res.send(buffer);
  } catch (error: any) {
    console.error('Error generating Excel template:', error);
    res.status(500).json({ error: error.message });
  }
});

// Export selected equipment rows (from Equipment or Writeoffs tables) to XLSX
// Must be registered BEFORE /api/equipment/:id
app.post('/api/equipment/export-excel', requireAuth, async (req: AuthRequest, res) => {
  try {
    const rawIds = req.body?.equipment_ids;
    const source = req.body?.source === 'writeoff' ? 'writeoff' : 'equipment';

    if (!Array.isArray(rawIds) || rawIds.length === 0) {
      return res.status(400).json({ error: 'Выберите хотя бы одну строку для экспорта в Excel' });
    }

    const ids: number[] = [];
    const seen = new Set<number>();
    for (const val of rawIds) {
      const n = Number(val);
      if (Number.isInteger(n) && n > 0 && !seen.has(n)) {
        seen.add(n);
        ids.push(n);
      }
      if (ids.length >= 5000) break;
    }

    if (ids.length === 0) {
      return res.status(400).json({ error: 'Переданы некорректные идентификаторы оборудования' });
    }

    const rows = await db
      .select({
        id: equipment.id,
        inventory_number: equipment.inventory_number,
        name: equipment.name,
        type_id: equipment.type_id,
        typeName: equipmentTypes.name,
        room_id: equipment.room_id,
        roomNumber: rooms.number,
        roomFloor: rooms.floor,
        recived: equipment.recived,
        initial_cost: equipment.initial_cost,
        residual_cost: equipment.residual_cost,
        additional_fields: equipment.additional_fields,
        writeoffState: equipmentWriteoffs.state,
        writeoffDate: equipmentWriteoffs.writeoff_date,
      })
      .from(equipment)
      .leftJoin(equipmentTypes, eq(equipment.type_id, equipmentTypes.id))
      .leftJoin(rooms, eq(equipment.room_id, rooms.id))
      .leftJoin(equipmentWriteoffs, eq(equipment.id, equipmentWriteoffs.equipment_id))
      .where(inArray(equipment.id, ids));

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Выбранное оборудование не найдено в базе данных' });
    }

    const rowById = new Map<number, any>(rows.map((r: any) => [r.id, r]));
    const orderedRows: any[] = ids.map((id) => rowById.get(id)).filter((r): r is any => Boolean(r));
    const isRegularUser = req.user?.role === 'USER';

    const STANDARD_KEYS = new Set([
      'location_place',
      'dimensions',
      'length_cm',
      'width_cm',
      'height_cm',
      'description',
      'color',
      'status',
      'condition',
      'accounting_category',
      'precious_metals',
      'warranty_until',
      'is_under_warranty',
      'warranty_expired',
      'warranty_status_ru',
      'notes',
      'quantity',
      'is_kit_part',
    ]);

    const allDynamicDefs = await db.select().from(additionalFields);
    const defByCode = new Map<string, any>();
    for (const def of allDynamicDefs) {
      if (!defByCode.has(def.code)) {
        defByCode.set(def.code, def);
      }
    }

    const extraCodesPresent: string[] = [];
    const seenExtraCodes = new Set<string>();
    for (const item of orderedRows) {
      const af = item.additional_fields && typeof item.additional_fields === 'object' ? item.additional_fields : {};
      for (const [code, val] of Object.entries(af)) {
        if (STANDARD_KEYS.has(code) || seenExtraCodes.has(code)) continue;
        const isEmpty =
          val === undefined ||
          val === null ||
          val === '' ||
          (Array.isArray(val) && val.length === 0);
        if (!isEmpty) {
          seenExtraCodes.add(code);
          extraCodesPresent.push(code);
        }
      }
    }

    const formatIsoDate = (val: any): string => {
      if (!val) return '';
      if (typeof val === 'string') {
        const prefix = val.trim().match(/^(\d{4}-\d{2}-\d{2})/);
        if (prefix) return prefix[1];
      }
      const d = new Date(val);
      return isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
    };

    const writeoffStateLabel = (state: string | null | undefined): string => {
      if (state === 'PREPARING') return 'Готовится к списанию';
      if (state === 'DOCUMENTS_PREPARATION') return 'Подготовка документов';
      if (state === 'WRITTEN_OFF') return 'Списано с баланса';
      return '';
    };

    const writeoffCaseLabel = (c: 'case1' | 'case2' | 'case3' | null): string => {
      if (c === 'case1') return 'Кейс 1 (Дорогост. • ДМ)';
      if (c === 'case2') return 'Кейс 2 (Малоценка • ДМ)';
      if (c === 'case3') return 'Кейс 3 (Малоценка без ДМ)';
      return 'Без кейса списания';
    };

    const baseHeaders = [
      'ID',
      'Инвентарный номер',
      'Наименование (по бухгалтерии)',
      'Тип оборудования',
      'Помещение',
      'Этаж',
      'Место',
      'Дата принятия к учету',
      'Первоначальная стоимость',
      'Остаточная стоимость',
      'Количество',
      'Размеры (Д*Ш*В), см',
      'Цвет',
      'Описание',
      'Статус',
      'Состояние',
      'Категория (по бухучету)',
      'Содержание драгметаллов',
      'Гарантия истекает',
      'Оборудование на гарантии',
      'Примечание',
    ];

    if (!isRegularUser) {
      baseHeaders.push('Статус списания', 'Дата списания');
      if (source === 'writeoff') {
        baseHeaders.push('Кейс списания');
      }
    }

    const usedHeaderSet = new Set(baseHeaders);
    const extraHeadersMap = new Map<string, string>();
    for (const code of extraCodesPresent) {
      const def = defByCode.get(code);
      let candidate = def?.title ? String(def.title).trim() : code;
      if (usedHeaderSet.has(candidate)) {
        candidate = `${candidate} (${code})`;
      }
      usedHeaderSet.add(candidate);
      extraHeadersMap.set(code, candidate);
      baseHeaders.push(candidate);
    }

    const sheetRows = orderedRows.map((item: any) => {
      const af = computeDynamicWarranty(item.additional_fields || {});
      const qtyNum = Number(af.quantity);
      const rowObj: Record<string, any> = {
        'ID': item.id,
        'Инвентарный номер': sanitizeSpreadsheetCell(item.inventory_number ?? ''),
        'Наименование (по бухгалтерии)': sanitizeSpreadsheetCell(item.name ?? ''),
        'Тип оборудования': sanitizeSpreadsheetCell(item.typeName || 'Без типа'),
        'Помещение': sanitizeSpreadsheetCell(item.roomNumber ?? ''),
        'Этаж': item.roomFloor !== null && item.roomFloor !== undefined ? Number(item.roomFloor) : '',
        'Место': sanitizeSpreadsheetCell(af.location_place ?? ''),
        'Дата принятия к учету': formatIsoDate(item.recived),
        'Первоначальная стоимость':
          item.initial_cost !== null && item.initial_cost !== undefined
            ? Number(item.initial_cost)
            : 0,
        'Остаточная стоимость':
          item.residual_cost !== null && item.residual_cost !== undefined
            ? Number(item.residual_cost)
            : '',
        'Количество': Number.isFinite(qtyNum) && qtyNum > 0 ? qtyNum : 1,
        'Размеры (Д*Ш*В), см': sanitizeSpreadsheetCell(af.dimensions ?? ''),
        'Цвет': sanitizeSpreadsheetCell(af.color ?? ''),
        'Описание': sanitizeSpreadsheetCell(af.description ?? ''),
        'Статус': sanitizeSpreadsheetCell(af.status || 'Действует'),
        'Состояние': sanitizeSpreadsheetCell(af.condition || 'Рабочее'),
        'Категория (по бухучету)': sanitizeSpreadsheetCell(af.accounting_category || 'Без категории'),
        'Содержание драгметаллов': af.precious_metals ? 'Да' : 'Нет',
        'Гарантия истекает': formatIsoDate(af.warranty_until),
        'Оборудование на гарантии': af.is_under_warranty ? 'Да' : 'Нет',
        'Примечание': sanitizeSpreadsheetCell(af.notes ?? ''),
      };

      if (!isRegularUser) {
        rowObj['Статус списания'] = writeoffStateLabel(item.writeoffState);
        rowObj['Дата списания'] = formatIsoDate(item.writeoffDate);
        if (source === 'writeoff') {
          const detectedCase = detectEquipmentWriteoffCase(item);
          rowObj['Кейс списания'] = writeoffCaseLabel(detectedCase);
        }
      }

      for (const code of extraCodesPresent) {
        const header = extraHeadersMap.get(code)!;
        const val = af[code];
        const def = defByCode.get(code);
        if (val === undefined || val === null || val === '') {
          rowObj[header] = '';
        } else if (Array.isArray(val)) {
          rowObj[header] = sanitizeSpreadsheetCell(val.join(', '));
        } else if (def?.data_type === 'BOOLEAN' || typeof val === 'boolean') {
          rowObj[header] = val === true || val === 'true' ? 'Да' : 'Нет';
        } else if (
          (def?.data_type === 'INTEGER' || def?.data_type === 'NUMBER') &&
          typeof val === 'number' &&
          Number.isFinite(val)
        ) {
          rowObj[header] = val;
        } else {
          rowObj[header] = sanitizeSpreadsheetCell(val);
        }
      }

      return rowObj;
    });

    const ws = XLSX.utils.json_to_sheet(sheetRows, { header: baseHeaders });
    ws['!cols'] = baseHeaders.map((h) => {
      let maxLen = h.length;
      for (const row of sheetRows) {
        const len = String(row[h] ?? '').length;
        if (len > maxLen) maxLen = len;
      }
      return { wch: Math.min(45, Math.max(12, maxLen + 3)) };
    });

    const wb = XLSX.utils.book_new();
    const sheetName = source === 'writeoff' ? 'Списание' : 'Оборудование';
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    const dateTag = new Date().toISOString().slice(0, 10);
    const filePrefix = source === 'writeoff' ? 'export-spisanie' : 'export-oborudovanie';

    await logAuditEvent({
      req,
      action: 'EQUIPMENT_EXPORT_EXCEL',
      category: source === 'writeoff' ? 'WRITEOFF' : 'EQUIPMENT',
      severity: 'INFO',
      entityType: source === 'writeoff' ? 'writeoff' : 'equipment',
      entityLabel: `${sheetName} (${orderedRows.length} поз.)`,
      summary: `Экспорт в Excel (${sheetName}): выгружено ${orderedRows.length} выбранных позиций`,
      details: { source, count: orderedRows.length, equipmentIds: orderedRows.map((r: any) => r.id) },
    });

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${filePrefix}-${dateTag}.xlsx"`
    );
    res.send(buffer);
  } catch (error: any) {
    console.error('Error exporting equipment to Excel:', error);
    res.status(500).json({ error: error.message || 'Ошибка экспорта данных в Excel' });
  }
});

// Resolve scanned QR URL / code / inventory number / ID directly on server (without 200-item client cap)
// Must be registered BEFORE /api/equipment/:id
app.get('/api/equipment/resolve/:code', requireAuth, async (req: AuthRequest, res) => {
  try {
    let rawCode = String(req.params.code || '').trim();
    if (!rawCode) {
      return res.status(400).json({ error: 'Укажите код или инвентарный номер' });
    }

    if (rawCode.includes('/q/')) {
      rawCode = rawCode.split('/q/').pop()!.split('?')[0].split('#')[0].trim();
    } else if (rawCode.includes('openEquipment=')) {
      const m = rawCode.match(/openEquipment=(\d+)/i);
      if (m) rawCode = m[1];
    } else if (rawCode.includes('openGroup=')) {
      const m = rawCode.match(/openGroup=([^&#]+)/i);
      if (m) rawCode = decodeURIComponent(m[1]).trim();
    }

    if (!rawCode) {
      return res.status(400).json({ error: 'Не удалось распознать код оборудования' });
    }

    // Check signed opaque QR token first (new stealth format without URLs or sequential IDs)
    const decodedOpaque = decodeOpaqueQrToken(rawCode);
    if (decodedOpaque) {
      if (decodedOpaque.kind === 'group') {
        const [batch] = await db
          .select({ code: equipmentBatches.code, name: equipmentBatches.name })
          .from(equipmentBatches)
          .where(eq(equipmentBatches.id, decodedOpaque.id))
          .limit(1);

        if (batch) {
          return res.json({ kind: 'group', code: batch.code, name: batch.name });
        }
        return res.status(404).json({ error: 'Партия оборудования по данному QR-коду не найдена' });
      }

      const [itemByToken] = await db
        .select({ id: equipment.id, name: equipment.name, inventory_number: equipment.inventory_number })
        .from(equipment)
        .where(eq(equipment.id, decodedOpaque.id))
        .limit(1);

      if (itemByToken) {
        return res.json({
          kind: 'equipment',
          id: itemByToken.id,
          name: itemByToken.name,
          inventory_number: itemByToken.inventory_number,
        });
      }
      return res.status(404).json({ error: 'Оборудование по данному QR-коду не найдено' });
    }

    if (/^(GRP|BATCH)-/i.test(rawCode)) {
      const [batch] = await db
        .select({ code: equipmentBatches.code, name: equipmentBatches.name })
        .from(equipmentBatches)
        .where(or(eq(equipmentBatches.code, rawCode), ilike(equipmentBatches.code, rawCode)))
        .limit(1);

      if (batch) {
        return res.json({ kind: 'group', code: batch.code, name: batch.name });
      }
      return res.status(404).json({ error: `Партия оборудования «${rawCode}» не найдена` });
    }

    let cleanId = rawCode.replace(/^#/, '');
    if (/^EQ-\d+$/i.test(cleanId)) {
      cleanId = cleanId.replace(/^EQ-/i, '');
    }

    if (/^\d+$/.test(cleanId)) {
      const numericId = Number(cleanId);
      if (Number.isSafeInteger(numericId) && numericId > 0) {
        const [itemById] = await db
          .select({ id: equipment.id, name: equipment.name, inventory_number: equipment.inventory_number })
          .from(equipment)
          .where(eq(equipment.id, numericId))
          .limit(1);

        if (itemById) {
          return res.json({
            kind: 'equipment',
            id: itemById.id,
            name: itemById.name,
            inventory_number: itemById.inventory_number,
          });
        }
      }
    }

    const [itemByInv] = await db
      .select({ id: equipment.id, name: equipment.name, inventory_number: equipment.inventory_number })
      .from(equipment)
      .where(
        or(
          eq(equipment.inventory_number, rawCode),
          eq(equipment.inventory_number, cleanId),
          ilike(equipment.inventory_number, rawCode)
        )
      )
      .limit(1);

    if (itemByInv) {
      return res.json({
        kind: 'equipment',
        id: itemByInv.id,
        name: itemByInv.name,
        inventory_number: itemByInv.inventory_number,
      });
    }

    return res.status(404).json({ error: `Объект «${rawCode}» не найден в базе данных кафедры` });
  } catch (error: any) {
    console.error('Resolve QR code error:', error);
    res.status(500).json({ error: 'Ошибка поиска оборудования по коду' });
  }
});

// Single Equipment Details
// Note: "При сканировании QR кода открывается персональная страница с информацией о данном оборудовании. Незарегистрированный пользователь ничего не видит." (PDF page 3)
// "Пользователь не видит никакой информации о списании." (PDF page 10)
app.get('/api/equipment/:id', async (req: AuthRequest, res, next) => {
  if (!/^\d+$/.test(req.params.id)) {
    return next();
  }
  return requireAuth(req, res, next);
}, async (req: AuthRequest, res) => {
  try {
    const eqId = Number(req.params.id);

    const [item] = await db
      .select({
        id: equipment.id,
        inventory_number: equipment.inventory_number,
        name: equipment.name,
        type_id: equipment.type_id,
        typeName: equipmentTypes.name,
        recived: equipment.recived,
        initial_cost: equipment.initial_cost,
        residual_cost: equipment.residual_cost,
        room_id: equipment.room_id,
        roomNumber: rooms.number,
        roomFloor: rooms.floor,
        additional_fields: equipment.additional_fields,
        writeoffState: equipmentWriteoffs.state,
        writeoffDate: equipmentWriteoffs.writeoff_date,
      })
      .from(equipment)
      .leftJoin(equipmentTypes, eq(equipment.type_id, equipmentTypes.id))
      .leftJoin(rooms, eq(equipment.room_id, rooms.id))
      .leftJoin(equipmentWriteoffs, eq(equipment.id, equipmentWriteoffs.equipment_id))
      .where(eq(equipment.id, eqId))
      .limit(1);

    if (!item) {
      return res.status(404).json({ error: 'Оборудование не найдено' });
    }

    // Active issues
    const activeIssues = await db
      .select()
      .from(equipmentIssues)
      .where(
        and(
          eq(equipmentIssues.equipment_id, eqId),
          isNull(equipmentIssues.repaired_at)
        )
      )
      .orderBy(desc(equipmentIssues.broken_at));

    // Active transfer
    const [activeTransfer] = await db
      .select()
      .from(equipmentTransfers)
      .where(
        and(
          eq(equipmentTransfers.equipment_id, eqId),
          isNull(equipmentTransfers.returned_at)
        )
      )
      .limit(1);

    // Active audit verification check for current user (Auditor)
    let currentAuditVerification: any = null;
    if (req.user && ['ADMIN', 'ENGINEER'].includes(req.user.role)) {
      const [activeAudit] = await db
        .select()
        .from(inventories)
        .where(
          and(
            eq(inventories.auditor_ext_id, req.user.id),
            isNull(inventories.finished_at)
          )
        )
        .limit(1);

      if (activeAudit) {
        const [verif] = await db
          .select()
          .from(verifications)
          .where(
            and(
              eq(verifications.inventory_id, activeAudit.id),
              eq(verifications.equipment_id, eqId)
            )
          )
          .limit(1);

        currentAuditVerification = {
          auditId: activeAudit.id,
          isVerified: Boolean(verif?.verified_at),
          verifiedAt: verif?.verified_at || null,
        };
      }
    }

    // Field definitions
    const fieldsDefinitions = await getAllAdditionalFieldsForType(item.type_id);

    // User privacy filter: USER does not see writeoff data
    const isRegularUser = req.user?.role === 'USER';

    res.json({
      ...item,
      qrCode: encodeEquipmentQrToken(item.id),
      additional_fields: computeDynamicWarranty(item.additional_fields),
      writeoffState: isRegularUser ? null : item.writeoffState,
      writeoffDate: isRegularUser ? null : item.writeoffDate,
      activeIssues,
      activeTransfer: isRegularUser ? null : activeTransfer || null,
      currentAuditVerification,
      fieldsDefinitions,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

function formatEquipmentDbError(error: any): string {
  const code = error?.code || error?.cause?.code;
  const msg = String(error?.message || '');
  if (code === '23505' || msg.includes('unique constraint') || msg.includes('UNIQUE constraint')) {
    return 'Оборудование с таким инвентарным номером уже зарегистрировано в системе. Укажите другой инвентарный номер.';
  }
  if (code === '23503' || msg.includes('foreign key constraint')) {
    return 'Указанный тип оборудования или помещение не найдены в справочнике. Обновите страницу и выберите значения из списка.';
  }
  if (code === '22P02' || code === '22003') {
    return 'Проверьте правильность числовых полей и дат — одно из значений имеет неверный формат.';
  }
  return 'Не удалось сохранить данные оборудования. Проверьте заполненные поля и повторите попытку.';
}

async function ensureDefaultEquipmentType(): Promise<{ id: number; name: string }> {
  const allTypes = await db.select().from(equipmentTypes);
  const existing = allTypes.find((t: any) => t.name.trim().toLowerCase() === 'без типа');
  if (existing) {
    return { id: Number(existing.id), name: existing.name };
  }
  const [created] = await db
    .insert(equipmentTypes)
    .values({ name: 'Без типа', parent_id: null })
    .returning();
  return { id: Number(created.id), name: created.name };
}

// Create Equipment (Admin only)
app.post('/api/equipment', requireAuth, requireRole('ADMIN'), async (req, res) => {
  try {
    const {
      inventory_number,
      name,
      type_id,
      recived,
      initial_cost,
      residual_cost,
      room_id,
      additional_fields,
    } = req.body;

    const formErrors: string[] = [];
    const trimmedInv =
      inventory_number === undefined || inventory_number === null
        ? ''
        : String(inventory_number).trim();
    const finalInventoryNumber: string | null = trimmedInv || null;
    const trimmedName = String(name || '').trim();

    const hasTypeId = type_id !== undefined && type_id !== null && String(type_id).trim() !== '';
    const numericTypeId = hasTypeId ? Number(type_id) : NaN;

    const hasRoomId = room_id !== undefined && room_id !== null && String(room_id).trim() !== '';
    const numericRoomId = hasRoomId ? Number(room_id) : null;

    const hasRecived = recived !== undefined && recived !== null && String(recived).trim() !== '';
    const recivedDate = hasRecived ? new Date(recived) : null;

    if (!trimmedName) {
      formErrors.push('Укажите наименование оборудования.');
    }
    if (hasTypeId && (!Number.isInteger(numericTypeId) || numericTypeId <= 0)) {
      formErrors.push('Выберите корректный тип оборудования из списка.');
    }
    if (hasRoomId && (!Number.isInteger(numericRoomId) || numericRoomId! <= 0)) {
      formErrors.push('Выберите корректное помещение (аудиторию).');
    }
    if (hasRecived && (!recivedDate || isNaN(recivedDate.getTime()))) {
      formErrors.push('Укажите корректную дату принятия к учёту.');
    }

    const parsedInitialCost =
      initial_cost === '' || initial_cost === undefined || initial_cost === null
        ? 0
        : Number(String(initial_cost).replace(',', '.'));
    const hasResidualCost =
      residual_cost !== '' && residual_cost !== undefined && residual_cost !== null;
    const parsedResidualCost = hasResidualCost
      ? Number(String(residual_cost).replace(',', '.'))
      : null;

    if (isNaN(parsedInitialCost) || parsedInitialCost < 0) {
      formErrors.push('Первоначальная стоимость должна быть неотрицательным числом (например: 1210.23).');
    }
    if (parsedResidualCost !== null && (isNaN(parsedResidualCost) || parsedResidualCost < 0)) {
      formErrors.push('Остаточная стоимость должна быть неотрицательным числом (например: 0.00).');
    }

    if (formErrors.length > 0) {
      return res.status(400).json({
        error: formErrors[0],
        details: formErrors,
      });
    }

    // Verify referenced type & room exist (or resolve default 'Без типа' if type omitted)
    let resolvedType: { id: number; name: string } | undefined;
    if (hasTypeId) {
      const [foundType] = await db
        .select()
        .from(equipmentTypes)
        .where(eq(equipmentTypes.id, numericTypeId))
        .limit(1);
      if (!foundType) {
        return res.status(400).json({
          error: 'Выбранный тип оборудования не найден. Обновите страницу и выберите тип заново.',
        });
      }
      resolvedType = { id: Number(foundType.id), name: foundType.name };
    } else {
      resolvedType = await ensureDefaultEquipmentType();
    }

    if (numericRoomId !== null) {
      const [foundRoom] = await db
        .select()
        .from(rooms)
        .where(eq(rooms.id, numericRoomId))
        .limit(1);
      if (!foundRoom) {
        return res.status(400).json({
          error: 'Выбранное помещение не найдено. Обновите страницу и выберите аудиторию заново.',
        });
      }
    }

    const afObj = additional_fields || {};
    const allowedCategories = ['Без категории', 'Дорогостоящее', 'Малоценка', 'Мягкий инвентарь'];
    const rawCat =
      afObj.accounting_category === undefined ||
      afObj.accounting_category === null ||
      String(afObj.accounting_category).trim() === ''
        ? 'Без категории'
        : String(afObj.accounting_category).trim();
    if (!allowedCategories.includes(rawCat)) {
      formErrors.push('Укажите корректную категорию (по бухучету).');
    }

    const pmVal = afObj.precious_metals;
    let normalizedPm = false;
    if (pmVal !== undefined && pmVal !== null && pmVal !== '') {
      if (typeof pmVal === 'boolean') {
        normalizedPm = pmVal;
      } else if (pmVal === 'true' || pmVal === '1') {
        normalizedPm = true;
      } else if (pmVal === 'false' || pmVal === '0') {
        normalizedPm = false;
      } else {
        formErrors.push('Укажите корректное значение для поля «Содержание драгметаллов» (Да или Нет).');
      }
    }

    if (formErrors.length > 0) {
      return res.status(400).json({
        error: formErrors[0],
        details: formErrors,
      });
    }

    // Validate additional fields
    const normalizedInputFields = {
      status: 'Действует',
      condition: 'Рабочее',
      quantity: 1,
      ...afObj,
      accounting_category: rawCat,
      precious_metals: normalizedPm,
    };
    const validation = await validateAdditionalFields(
      resolvedType.id,
      normalizedInputFields,
      { typeName: resolvedType.name }
    );

    if (!validation.isValid) {
      return res.status(400).json({
        error: 'Проверьте правильность заполнения дополнительных полей',
        details: validation.errors,
      });
    }

    const normalizedFields = prepareAdditionalFieldsForStorage(normalizedInputFields);

    const [created] = await db
      .insert(equipment)
      .values({
        inventory_number: finalInventoryNumber,
        name: trimmedName,
        type_id: resolvedType.id,
        recived: recivedDate,
        initial_cost: Math.round(parsedInitialCost * 100) / 100,
        residual_cost:
          parsedResidualCost === null ? null : Math.round(parsedResidualCost * 100) / 100,
        room_id: numericRoomId,
        additional_fields: normalizedFields,
      })
      .returning();

    const invLabel = created.inventory_number || 'б/н';
    await logAuditEvent({
      req,
      action: 'EQUIPMENT_CREATE',
      category: 'EQUIPMENT',
      severity: 'INFO',
      entityType: 'equipment',
      entityId: created.id,
      entityLabel: `${invLabel} — ${created.name}`,
      summary: `Добавлено оборудование «${created.name}» (${created.inventory_number ? `инв. № ${created.inventory_number}` : 'без инв. №'})`,
      details: {
        id: created.id,
        inventory_number: created.inventory_number,
        typeName: resolvedType.name,
        room_id: created.room_id,
        initial_cost: created.initial_cost,
      },
    });

    res.status(201).json({
      ...created,
      additional_fields: computeDynamicWarranty(created.additional_fields),
    });
  } catch (error: any) {
    console.error('Create equipment error:', error);
    res.status(500).json({ error: formatEquipmentDbError(error) });
  }
});

// Update Equipment (Admin only)
app.put('/api/equipment/:id', requireAuth, requireRole('ADMIN'), async (req, res) => {
  try {
    const eqId = Number(req.params.id);
    if (!Number.isInteger(eqId) || eqId <= 0) {
      return res.status(400).json({ error: 'Некорректный идентификатор оборудования.' });
    }

    const [existingItem] = await db
      .select()
      .from(equipment)
      .where(eq(equipment.id, eqId))
      .limit(1);

    if (!existingItem) {
      return res.status(404).json({
        error: 'Оборудование не найдено (возможно, оно уже было удалено).',
      });
    }

    const {
      inventory_number,
      name,
      type_id,
      recived,
      initial_cost,
      residual_cost,
      room_id,
      additional_fields,
    } = req.body;

    const formErrors: string[] = [];
    const hasTypeIdProvided = type_id !== undefined && type_id !== null && String(type_id).trim() !== '';
    let effectiveTypeId = hasTypeIdProvided ? Number(type_id) : existingItem.type_id;

    if (name !== undefined && !String(name).trim()) {
      formErrors.push('Наименование оборудования не может быть пустым.');
    }
    if (hasTypeIdProvided && (!Number.isInteger(effectiveTypeId) || effectiveTypeId <= 0)) {
      formErrors.push('Выберите корректный тип оборудования.');
    }

    const hasRoomIdProvided =
      room_id !== undefined && room_id !== null && String(room_id).trim() !== '';
    if (hasRoomIdProvided && (!Number.isInteger(Number(room_id)) || Number(room_id) <= 0)) {
      formErrors.push('Выберите корректное помещение (аудиторию).');
    }

    const hasRecivedProvided =
      recived !== undefined && recived !== null && String(recived).trim() !== '';
    if (hasRecivedProvided) {
      const parsedDate = new Date(recived);
      if (isNaN(parsedDate.getTime())) {
        formErrors.push('Укажите корректную дату принятия к учёту.');
      }
    }
    if (initial_cost !== undefined && initial_cost !== '' && initial_cost !== null) {
      const c = Number(String(initial_cost).replace(',', '.'));
      if (isNaN(c) || c < 0) {
        formErrors.push('Первоначальная стоимость должна быть неотрицательным числом.');
      }
    }
    if (residual_cost !== undefined && residual_cost !== '' && residual_cost !== null) {
      const c = Number(String(residual_cost).replace(',', '.'));
      if (isNaN(c) || c < 0) {
        formErrors.push('Остаточная стоимость должна быть неотрицательным числом.');
      }
    }

    if (formErrors.length > 0) {
      return res.status(400).json({
        error: formErrors[0],
        details: formErrors,
      });
    }

    let normalizedAfPayload: Record<string, any> | undefined;
    if (additional_fields !== undefined) {
      const afObj = additional_fields || {};
      const allowedCategories = ['Без категории', 'Дорогостоящее', 'Малоценка', 'Мягкий инвентарь'];
      const normalizedCat =
        !Object.prototype.hasOwnProperty.call(afObj, 'accounting_category') ||
        afObj.accounting_category === '' ||
        afObj.accounting_category === null ||
        afObj.accounting_category === undefined
          ? 'Без категории'
          : String(afObj.accounting_category).trim();

      if (!allowedCategories.includes(normalizedCat)) {
        return res.status(400).json({
          error: 'Укажите корректную категорию (по бухучету).',
        });
      }

      let normalizedPm: any = afObj.precious_metals;
      if (
        !Object.prototype.hasOwnProperty.call(afObj, 'precious_metals') ||
        afObj.precious_metals === '' ||
        afObj.precious_metals === null ||
        afObj.precious_metals === undefined
      ) {
        normalizedPm = false;
      } else if (
        typeof afObj.precious_metals !== 'boolean' &&
        afObj.precious_metals !== 'true' &&
        afObj.precious_metals !== 'false'
      ) {
        return res.status(400).json({
          error: 'Укажите корректное значение для поля «Содержание драгметаллов» (Да или Нет).',
        });
      } else {
        normalizedPm = afObj.precious_metals === true || afObj.precious_metals === 'true';
      }

      normalizedAfPayload = {
        ...afObj,
        accounting_category: normalizedCat,
        precious_metals: normalizedPm,
      };
    }

    let resolvedType: { id: number; name: string };
    if (type_id !== undefined && (type_id === null || String(type_id).trim() === '')) {
      resolvedType = await ensureDefaultEquipmentType();
      effectiveTypeId = resolvedType.id;
    } else {
      const [foundType] = await db
        .select()
        .from(equipmentTypes)
        .where(eq(equipmentTypes.id, effectiveTypeId))
        .limit(1);
      if (!foundType) {
        return res.status(400).json({
          error: 'Выбранный тип оборудования не найден в справочнике.',
        });
      }
      resolvedType = { id: Number(foundType.id), name: foundType.name };
    }

    if (hasRoomIdProvided) {
      const [foundRoom] = await db
        .select()
        .from(rooms)
        .where(eq(rooms.id, Number(room_id)))
        .limit(1);
      if (!foundRoom) {
        return res.status(400).json({
          error: 'Выбранное помещение не найдено в справочнике.',
        });
      }
    }

    // Validate additional fields if provided
    if (normalizedAfPayload !== undefined) {
      const preservedKeys = Object.keys(
        (existingItem.additional_fields as Record<string, any>) || {}
      );
      const validation = await validateAdditionalFields(
        effectiveTypeId,
        normalizedAfPayload,
        {
          preservedKeys,
          typeName: resolvedType.name,
        }
      );
      if (!validation.isValid) {
        return res.status(400).json({
          error: 'Проверьте правильность заполнения дополнительных полей',
          details: validation.errors,
        });
      }
    }

    const updateData: any = {};
    if (inventory_number !== undefined) {
      const trimmed = inventory_number === null ? '' : String(inventory_number).trim();
      updateData.inventory_number = trimmed || null;
    }
    if (name !== undefined) updateData.name = String(name).trim();
    if (type_id !== undefined) updateData.type_id = effectiveTypeId;
    if (recived !== undefined) {
      updateData.recived = hasRecivedProvided ? new Date(recived) : null;
    }
    if (initial_cost !== undefined) {
      const val =
        initial_cost === '' || initial_cost === null
          ? 0
          : Number(String(initial_cost).replace(',', '.'));
      updateData.initial_cost = Math.round(val * 100) / 100;
    }
    if (residual_cost !== undefined) {
      if (residual_cost === '' || residual_cost === null) {
        updateData.residual_cost = null;
      } else {
        const val = Number(String(residual_cost).replace(',', '.'));
        updateData.residual_cost = Math.round(val * 100) / 100;
      }
    }
    if (room_id !== undefined) {
      updateData.room_id = hasRoomIdProvided ? Number(room_id) : null;
    }
    if (normalizedAfPayload !== undefined) {
      updateData.additional_fields = prepareAdditionalFieldsForStorage(normalizedAfPayload);
    }

    const [updated] = await db
      .update(equipment)
      .set(updateData)
      .where(eq(equipment.id, eqId))
      .returning();

    const changedKeys = Object.keys(updateData);
    await logAuditEvent({
      req,
      action: 'EQUIPMENT_UPDATE',
      category: 'EQUIPMENT',
      severity: 'INFO',
      entityType: 'equipment',
      entityId: updated.id,
      entityLabel: `${updated.inventory_number || 'б/н'} — ${updated.name}`,
      summary: `Обновлена карточка оборудования «${updated.name}» (${changedKeys.length} изм.)`,
      details: {
        changedFields: changedKeys,
        before: {
          name: existingItem.name,
          inventory_number: existingItem.inventory_number,
          room_id: existingItem.room_id,
          initial_cost: existingItem.initial_cost,
          residual_cost: existingItem.residual_cost,
        },
        after: {
          name: updated.name,
          inventory_number: updated.inventory_number,
          room_id: updated.room_id,
          initial_cost: updated.initial_cost,
          residual_cost: updated.residual_cost,
        },
      },
    });

    res.json({
      ...updated,
      additional_fields: computeDynamicWarranty(updated.additional_fields),
    });
  } catch (error: any) {
    console.error('Update equipment error:', error);
    res.status(500).json({ error: formatEquipmentDbError(error) });
  }
});

// Delete Equipment (Admin only)
app.delete('/api/equipment/:id', requireAuth, requireRole('ADMIN'), async (req, res) => {
  try {
    const eqId = Number(req.params.id);
    if (!Number.isInteger(eqId) || eqId <= 0) {
      return res.status(400).json({ error: 'Некорректный идентификатор оборудования' });
    }
    const deleted = await db
      .delete(equipment)
      .where(eq(equipment.id, eqId))
      .returning({
        id: equipment.id,
        inventory_number: equipment.inventory_number,
        name: equipment.name,
      });
    if (deleted.length === 0) {
      return res.status(404).json({ error: 'Оборудование не найдено или уже удалено' });
    }

    await logAuditEvent({
      req,
      action: 'EQUIPMENT_DELETE',
      category: 'EQUIPMENT',
      severity: 'CRITICAL',
      entityType: 'equipment',
      entityId: deleted[0].id,
      entityLabel: `${deleted[0].inventory_number} — ${deleted[0].name}`,
      summary: `Удалено оборудование «${deleted[0].name}» (инв. № ${deleted[0].inventory_number})`,
      details: { deletedItem: deleted[0] },
    });

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Bulk Delete Equipment (Admin only)
app.post('/api/equipment/bulk-delete', requireAuth, requireRole('ADMIN'), async (req, res) => {
  try {
    const { equipment_ids } = req.body;
    if (!Array.isArray(equipment_ids) || equipment_ids.length === 0) {
      return res.status(400).json({ error: 'Не выбрано ни одной единицы оборудования' });
    }
    const ids = equipment_ids.map((id: any) => Number(id)).filter((n: number) => Number.isInteger(n) && n > 0);
    if (ids.length === 0) {
      return res.status(400).json({ error: 'Некорректные идентификаторы оборудования' });
    }
    const deletedRows = await db
      .delete(equipment)
      .where(inArray(equipment.id, ids))
      .returning({
        id: equipment.id,
        inventory_number: equipment.inventory_number,
        name: equipment.name,
      });

    await logAuditEvent({
      req,
      action: 'EQUIPMENT_BULK_DELETE',
      category: 'EQUIPMENT',
      severity: 'CRITICAL',
      entityType: 'equipment',
      entityId: ids.join(','),
      entityLabel: `Массовое удаление (${deletedRows.length} ед.)`,
      summary: `Массово удалено ${deletedRows.length} единиц оборудования`,
      details: { count: deletedRows.length, deletedIds: deletedRows.map((d: any) => d.id) },
    });

    res.json({ success: true, deletedCount: ids.length });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// 4. QR CODES & DOCX EXPORT
// ==========================================

// Generate QR-Codes DOCX file
// Spec (PDF page 3): "В списке оборудования Администратор или Инженер должен иметь возможность выбрать несколько единиц оборудования из списка, нажать кнопку “Сгенерировать QR-коды” - в результате получает docx файл с данными QR-кодами для их дальнейшей распечатки."
app.post('/api/equipment/qr-docx', requireAuth, requireRole('ADMIN', 'ENGINEER'), async (req, res) => {
  try {
    const { equipment_ids, qr_size_cm } = req.body;
    if (!Array.isArray(equipment_ids) || equipment_ids.length === 0) {
      return res.status(400).json({ error: 'Выберите хотя бы одну единицу оборудования' });
    }

    let qrSizeCm = 3;
    if (qr_size_cm !== undefined && qr_size_cm !== null && qr_size_cm !== '') {
      const parsed = Number(String(qr_size_cm).replace(',', '.'));
      if (!Number.isFinite(parsed) || parsed < 0.8 || parsed > 10) {
        return res.status(400).json({ error: 'Размер QR-кода должен быть от 0.8 до 10 см' });
      }
      qrSizeCm = Math.round(parsed * 10) / 10;
    }

    const ids = equipment_ids.map(Number).filter((id) => Number.isInteger(id) && id > 0);
    if (ids.length === 0) {
      return res.status(400).json({ error: 'Некорректные идентификаторы оборудования' });
    }

    const items = await db
      .select({
        id: equipment.id,
        inventory_number: equipment.inventory_number,
        name: equipment.name,
        typeName: equipmentTypes.name,
        roomNumber: rooms.number,
        initial_cost: equipment.initial_cost,
        residual_cost: equipment.residual_cost,
        recived: equipment.recived,
      })
      .from(equipment)
      .leftJoin(equipmentTypes, eq(equipment.type_id, equipmentTypes.id))
      .leftJoin(rooms, eq(equipment.room_id, rooms.id))
      .where(inArray(equipment.id, ids));

    const baseUrl = getPublicBaseUrl(req);
    const formatted = items.map((i: any) => ({
      ...i,
      qrCode: encodeEquipmentQrToken(i.id),
      recivedDate: i.recived ? new Date(i.recived).toLocaleDateString('ru-RU') : '—',
    }));

    const docxBuffer = await generateQrDocx(formatted, baseUrl, { qrSizeCm });

    await logAuditEvent({
      req,
      action: 'QR_DOCX',
      category: 'DOCUMENT',
      severity: 'INFO',
      entityType: 'equipment',
      entityId: ids.join(','),
      entityLabel: `QR-этикетки (${formatted.length} ед., ${qrSizeCm}×${qrSizeCm} см)`,
      summary: `Сформирован DOCX с QR-этикетками для ${formatted.length} ед. (размер ${qrSizeCm}×${qrSizeCm} см)`,
      details: { count: formatted.length, qrSizeCm, equipmentIds: ids },
    });

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="equipment-qr-${qrSizeCm}cm.docx"`
    );
    res.send(docxBuffer);
  } catch (error: any) {
    console.error('Error generating QR DOCX:', error);
    res.status(500).json({ error: 'Ошибка генерации DOCX файла с QR-кодами' });
  }
});

// Create Group QR Code for multiple items (e.g. tables, chairs)
app.post('/api/equipment/qr-group', requireAuth, requireRole('ADMIN', 'ENGINEER'), async (req: AuthRequest, res) => {
  try {
    const { equipment_ids, name } = req.body;
    if (!Array.isArray(equipment_ids) || equipment_ids.length === 0) {
      return res.status(400).json({ error: 'Выберите хотя бы одну единицу оборудования' });
    }

    const ids = equipment_ids.map(Number).filter((id) => !isNaN(id) && id > 0);
    const items = await db
      .select({
        id: equipment.id,
        name: equipment.name,
        inventory_number: equipment.inventory_number,
        room_id: equipment.room_id,
        roomNumber: rooms.number,
      })
      .from(equipment)
      .leftJoin(rooms, eq(equipment.room_id, rooms.id))
      .where(inArray(equipment.id, ids));

    if (items.length === 0) {
      return res.status(404).json({ error: 'Оборудование не найдено' });
    }

    const randomSuffix = Math.floor(1000 + Math.random() * 9000);
    const year = new Date().getFullYear();
    const code = `GRP-${year}-${randomSuffix}`;
    const roomSuffix = items[0].roomNumber ? ` — ауд. ${items[0].roomNumber}` : '';
    const autoName = name && name.trim()
      ? name.trim()
      : `Комплект: ${items.length} шт. («${items[0].name}»${items.length > 1 ? ` и др.${roomSuffix}` : ''})`;

    const [batch] = await db
      .insert(equipmentBatches)
      .values({
        code,
        name: autoName,
        equipment_ids: ids,
        room_id: items[0]?.room_id || null,
      })
      .returning();

    const qrCode = encodeGroupQrToken(batch.id);

    await logAuditEvent({
      req,
      action: 'QR_GROUP_CREATE',
      category: 'DOCUMENT',
      severity: 'INFO',
      entityType: 'batch',
      entityId: batch.code,
      entityLabel: batch.name,
      summary: `Создан групповой QR партии ${batch.code} (${items.length} ед.)`,
      details: { code: batch.code, itemsCount: items.length, equipmentIds: ids },
    });

    res.status(201).json({
      ...batch,
      qrCode,
      itemsCount: items.length,
      items,
    });
  } catch (error: any) {
    console.error('Error creating group QR:', error);
    res.status(500).json({ error: error.message || 'Ошибка создания группового QR-кода' });
  }
});

// Get Group QR Batch Info
app.get('/api/equipment/qr-group/:code', requireAuth, async (req: AuthRequest, res) => {
  try {
    const code = req.params.code;
    const [batch] = await db
      .select()
      .from(equipmentBatches)
      .where(eq(equipmentBatches.code, code))
      .limit(1);

    if (!batch) {
      return res.status(404).json({ error: 'Партия оборудования не найдена' });
    }

    const ids = Array.isArray(batch.equipment_ids) ? batch.equipment_ids : [];
    const items = ids.length > 0
      ? await db
          .select({
            id: equipment.id,
            inventory_number: equipment.inventory_number,
            name: equipment.name,
            typeName: equipmentTypes.name,
            roomNumber: rooms.number,
            initial_cost: equipment.initial_cost,
            residual_cost: equipment.residual_cost,
            recived: equipment.recived,
          })
          .from(equipment)
          .leftJoin(equipmentTypes, eq(equipment.type_id, equipmentTypes.id))
          .leftJoin(rooms, eq(equipment.room_id, rooms.id))
          .where(inArray(equipment.id, ids))
      : [];

    res.json({
      batch,
      qrCode: encodeGroupQrToken(batch.id),
      items,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Download Group QR DOCX card
app.get('/api/equipment/qr-group/:code/docx', requireAuth, requireRole('ADMIN', 'ENGINEER'), async (req, res) => {
  try {
    const code = req.params.code;
    const rawSize = req.query.qr_size_cm;
    let qrSizeCm = 3;
    if (rawSize !== undefined && rawSize !== null && String(rawSize).trim() !== '') {
      const parsed = Number(String(rawSize).replace(',', '.'));
      if (!Number.isFinite(parsed) || parsed < 0.8 || parsed > 10) {
        return res.status(400).json({ error: 'Размер QR-кода должен быть от 0.8 до 10 см' });
      }
      qrSizeCm = Math.round(parsed * 10) / 10;
    }

    const [batch] = await db
      .select()
      .from(equipmentBatches)
      .where(eq(equipmentBatches.code, code))
      .limit(1);

    if (!batch) {
      return res.status(404).json({ error: 'Партия оборудования не найдена' });
    }

    const ids = Array.isArray(batch.equipment_ids) ? batch.equipment_ids : [];
    const items = ids.length > 0
      ? await db
          .select({
            id: equipment.id,
            inventory_number: equipment.inventory_number,
            name: equipment.name,
            typeName: equipmentTypes.name,
            roomNumber: rooms.number,
            initial_cost: equipment.initial_cost,
            residual_cost: equipment.residual_cost,
            recived: equipment.recived,
          })
          .from(equipment)
          .leftJoin(equipmentTypes, eq(equipment.type_id, equipmentTypes.id))
          .leftJoin(rooms, eq(equipment.room_id, rooms.id))
          .where(inArray(equipment.id, ids))
      : [];

    const formatted = items.map((i: any) => ({
      ...i,
      recivedDate: i.recived ? new Date(i.recived).toLocaleDateString('ru-RU') : '—',
    }));

    const baseUrl = getPublicBaseUrl(req);
    const docxBuffer = await generateGroupQrDocx(
      {
        id: batch.id,
        qrCode: encodeGroupQrToken(batch.id),
        code: batch.code,
        name: batch.name,
        roomNumber: items[0]?.roomNumber,
        items: formatted,
      },
      baseUrl,
      { qrSizeCm }
    );

    await logAuditEvent({
      req,
      action: 'QR_GROUP_DOCX',
      category: 'DOCUMENT',
      severity: 'INFO',
      entityType: 'batch',
      entityId: batch.code,
      entityLabel: batch.name || batch.code,
      summary: `Сформирована групповая QR-карточка партии ${batch.code} (${formatted.length} ед., ${qrSizeCm}×${qrSizeCm} см)`,
      details: { batchCode: batch.code, count: formatted.length, qrSizeCm },
    });

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="group-qr-${batch.code}.docx"`
    );
    res.send(docxBuffer);
  } catch (error: any) {
    console.error('Error generating group QR docx:', error);
    res.status(500).json({ error: error.message || 'Ошибка генерации DOCX для партии' });
  }
});

// ==========================================
// PROTECTED QR GATEWAY ROUTE (/q/:code)
// Stealth & Anti-DDoS:
// - Strict per-IP rate limit (30 req/min)
// - Unauthenticated visitors receive a sterile bare 404 Not Found
//   with ZERO branding, ZERO department/university hints, and ZERO links
// - Authenticated staff are routed directly to the equipment/group view
// ==========================================
app.get('/q/:code', optionalAuth, async (req: AuthRequest, res) => {
  try {
    const clientIp = extractClientIp(req) || 'unknown';
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');

    const gatewayCheck = checkRateLimit(qrGatewayRateStore, clientIp, 30, 60 * 1000);
    if (!gatewayCheck.allowed) {
      return res
        .status(429)
        .type('text/plain')
        .send('429 Too Many Requests');
    }

    const rawCode = req.params.code?.trim() || '';

    // 1. Unauthorized visitor -> Sterile 404 without site identity, links, or branding
    if (!req.user) {
      const probeCheck = checkRateLimit(qrProbeLogStore, clientIp, 3, 15 * 60 * 1000);
      if (!probeCheck.allowed && probeCheck.retryAfterSec > 0) {
        // Throttled audit logging so DDoS/probing doesn't flood DB
        const existingEntry = qrProbeLogStore.get(clientIp);
        if (existingEntry && existingEntry.count === 3) {
          existingEntry.count += 1;
          await logAuditEvent({
            req,
            actor: { id: null, login: 'Аноним', role: 'ANONYMOUS' },
            action: 'QR_GATEWAY_PROBE',
            category: 'SECURITY',
            severity: 'WARNING',
            entityType: 'gateway',
            entityId: rawCode.slice(0, 64) || null,
            summary: `Множественные неавторизованные запросы к шлюзу QR с IP ${clientIp}`,
            details: { ip: clientIp },
          });
        }
      }

      return res.status(404).type('text/html').send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="robots" content="noindex, nofollow">
  <title>404 Not Found</title>
</head>
<body>
  <h1>404 Not Found</h1>
  <p>The requested URL was not found on this server.</p>
</body>
</html>`);
    }

    // 2. Authorized user: Decode opaque HMAC token first
    const decodedOpaque = decodeOpaqueQrToken(rawCode);
    if (decodedOpaque) {
      if (decodedOpaque.kind === 'group') {
        const [batch] = await db
          .select({ code: equipmentBatches.code })
          .from(equipmentBatches)
          .where(eq(equipmentBatches.id, decodedOpaque.id))
          .limit(1);
        if (batch) {
          return res.redirect(302, `/?openGroup=${encodeURIComponent(batch.code)}`);
        }
      } else {
        const [itemByToken] = await db
          .select({ id: equipment.id })
          .from(equipment)
          .where(eq(equipment.id, decodedOpaque.id))
          .limit(1);
        if (itemByToken) {
          return res.redirect(302, `/?openEquipment=${itemByToken.id}`);
        }
      }
    }

    // 3. Authorized user: Legacy Group batch code
    if (rawCode.startsWith('GRP-') || rawCode.startsWith('grp-') || rawCode.startsWith('BATCH-')) {
      const [batch] = await db
        .select()
        .from(equipmentBatches)
        .where(eq(equipmentBatches.code, rawCode))
        .limit(1);

      if (batch) {
        return res.redirect(302, `/?openGroup=${encodeURIComponent(batch.code)}`);
      }
    }

    // 4. Authorized user: Legacy Equipment identifier ("EQ-10492", "10492", "INV-2022-001")
    let cleanId = rawCode;
    if (/^EQ-\d+$/i.test(rawCode)) {
      cleanId = rawCode.replace(/^EQ-/i, '');
    }

    if (/^\d+$/.test(cleanId)) {
      const [itemById] = await db
        .select({ id: equipment.id })
        .from(equipment)
        .where(eq(equipment.id, Number(cleanId)))
        .limit(1);

      if (itemById) {
        return res.redirect(302, `/?openEquipment=${itemById.id}`);
      }
    }

    const [itemByInv] = await db
      .select({ id: equipment.id })
      .from(equipment)
      .where(
        or(
          eq(equipment.inventory_number, rawCode),
          eq(equipment.inventory_number, cleanId),
          ilike(equipment.inventory_number, rawCode)
        )
      )
      .limit(1);

    if (itemByInv) {
      return res.redirect(302, `/?openEquipment=${itemByInv.id}`);
    }

    return res.status(404).type('text/html').send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="robots" content="noindex, nofollow">
  <title>404 Not Found</title>
</head>
<body>
  <h1>404 Not Found</h1>
  <p>The requested URL was not found on this server.</p>
</body>
</html>`);
  } catch (error: any) {
    console.error('QR Gateway error:', error);
    res.status(500).type('text/plain').send('Internal Server Error');
  }
});

// ==========================================
// 5. EXCEL IMPORT & EXPORT
// ==========================================

// Helper to parse dates from various Excel string/number formats
function parseExcelDate(val: any): string | null {
  if (val === undefined || val === null || val === '') return null;
  if (typeof val === 'number') {
    if (val >= 15000 && val <= 80000) {
      const date = new Date(Math.round((val - 25569) * 86400 * 1000));
      return isNaN(date.getTime()) ? null : date.toISOString().split('T')[0];
    }
    return null;
  }
  const str = String(val).trim();
  if (!str) return null;

  // Handle Excel numeric date serialized as string (e.g. "45793", "46519")
  if (/^\d{5}(\.\d+)?$/.test(str)) {
    const serial = parseFloat(str);
    if (serial >= 15000 && serial <= 80000) {
      const date = new Date(Math.round((serial - 25569) * 86400 * 1000));
      return isNaN(date.getTime()) ? null : date.toISOString().split('T')[0];
    }
  }

  const ruMatch = str.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (ruMatch) {
    const day = ruMatch[1].padStart(2, '0');
    const month = ruMatch[2].padStart(2, '0');
    const year = ruMatch[3];
    return `${year}-${month}-${day}`;
  }
  const isoMatch = str.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})/);
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2].padStart(2, '0')}-${isoMatch[3].padStart(2, '0')}`;
  }
  const d = new Date(str);
  if (!isNaN(d.getTime()) && d.getFullYear() >= 1900 && d.getFullYear() <= 2150) {
    return d.toISOString().split('T')[0];
  }
  return null;
}

const normalizeHeaderKey = (k: string) =>
  k.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();

// Import Equipment from Excel (supports duplicate detection & confirmation modes: ask | skip | update | copy)
app.post('/api/equipment/import-excel', requireAuth, requireRole('ADMIN'), async (req, res) => {
  try {
    const { rows, type_id, duplicate_mode } = req.body;
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ error: 'Таблица пуста или содержит неверный формат' });
    }

    const mode: 'ask' | 'skip' | 'update' | 'copy' =
      duplicate_mode === 'skip' ||
      duplicate_mode === 'update' ||
      duplicate_mode === 'copy'
        ? duplicate_mode
        : 'ask';

    const selectedTypeId = type_id ? Number(type_id) : undefined;
    const errors: string[] = [];
    const newRoomsCreated: string[] = [];
    const newTypesCreated: string[] = [];

    // Fetch existing equipment items for duplicate detection (leftJoin rooms so items without room are included)
    const existingEquipmentRows = await db
      .select({
        id: equipment.id,
        inventory_number: equipment.inventory_number,
        name: equipment.name,
        roomNumber: rooms.number,
      })
      .from(equipment)
      .leftJoin(rooms, eq(equipment.room_id, rooms.id));

    type ExistingRecord = {
      id: number;
      inventory_number: string;
      name: string;
      roomNumber: string;
    };

    const existingByInv = new Map<string, ExistingRecord>();
    const existingByNameRoom = new Map<string, ExistingRecord>();

    for (const r of existingEquipmentRows as any[]) {
      const invClean = String(r.inventory_number || '').trim();
      const rec: ExistingRecord = {
        id: Number(r.id),
        inventory_number: invClean,
        name: String(r.name || ''),
        roomNumber: String(r.roomNumber || ''),
      };
      if (invClean && !existingByInv.has(invClean.toLowerCase())) {
        existingByInv.set(invClean.toLowerCase(), rec);
      }
      const nrKey = `${rec.name.trim().toLowerCase()}||${rec.roomNumber.trim().toLowerCase()}`;
      if (!existingByNameRoom.has(nrKey)) {
        existingByNameRoom.set(nrKey, rec);
      }
    }

    interface ParsedImportRow {
      rowIndex: number;
      rawInvNum: string;
      invNum: string | null;
      name: string;
      cleanRoomStr: string;
      typeNameRaw: string;
      recivedDate: Date | null;
      initialCost: number;
      residualCost: number | null;
      additional_fields: Record<string, any>;
      matchedExisting: ExistingRecord | null;
      matchReason: string | null;
    }

    const parsedRowsList: ParsedImportRow[] = [];
    const duplicateMatches: Array<{
      rowNumber: number;
      inventory_number: string;
      name: string;
      roomNumber: string;
      existingId: number;
      existingInventoryNumber: string;
      existingName: string;
      existingRoom: string;
      matchReason: string;
    }> = [];

    for (let index = 0; index < rows.length; index++) {
      const row = rows[index];

      // Build normalized key lookup map for current row (handles Excel \n wrapped headers)
      const normalizedRow = new Map<string, any>();
      for (const rawKey of Object.keys(row)) {
        normalizedRow.set(normalizeHeaderKey(rawKey), row[rawKey]);
      }

      const getVal = (...keys: string[]) => {
        for (const k of keys) {
          const nk = normalizeHeaderKey(k);
          const v = normalizedRow.get(nk);
          if (v !== undefined && v !== null && String(v).trim() !== '') {
            return String(v).trim();
          }
        }
        return '';
      };

      const rawInvNum = getVal(
        'inventory_number',
        'Инвентарный номер',
        'Инвентарный №',
        'Инв. номер',
        'Инв номер',
        'Инв. №',
        '№ п/п'
      );
      const name = getVal(
        'Наименование (по бухгалтерии)',
        'Наименование',
        'Наименование объекта',
        'name',
        'Название'
      );
      if (!name) {
        errors.push(
          `Строка ${index + 1}: не заполнено обязательное поле «Наименование (по бухгалтерии)»`
        );
        continue;
      }

      const description = getVal('description', 'Описание', 'Краткое описание');
      const locationPlace = getVal('location_place', 'Место', 'Местоположение');
      const dimensionsStr = getVal('dimensions', 'Размеры (Д*Ш*В), см', 'Размеры, см', 'Размеры');
      const color = getVal('color', 'Цвет');
      const typeNameRaw = getVal('type_name', 'Тип оборудования', 'Тип');
      const statusRaw = getVal('status', 'Статус');
      const conditionRaw = getVal('condition', 'Состояние');
      const categoryRaw = getVal('accounting_category', 'Категория (по бухучету)', 'Категория');
      const preciousRaw = getVal('precious_metals', 'Содержание драгметаллов', 'Драгметаллы');
      const warrantyUntilRaw = getVal('warranty_until', 'Гарантия истекает', 'Срок гарантии до');
      const notes = getVal('notes', 'Примечание', 'Примечания');
      const quantityRaw = getVal('Количество', 'Кол-во', 'quantity');

      const cleanRoomStr = getVal('room_number', 'room_id', 'Помещение', 'Кабинет', 'Аудитория');

      const recivedRaw = getVal(
        'recived',
        'received',
        'Дата принятия к учету',
        'Дата ввода в эксплуатацию',
        'Дата ввода',
        'Дата принятия',
        'Дата получения',
        'Дата'
      );
      const initialCostRaw = getVal(
        'initial_cost',
        'Первоначальная стоимость',
        'Балансовая стоимость',
        'Стоимость'
      );
      const residualCostRaw = getVal('residual_cost', 'Остаточная стоимость');

      // Check whether this item already exists in DB (without mutating inventory_number)
      let matchedExisting: ExistingRecord | null = null;
      let matchReason: string | null = null;

      if (rawInvNum) {
        const invHit = existingByInv.get(rawInvNum.toLowerCase());
        if (invHit) {
          matchedExisting = invHit;
          matchReason = 'Совпадает инвентарный номер';
        }
      } else {
        const nrKey = `${name.trim().toLowerCase()}||${cleanRoomStr.toLowerCase()}`;
        const nrHit = existingByNameRoom.get(nrKey);
        if (nrHit) {
          matchedExisting = nrHit;
          matchReason = cleanRoomStr
            ? 'Совпадает наименование и помещение'
            : 'Совпадает наименование';
        }
      }

      if (matchedExisting && matchReason) {
        duplicateMatches.push({
          rowNumber: index + 1,
          inventory_number: rawInvNum || '—',
          name,
          roomNumber: cleanRoomStr || '—',
          existingId: matchedExisting.id,
          existingInventoryNumber: matchedExisting.inventory_number || '—',
          existingName: matchedExisting.name,
          existingRoom: matchedExisting.roomNumber || '—',
          matchReason,
        });
      }

      // Inventory number stays exact as provided, or null if absent (no auto-generation, no suffixes)
      const invNum: string | null = rawInvNum || null;

      // Empty date stays null (not replaced with current date)
      let recivedDate: Date | null = null;
      if (recivedRaw) {
        const parsed = parseExcelDate(recivedRaw);
        if (parsed) {
          recivedDate = new Date(`${parsed}T00:00:00Z`);
        }
      }

      // Initial cost defaults to 0.00 when empty; residual cost stays null when empty
      const parsedInit = initialCostRaw
        ? parseFloat(initialCostRaw.replace(/\s+/g, '').replace(',', '.'))
        : NaN;
      const initialCost = !isNaN(parsedInit) && parsedInit >= 0 ? Math.round(parsedInit * 100) / 100 : 0;

      let residualCost: number | null = null;
      if (residualCostRaw) {
        const parsedRes = parseFloat(residualCostRaw.replace(/\s+/g, '').replace(',', '.'));
        if (!isNaN(parsedRes) && parsedRes >= 0) {
          residualCost = Math.round(parsedRes * 100) / 100;
        }
      }

      let length_cm: number | null = null;
      let width_cm: number | null = null;
      let height_cm: number | null = null;

      if (dimensionsStr) {
        const parts = dimensionsStr
          .split(/[*xхXХ×]/)
          .map((s) => parseFloat(s.trim().replace(',', '.')))
          .filter((n) => !isNaN(n));
        if (parts.length >= 1) length_cm = parts[0];
        if (parts.length >= 2) width_cm = parts[1];
        if (parts.length >= 3) height_cm = parts[2];
      }

      let formattedWarrantyUntil: string | null = null;
      if (warrantyUntilRaw) {
        formattedWarrantyUntil = parseExcelDate(warrantyUntilRaw);
      }

      const preciousMetals =
        preciousRaw.toLowerCase() === 'да' ||
        preciousRaw.toLowerCase() === 'true' ||
        preciousRaw === '1';

      let status = 'Действует';
      if (statusRaw && statusRaw.toLowerCase().includes('хранен')) {
        status = 'На хранении';
      }

      let condition = 'Рабочее';
      if (conditionRaw) {
        const cLow = conditionRaw.toLowerCase();
        if (cLow.includes('нюанс')) condition = 'Есть нюансы';
        else if (cLow.includes('неремонт')) condition = 'Неремонтопригодно';
        else if (cLow.includes('вышл') || cLow.includes('ремонт')) {
          condition = 'Вышло из строя (ремонт возможен)';
        }
      }

      let accounting_category = 'Без категории';
      if (categoryRaw) {
        const catLow = categoryRaw.toLowerCase();
        if (catLow.includes('малоцен')) accounting_category = 'Малоценка';
        else if (catLow.includes('мягк')) accounting_category = 'Мягкий инвентарь';
        else if (catLow.includes('дорогост')) accounting_category = 'Дорогостоящее';
        else if (catLow.includes('без катег')) accounting_category = 'Без категории';
      }

      const parsedQty = quantityRaw
        ? parseInt(String(quantityRaw).replace(/\s+/g, ''), 10)
        : NaN;
      const quantity = !isNaN(parsedQty) && parsedQty >= 1 ? parsedQty : 1;

      const additional_fields: Record<string, any> = {
        location_place: locationPlace || null,
        dimensions: dimensionsStr || null,
        length_cm,
        width_cm,
        height_cm,
        description: description || null,
        color: color || null,
        status,
        condition,
        accounting_category,
        precious_metals: preciousMetals,
        warranty_until: formattedWarrantyUntil,
        notes: notes || null,
        quantity,
      };

      const reservedKeys = new Set([
        'inventory_number', 'инвентарный номер', 'инвентарный №', 'инв. номер', 'инв номер', 'инв. №', '№ п/п',
        'name', 'наименование (по бухгалтерии)', 'наименование', 'наименование объекта', 'название',
        'recived', 'received', 'дата принятия к учету', 'дата ввода в эксплуатацию', 'дата ввода', 'дата принятия', 'дата получения', 'дата',
        'initial_cost', 'первоначальная стоимость', 'балансовая стоимость', 'стоимость',
        'residual_cost', 'остаточная стоимость',
        'количество', 'кол-во', 'quantity',
        'room_number', 'room_id', 'помещение', 'кабинет', 'аудитория',
        'location_place', 'место', 'местоположение',
        'dimensions', 'размеры', 'размеры (д*ш*в), см', 'размеры, см',
        'description', 'описание', 'краткое описание',
        'color', 'цвет',
        'type_name', 'тип оборудования', 'тип',
        'status', 'статус',
        'condition', 'состояние',
        'accounting_category', 'категория', 'категория (по бухучету)',
        'precious_metals', 'содержание драгметаллов', 'драгметаллы',
        'is_under_warranty', 'оборудование на гарантии', 'на гарантии',
        'warranty_until', 'гарантия истекает', 'срок гарантии до',
        'notes', 'примечание', 'примечания'
      ]);

      for (const k of Object.keys(row)) {
        const nk = normalizeHeaderKey(k);
        if (!reservedKeys.has(nk) && row[k] !== undefined && row[k] !== '') {
          additional_fields[k] = row[k];
        }
      }

      parsedRowsList.push({
        rowIndex: index,
        rawInvNum,
        invNum,
        name,
        cleanRoomStr,
        typeNameRaw,
        recivedDate,
        initialCost,
        residualCost,
        additional_fields,
        matchedExisting,
        matchReason,
      });
    }

    if (errors.length > 0) {
      return res.status(400).json({
        error: 'Ошибки валидации таблицы Excel',
        details: errors,
      });
    }

    // Ask user confirmation before touching DB when duplicates exist
    if (mode === 'ask' && duplicateMatches.length > 0) {
      return res.status(200).json({
        requiresConfirmation: true,
        totalRows: rows.length,
        duplicatesCount: duplicateMatches.length,
        newCount: rows.length - duplicateMatches.length,
        duplicates: duplicateMatches,
      });
    }

    // Cache rooms & types before applying confirmed writes
    const allRooms = await db.select().from(rooms);
    const roomMap = new Map<string, number>();
    allRooms.forEach((r: any) => roomMap.set(r.number.trim().toLowerCase(), r.id));

    const allTypes = await db.select().from(equipmentTypes);
    const typeMap = new Map<string, number>();
    allTypes.forEach((t: any) => typeMap.set(t.name.trim().toLowerCase(), t.id));

    const resolveRoomId = async (tx: any, cleanRoomStr: string): Promise<number | null> => {
      if (!cleanRoomStr || !cleanRoomStr.trim()) {
        return null;
      }
      const cleanRoomKey = cleanRoomStr.trim().toLowerCase();
      const existing = roomMap.get(cleanRoomKey);
      if (existing) return existing;
      const parsedNum = parseInt(cleanRoomStr.replace(/\D/g, ''), 10) || 1;
      const floor = Math.max(1, Math.min(10, Math.floor(parsedNum / 100) || 1));
      const [newRoom] = await tx
        .insert(rooms)
        .values({ number: cleanRoomStr.trim(), floor })
        .returning();
      roomMap.set(cleanRoomKey, newRoom.id);
      newRoomsCreated.push(cleanRoomStr.trim());
      return newRoom.id;
    };

    const resolveTypeId = async (tx: any, typeNameRaw: string): Promise<number> => {
      if (selectedTypeId) return selectedTypeId;
      const cleanRaw = (typeNameRaw || '').trim();
      if (!cleanRaw) {
        const existingDefault = typeMap.get('без типа');
        if (existingDefault) return existingDefault;
        const [newType] = await tx
          .insert(equipmentTypes)
          .values({ name: 'Без типа', parent_id: null })
          .returning();
        typeMap.set('без типа', newType.id);
        newTypesCreated.push('Без типа');
        return newType.id;
      }

      let lookupType = cleanRaw.toLowerCase();
      if (lookupType.includes('компьют') || lookupType === 'пк') lookupType = 'компьютер';
      else if (lookupType.includes('ноут')) lookupType = 'ноутбук';
      else if (lookupType.includes('монитор')) lookupType = 'монитор';
      else if (lookupType.includes('корпусн') || lookupType.includes('мебель') || lookupType.includes('шкаф') || lookupType.includes('стол')) lookupType = 'корпусная мебель';
      else if (lookupType.includes('газлифт')) lookupType = 'стулья (газлифт)';
      else if (lookupType.includes('iso')) lookupType = 'стулья iso';
      else if (lookupType.includes('стул')) lookupType = 'стулья прочие';
      else if (lookupType.includes('жалюзи')) lookupType = 'жалюзи';
      else if (lookupType.includes('сетев') || lookupType.includes('коммутатор')) lookupType = 'сетевое оборудование';
      else if (lookupType.includes('программн') || lookupType === 'по') lookupType = 'по (программное обеспечение)';
      else if (lookupType.includes('перифер') || lookupType.includes('принтер') || lookupType.includes('сканер')) lookupType = 'периферия';

      const exactId = typeMap.get(lookupType) ?? typeMap.get(cleanRaw.toLowerCase());
      if (exactId) return exactId;

      for (const [key, id] of typeMap.entries()) {
        if (key === 'без типа') continue;
        if (key.includes(lookupType) || lookupType.includes(key)) {
          return id;
        }
      }

      const [newType] = await tx
        .insert(equipmentTypes)
        .values({ name: cleanRaw, parent_id: null })
        .returning();
      typeMap.set(cleanRaw.toLowerCase(), newType.id);
      newTypesCreated.push(cleanRaw);
      return newType.id;
    };

    let insertedCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;
    const updatedExistingIds = new Set<number>();

    await db.transaction(async (tx: any) => {
      for (const item of parsedRowsList) {
        if (mode === 'skip' && item.matchedExisting) {
          skippedCount++;
          continue;
        }

        const matchedRoomId = await resolveRoomId(tx, item.cleanRoomStr);
        const matchedTypeId = await resolveTypeId(tx, item.typeNameRaw);

        if (
          mode === 'update' &&
          item.matchedExisting &&
          !updatedExistingIds.has(item.matchedExisting.id)
        ) {
          await tx
            .update(equipment)
            .set({
              inventory_number: item.invNum,
              name: item.name,
              type_id: matchedTypeId,
              recived: item.recivedDate,
              initial_cost: item.initialCost,
              residual_cost: item.residualCost,
              room_id: matchedRoomId,
              additional_fields: item.additional_fields,
            })
            .where(eq(equipment.id, item.matchedExisting.id));
          updatedExistingIds.add(item.matchedExisting.id);
          updatedCount++;
          continue;
        }

        // Insert new record keeping inventory_number exact (or null) — no auto-generation or suffixes
        await tx.insert(equipment).values({
          inventory_number: item.invNum,
          name: item.name,
          type_id: matchedTypeId,
          recived: item.recivedDate,
          initial_cost: item.initialCost,
          residual_cost: item.residualCost,
          room_id: matchedRoomId,
          additional_fields: item.additional_fields,
        });
        insertedCount++;
      }
    });

    const summaryParts: string[] = [];
    if (insertedCount > 0) summaryParts.push(`добавлено: ${insertedCount}`);
    if (updatedCount > 0) summaryParts.push(`обновлено: ${updatedCount}`);
    if (skippedCount > 0) summaryParts.push(`пропущено дубликатов: ${skippedCount}`);

    await logAuditEvent({
      req,
      action: 'EQUIPMENT_IMPORT',
      category: 'EQUIPMENT',
      severity: insertedCount > 0 || updatedCount > 0 ? 'WARNING' : 'INFO',
      entityType: 'equipment',
      entityLabel: `Импорт Excel (${rows.length} строк)`,
      summary:
        summaryParts.length > 0
          ? `Импорт из Excel завершён (${summaryParts.join(', ')})`
          : 'Импорт из Excel завершён без новых записей',
      details: {
        duplicateMode: mode,
        totalRows: rows.length,
        insertedCount,
        updatedCount,
        skippedCount,
        createdRooms: newRoomsCreated,
        createdTypes: newTypesCreated,
      },
    });

    res.status(insertedCount > 0 || updatedCount > 0 ? 201 : 200).json({
      success: true,
      message:
        summaryParts.length > 0
          ? `Импорт завершён (${summaryParts.join(', ')}).`
          : 'Новых записей для импорта не найдено.',
      count: insertedCount,
      updatedCount,
      skippedCount,
      createdRooms: newRoomsCreated,
      createdTypes: newTypesCreated,
    });
  } catch (error: any) {
    console.error('Import error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// 6. WRITEOFF LIFECYCLE (Списание)
// ==========================================

// Update Writeoff Status (single or bulk)
// Spec (PDF page 10): "Для каждого оборудования у Администратора должна быть возможность выставить один из следующих статусов - Готовится к списанию (PREPARING), В процессе списания (DOCUMENTS_PREPARATION), Списано (WRITEOFF).
// Статусы можно менять как для одного оборудования в окне с информацией об оборудовании, так и для нескольких сразу - выбрав их из списка оборудования."
app.post('/api/writeoff/update-status', requireAuth, requireRole('ADMIN', 'ENGINEER'), async (req, res) => {
  try {
    const { equipment_ids, state, writeoff_date } = req.body;
    if (!Array.isArray(equipment_ids) || equipment_ids.length === 0 || !state) {
      return res.status(400).json({ error: 'Укажите оборудование и статус списания' });
    }

    if (!['PREPARING', 'DOCUMENTS_PREPARATION', 'WRITTEN_OFF'].includes(state)) {
      return res.status(400).json({ error: 'Недопустимый статус списания' });
    }

    const validIds = equipment_ids
      .map((id: any) => Number(id))
      .filter((id: number) => Number.isInteger(id) && id > 0);
    if (validIds.length === 0) {
      return res.status(400).json({ error: 'Некорректные идентификаторы оборудования' });
    }

    const parsedDate = writeoff_date ? new Date(writeoff_date) : new Date();
    if (state === 'WRITTEN_OFF' && isNaN(parsedDate.getTime())) {
      return res.status(400).json({ error: 'Некорректная дата списания' });
    }
    const date = state === 'WRITTEN_OFF' ? parsedDate : null;

    for (const eqId of validIds) {
      await db
        .insert(equipmentWriteoffs)
        .values({
          equipment_id: eqId,
          state,
          writeoff_date: date,
        })
        .onConflictDoUpdate({
          target: equipmentWriteoffs.equipment_id,
          set: {
            state,
            writeoff_date: date,
          },
        });
    }

    await logAuditEvent({
      req,
      action: 'WRITEOFF_STATUS',
      category: 'WRITEOFF',
      severity: state === 'WRITTEN_OFF' ? 'CRITICAL' : 'WARNING',
      entityType: 'equipment',
      entityId: validIds.join(','),
      entityLabel: `Статус списания → ${state} (${validIds.length} ед.)`,
      summary: `Изменён статус списания на ${state} для ${validIds.length} ед. оборудования`,
      details: { state, equipmentIds: validIds, writeoffDate: date },
    });

    res.json({ success: true, count: validIds.length });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

async function getWriteoffTemplateMap(): Promise<Record<WriteoffTemplateKey, LoadedTemplateState>> {
  const list = await getAllWriteoffTemplates();
  return Object.fromEntries(list.map((t) => [t.key, t])) as Record<
    WriteoffTemplateKey,
    LoadedTemplateState
  >;
}

// List all Writeoff Act & Invoice Templates + Requisites
app.get('/api/writeoff/templates', requireAuth, requireRole('ADMIN', 'ENGINEER'), async (_req, res) => {
  try {
    const list = await getAllWriteoffTemplates();
    res.json({
      templates: list.map(({ customDocxBuffer: _buf, ...rest }) => rest),
    });
  } catch (error: any) {
    console.error('Error listing writeoff templates:', error);
    res.status(500).json({ error: 'Ошибка загрузки шаблонов документов' });
  }
});

// Update structured requisites (Order №, Dates, Officials, Commission, MOL) for a template
app.put('/api/writeoff/templates/:key/requisites', requireAuth, requireRole('ADMIN', 'ENGINEER'), async (req: AuthRequest, res) => {
  try {
    const { key } = req.params;
    if (!isValidWriteoffTemplateKey(key)) {
      return res.status(400).json({ error: 'Некорректный ключ шаблона' });
    }
    const reset = Boolean(req.body?.reset);
    const requisites = reset
      ? WRITEOFF_TEMPLATE_DEFINITIONS[key].defaultRequisites
      : req.body?.requisites || {};
    const actorLogin = req.user?.login || 'system';
    await saveTemplateRequisites(key, requisites, actorLogin);
    const updated = await getWriteoffTemplate(key);
    const { customDocxBuffer: _buf, ...safeTemplate } = updated;

    await logAuditEvent({
      req,
      action: 'WRITEOFF_TEMPLATE_REQUISITES',
      category: 'DOCUMENT',
      severity: 'INFO',
      entityType: 'writeoff_template',
      entityId: key,
      entityLabel: updated.title,
      summary: reset
        ? `Сброшены реквизиты шаблона «${updated.title}» к значениям по умолчанию`
        : `Обновлены реквизиты и должностные лица шаблона «${updated.title}»`,
      details: { key, reset },
    });

    res.json({ success: true, template: safeTemplate });
  } catch (error: any) {
    console.error('Error updating template requisites:', error);
    res.status(500).json({ error: error.message || 'Ошибка сохранения реквизитов шаблона' });
  }
});

// Download editable .docx template (either currently uploaded custom .docx or generated editable template with placeholders)
app.get('/api/writeoff/templates/:key/download', requireAuth, requireRole('ADMIN', 'ENGINEER'), async (req, res) => {
  try {
    const { key } = req.params;
    if (!isValidWriteoffTemplateKey(key)) {
      return res.status(400).json({ error: 'Некорректный ключ шаблона' });
    }
    const tpl = await getWriteoffTemplate(key);
    const fresh = req.query?.fresh === '1' || req.query?.fresh === 'true';

    let buffer: Buffer;
    let fileName: string;
    if (!fresh && tpl.customDocxBuffer) {
      buffer = tpl.customDocxBuffer;
      fileName = tpl.customFileName || tpl.defaultFileName;
    } else {
      buffer = await generateEditableTemplateDocx(key, tpl.requisites);
      fileName = tpl.defaultFileName;
    }

    const safeAsciiName = fileName.replace(/[^a-zA-Z0-9_.-]/g, '_');
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    );
    res.setHeader('Content-Disposition', `attachment; filename="${safeAsciiName}"`);
    res.send(buffer);
  } catch (error: any) {
    console.error('Error downloading editable template:', error);
    res.status(500).json({ error: 'Ошибка выгрузки шаблона .docx' });
  }
});

// Upload edited .docx template file (stored persistently in PostgreSQL)
app.post('/api/writeoff/templates/:key/upload', requireAuth, requireRole('ADMIN', 'ENGINEER'), async (req: AuthRequest, res) => {
  try {
    const { key } = req.params;
    if (!isValidWriteoffTemplateKey(key)) {
      return res.status(400).json({ error: 'Некорректный ключ шаблона' });
    }
    const rawBase64 = String(req.body?.fileBase64 || '').trim();
    const rawFileName = String(req.body?.fileName || '').trim() || WRITEOFF_TEMPLATE_DEFINITIONS[key].defaultFileName;
    if (!rawBase64) {
      return res.status(400).json({ error: 'Не передано содержимое файла .docx' });
    }
    const cleanedBase64 = rawBase64.replace(/^data:[^;]+;base64,/i, '');
    const buffer = Buffer.from(cleanedBase64, 'base64');
    if (buffer.length > 8 * 1024 * 1024) {
      return res.status(400).json({ error: 'Размер файла .docx превышает допустимый лимит 8 МБ' });
    }

    const validation = await validateDocxBuffer(buffer);
    if (!validation.valid) {
      return res.status(400).json({ error: validation.error || 'Некорректный файл .docx' });
    }

    const safeFileName = rawFileName.toLowerCase().endsWith('.docx')
      ? rawFileName.slice(0, 120)
      : `${rawFileName.slice(0, 110)}.docx`;

    const actorLogin = req.user?.login || 'system';
    await saveCustomTemplateDocx(key, buffer, safeFileName, actorLogin);
    const updated = await getWriteoffTemplate(key);
    const { customDocxBuffer: _buf, ...safeTemplate } = updated;

    await logAuditEvent({
      req,
      action: 'WRITEOFF_TEMPLATE_UPLOAD',
      category: 'DOCUMENT',
      severity: 'INFO',
      entityType: 'writeoff_template',
      entityId: key,
      entityLabel: updated.title,
      summary: `Загружен пользовательский Word-шаблон «${safeFileName}» для «${updated.title}»`,
      details: { key, fileName: safeFileName, sizeBytes: buffer.length },
    });

    res.json({ success: true, template: safeTemplate });
  } catch (error: any) {
    console.error('Error uploading custom .docx template:', error);
    res.status(500).json({ error: error.message || 'Ошибка сохранения Word-шаблона' });
  }
});

// Remove custom .docx template and revert to built-in generator
app.delete('/api/writeoff/templates/:key/custom-docx', requireAuth, requireRole('ADMIN', 'ENGINEER'), async (req: AuthRequest, res) => {
  try {
    const { key } = req.params;
    if (!isValidWriteoffTemplateKey(key)) {
      return res.status(400).json({ error: 'Некорректный ключ шаблона' });
    }
    const actorLogin = req.user?.login || 'system';
    await clearCustomTemplateDocx(key, actorLogin);
    const updated = await getWriteoffTemplate(key);
    const { customDocxBuffer: _buf, ...safeTemplate } = updated;

    await logAuditEvent({
      req,
      action: 'WRITEOFF_TEMPLATE_RESET_DOCX',
      category: 'DOCUMENT',
      severity: 'INFO',
      entityType: 'writeoff_template',
      entityId: key,
      entityLabel: updated.title,
      summary: `Сброшен пользовательский .docx шаблон для «${updated.title}» (возврат к встроенному)`,
      details: { key },
    });

    res.json({ success: true, template: safeTemplate });
  } catch (error: any) {
    console.error('Error resetting custom .docx template:', error);
    res.status(500).json({ error: 'Ошибка сброса пользовательского шаблона' });
  }
});

// Download Sample Writeoff Act DOCX (Case 1 example matching accounting template)
app.get('/api/writeoff/sample-act', requireAuth, requireRole('ADMIN', 'ENGINEER'), async (_req, res) => {
  try {
    const sampleItems = [
      {
        id: 991,
        inventory_number: '01383001',
        name: 'Проектор Panasonic',
        typeName: 'Периферия',
        roomNumber: '308',
        initial_cost: 1210.23,
        residual_cost: 0,
        recivedDate: '10.01.2011',
        recivedRaw: '2011-01-10',
        additional_fields: {
          accounting_category: 'Дорогостоящее',
          precious_metals: true,
        },
      },
    ];

    const templatesMap = await getWriteoffTemplateMap();
    const buffer = await renderWriteoffActsFromTemplates(
      { case1: sampleItems, case2: [], case3: [] },
      templatesMap,
      '',
      {
        writeoffDate: '2026-10-21',
        reason: 'начисленная амортизация составляет 100%',
      }
    );

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    );
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="primer-akta-spisaniya-case1.docx"'
    );
    res.send(buffer);
  } catch (error: any) {
    console.error('Error generating sample act:', error);
    res.status(500).json({ error: 'Ошибка формирования примера акта списания' });
  }
});

// Download Sample Transfer Invoice DOCX (ОКУД 0501460 — example with kit components)
app.get('/api/writeoff/sample-invoice', requireAuth, requireRole('ADMIN', 'ENGINEER'), async (_req, res) => {
  try {
    const sampleItems = [
      {
        id: 901,
        inventory_number: '01361207',
        name: 'Монитор SAMTRON',
        typeName: 'Монитор',
        roomNumber: '309',
        initial_cost: 50.82,
        residual_cost: 0,
        recivedDate: '06.06.2002',
        recivedRaw: '2002-06-06',
        additional_fields: { quantity: 1 },
      },
      {
        id: 902,
        inventory_number: '01362923',
        name: 'Системный блок',
        typeName: 'Компьютер',
        roomNumber: '309',
        initial_cost: 877.27,
        residual_cost: 0,
        recivedDate: '10.01.2011',
        recivedRaw: '2011-01-10',
        additional_fields: { quantity: 1 },
      },
      {
        id: 903,
        inventory_number: '01363563',
        name: 'Монитор из комплекта ПЭВМ Apple Mac mini (системный блок, монитор, клавиатура, мышь)',
        typeName: 'Монитор',
        roomNumber: '309',
        initial_cost: 1200,
        residual_cost: 0,
        recivedDate: '10.09.2014',
        recivedRaw: '2014-09-10',
        additional_fields: { quantity: 1, is_kit_part: true },
      },
      {
        id: 904,
        inventory_number: '01363808',
        name: 'Моноблок ITI/23,6-111 Touch мышь, кла-ра',
        typeName: 'Компьютер',
        roomNumber: '309',
        initial_cost: 1390.91,
        residual_cost: 0,
        recivedDate: '10.06.2017',
        recivedRaw: '2017-06-10',
        additional_fields: { quantity: 1 },
      },
    ];

    const templatesMap = await getWriteoffTemplateMap();
    const buffer = await renderInvoicesFromTemplates(
      { case1: sampleItems, case2: [] },
      templatesMap,
      {
        invoiceNumber: '',
        invoiceDate: '2026-10-21',
      }
    );

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    );
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="primer-nakladnoy-CIT-0501460.docx"'
    );
    res.send(buffer);
  } catch (error: any) {
    console.error('Error generating sample invoice:', error);
    res.status(500).json({ error: 'Ошибка формирования примера накладной' });
  }
});

// Download Sample Writeoff Act DOCX (Case 2: Малоценка с ДМ)
app.get('/api/writeoff/sample-act-case2', requireAuth, requireRole('ADMIN', 'ENGINEER'), async (_req, res) => {
  try {
    const sampleItems = [
      {
        id: 995,
        inventory_number: '071001915',
        name: 'Жесткий диск Segate',
        typeName: 'Периферия',
        roomNumber: '308',
        initial_cost: 28.20,
        residual_cost: 0,
        recivedDate: '05.08.2010',
        recivedRaw: '2010-08-05',
        additional_fields: {
          accounting_category: 'Малоценка',
          precious_metals: true,
          quantity: 1,
        },
      },
    ];

    const templatesMap = await getWriteoffTemplateMap();
    const buffer = await renderWriteoffActsFromTemplates(
      { case1: [], case2: sampleItems, case3: [] },
      templatesMap,
      '',
      {
        writeoffDate: '2026-10-21',
      }
    );

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    );
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="primer-akta-malotsenka-case2.docx"'
    );
    res.send(buffer);
  } catch (error: any) {
    console.error('Error generating Case 2 sample act:', error);
    res.status(500).json({ error: 'Ошибка формирования примера акта (Кейс 2)' });
  }
});

// Download Sample Form 434 Invoice DOCX (Case 2: Малоценка)
app.get('/api/writeoff/sample-invoice-case2', requireAuth, requireRole('ADMIN', 'ENGINEER'), async (_req, res) => {
  try {
    const sampleItems = [
      {
        id: 911,
        inventory_number: '0710003219',
        name: 'Источник бесперебойного питания',
        typeName: 'Периферия',
        roomNumber: '309',
        initial_cost: 38.02,
        residual_cost: 0,
        recivedDate: '10.01.2012',
        recivedRaw: '2012-01-10',
        additional_fields: { accounting_category: 'Малоценка', quantity: 1 },
      },
      {
        id: 912,
        inventory_number: '0710010628',
        name: 'Телефонный аппарат Протон',
        typeName: 'Периферия',
        roomNumber: '305',
        initial_cost: 7.10,
        residual_cost: 0,
        recivedDate: '10.01.2011',
        recivedRaw: '2011-01-10',
        additional_fields: { accounting_category: 'Малоценка', quantity: 1 },
      },
      {
        id: 913,
        inventory_number: '071001915',
        name: 'Жесткий диск Segate',
        typeName: 'Периферия',
        roomNumber: '308',
        initial_cost: 28.20,
        residual_cost: 0,
        recivedDate: '05.08.2010',
        recivedRaw: '2010-08-05',
        additional_fields: { accounting_category: 'Малоценка', quantity: 1 },
      },
      {
        id: 914,
        inventory_number: '071002616',
        name: 'DVD-плеер Sony',
        typeName: 'Периферия',
        roomNumber: '308',
        initial_cost: 25.73,
        residual_cost: 0,
        recivedDate: '12.03.2013',
        recivedRaw: '2013-03-12',
        additional_fields: { accounting_category: 'Малоценка', quantity: 1 },
      },
    ];

    const templatesMap = await getWriteoffTemplateMap();
    const buffer = await renderInvoicesFromTemplates(
      { case1: [], case2: sampleItems },
      templatesMap,
      {
        invoiceDate: '2026-10-21',
      }
    );

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    );
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="primer-nakladnoy-forma-434-case2.docx"'
    );
    res.send(buffer);
  } catch (error: any) {
    console.error('Error generating Case 2 sample invoice:', error);
    res.status(500).json({ error: 'Ошибка формирования примера накладной Форма 434' });
  }
});

// Download Sample Writeoff Act DOCX (Case 3: Малоценка без ДМ)
app.get('/api/writeoff/sample-act-case3', requireAuth, requireRole('ADMIN', 'ENGINEER'), async (_req, res) => {
  try {
    const sampleItems = [
      {
        id: 921,
        inventory_number: '07102050750',
        name: 'Кресло Everprof 696 черная сетка б/у',
        typeName: 'Стулья (газлифт)',
        roomNumber: '305',
        initial_cost: 57.09,
        residual_cost: 0,
        recivedDate: '31.05.2023',
        recivedRaw: '2023-05-31',
        additional_fields: {
          accounting_category: 'Малоценка',
          precious_metals: false,
          quantity: 5,
        },
      },
      {
        id: 922,
        inventory_number: '071000617',
        name: 'Контейнер под процессор',
        typeName: 'Корпусная мебель',
        roomNumber: '309',
        initial_cost: 55.40,
        residual_cost: 0,
        recivedDate: '22.01.2003',
        recivedRaw: '2003-01-22',
        additional_fields: {
          accounting_category: 'Малоценка',
          precious_metals: false,
          quantity: 1,
        },
      },
      {
        id: 923,
        inventory_number: '07100513',
        name: 'Доска учебная',
        typeName: 'Корпусная мебель',
        roomNumber: '302',
        initial_cost: 27.15,
        residual_cost: 0,
        recivedDate: '01.07.2016',
        recivedRaw: '2016-07-01',
        additional_fields: {
          accounting_category: 'Малоценка',
          precious_metals: false,
          quantity: 2,
        },
      },
    ];

    const templatesMap = await getWriteoffTemplateMap();
    const buffer = await renderWriteoffActsFromTemplates(
      { case1: [], case2: [], case3: sampleItems },
      templatesMap,
      '',
      {
        writeoffDate: '2026-10-21',
      }
    );

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    );
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="primer-akta-malotsenka-bez-dm-case3.docx"'
    );
    res.send(buffer);
  } catch (error: any) {
    console.error('Error generating Case 3 sample act:', error);
    res.status(500).json({ error: 'Ошибка формирования примера акта (Кейс 3)' });
  }
});

// Generate Writeoff Act DOCX (Supports Case 1: Дорогостоящее + Case 2: Малоценка с ДМ + Case 3: Малоценка без ДМ)
async function handleGenerateActRequest(req: any, res: any) {
  try {
    let rawIds: any[] = [];
    if (Array.isArray(req.body?.equipment_ids)) {
      rawIds = req.body.equipment_ids;
    } else if (req.body?.equipment_id) {
      rawIds = [req.body.equipment_id];
    } else if (req.query?.equipment_ids) {
      rawIds = String(req.query.equipment_ids).split(',');
    } else if (req.query?.equipment_id) {
      rawIds = [req.query.equipment_id];
    } else if (req.params?.id) {
      rawIds = [req.params.id];
    }

    const ids = rawIds.map(Number).filter((id) => !isNaN(id) && id > 0);

    if (ids.length === 0) {
      return res.status(400).json({ error: 'Выберите хотя бы одну единицу оборудования для формирования акта' });
    }

    const items = await db
      .select({
        id: equipment.id,
        inventory_number: equipment.inventory_number,
        name: equipment.name,
        typeName: equipmentTypes.name,
        roomNumber: rooms.number,
        initial_cost: equipment.initial_cost,
        residual_cost: equipment.residual_cost,
        recived: equipment.recived,
        additional_fields: equipment.additional_fields,
        writeoffDate: equipmentWriteoffs.writeoff_date,
      })
      .from(equipment)
      .leftJoin(equipmentTypes, eq(equipment.type_id, equipmentTypes.id))
      .leftJoin(rooms, eq(equipment.room_id, rooms.id))
      .leftJoin(equipmentWriteoffs, eq(equipment.id, equipmentWriteoffs.equipment_id))
      .where(inArray(equipment.id, ids));

    if (items.length === 0) {
      return res.status(404).json({ error: 'Выбранное оборудование не найдено в базе данных' });
    }

    // Preserve selection order
    const itemById = new Map(items.map((it: any) => [it.id, it]));
    const orderedItems = ids.map((id) => itemById.get(id)).filter(Boolean);

    const writeoffDateParam = req.body?.writeoff_date || req.query?.writeoff_date || null;
    const actNumberParam = req.body?.act_number ?? req.query?.act_number ?? '';
    const reasonParam = req.body?.reason || req.query?.reason || 'начисленная амортизация составляет 100%';
    const techConclusionParam = req.body?.technical_conclusion_number || req.query?.technical_conclusion_number || '';
    const organizationParam = req.body?.organization || req.query?.organization || undefined;
    const departmentParam = req.body?.department || req.query?.department || undefined;
    const caseTypeParam = String(req.body?.case_type || req.query?.case_type || 'auto').toLowerCase();

    const formatted = orderedItems.map((i: any) => ({
      ...i,
      recivedDate: i.recived ? new Date(i.recived).toLocaleDateString('ru-RU') : '—',
      recivedRaw: i.recived,
    }));

    const templatesMap = await getWriteoffTemplateMap();

    let buffer: Buffer;
    let resolvedCaseLabel: string;
    let asciiFilename: string;
    let exportedItems = formatted;
    const dateTag = new Date().toISOString().slice(0, 10);

    if (caseTypeParam === 'case1' || caseTypeParam === 'case2' || caseTypeParam === 'case3') {
      resolvedCaseLabel = caseTypeParam;
      buffer = await renderWriteoffActsFromTemplates(
        {
          case1: caseTypeParam === 'case1' ? formatted : [],
          case2: caseTypeParam === 'case2' ? formatted : [],
          case3: caseTypeParam === 'case3' ? formatted : [],
        },
        templatesMap,
        String(actNumberParam || ''),
        {
          writeoffDate: writeoffDateParam,
          actDate: writeoffDateParam,
          reason:
            caseTypeParam === 'case2'
              ? req.body?.reason || req.query?.reason
              : String(reasonParam),
          technicalConclusionNumber: String(techConclusionParam),
          organization: organizationParam ? String(organizationParam) : undefined,
          department: departmentParam ? String(departmentParam) : undefined,
        }
      );
      asciiFilename =
        caseTypeParam === 'case3'
          ? `akt-malotsenka-bez-dm-${formatted.length}-poz-${dateTag}.docx`
          : caseTypeParam === 'case2'
          ? `akt-malotsenka-dm-${formatted.length}-ed-${dateTag}.docx`
          : `akt-spisaniya-${formatted.length}-ed-${dateTag}.docx`;
    } else {
      // Auto mode: detect each item's own writeoff case independently and skip items without a case (OTHER)
      const case1Items: any[] = [];
      const case2Items: any[] = [];
      const case3Items: any[] = [];

      for (const item of formatted) {
        const c = detectEquipmentWriteoffCase(item);
        if (c === 'case1') case1Items.push(item);
        else if (c === 'case2') case2Items.push(item);
        else if (c === 'case3') case3Items.push(item);
      }

      exportedItems = [...case1Items, ...case2Items, ...case3Items];
      if (exportedItems.length === 0) {
        return res.status(400).json({
          error: 'Для выбранного оборудования нет кейса списания — документы не формируются.',
        });
      }

      const presentCases = [
        case1Items.length > 0 ? 'case1' : null,
        case2Items.length > 0 ? 'case2' : null,
        case3Items.length > 0 ? 'case3' : null,
      ].filter(Boolean) as string[];

      resolvedCaseLabel = presentCases.length === 1 ? presentCases[0] : presentCases.join('+');

      buffer = await renderWriteoffActsFromTemplates(
        { case1: case1Items, case2: case2Items, case3: case3Items },
        templatesMap,
        String(actNumberParam || ''),
        {
          writeoffDate: writeoffDateParam,
          actDate: writeoffDateParam,
          reason: String(reasonParam),
          technicalConclusionNumber: String(techConclusionParam),
          organization: organizationParam ? String(organizationParam) : undefined,
          department: departmentParam ? String(departmentParam) : undefined,
        }
      );

      asciiFilename =
        presentCases.length > 1
          ? `akty-spisaniya-gruppa-${exportedItems.length}-ed-${dateTag}.docx`
          : presentCases[0] === 'case3'
          ? `akt-malotsenka-bez-dm-${case3Items.length}-poz-${dateTag}.docx`
          : presentCases[0] === 'case2'
          ? `akt-malotsenka-dm-${case2Items.length}-ed-${dateTag}.docx`
          : `akt-spisaniya-${case1Items.length}-ed-${dateTag}.docx`;
    }

    await logAuditEvent({
      req,
      action: 'WRITEOFF_ACT_DOCX',
      category: 'DOCUMENT',
      severity: 'INFO',
      entityType: 'writeoff',
      entityId: exportedItems.length === 1 ? exportedItems[0].id : undefined,
      entityLabel: actNumberParam ? `Акт №${actNumberParam}` : `Акт списания (${resolvedCaseLabel})`,
      summary: `Сформирован акт списания (${resolvedCaseLabel}, позиций: ${exportedItems.length}${actNumberParam ? `, №${actNumberParam}` : ''})`,
      details: {
        resolvedCase: resolvedCaseLabel,
        actNumber: actNumberParam || null,
        itemCount: exportedItems.length,
        equipmentIds: exportedItems.map((x: any) => x.id),
      },
    });

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${asciiFilename}"`
    );
    res.send(buffer);
  } catch (error: any) {
    console.error('Error generating writeoff act:', error);
    res.status(500).json({ error: error.message || 'Ошибка формирования акта списания' });
  }
}

app.post('/api/writeoff/generate-act', requireAuth, requireRole('ADMIN', 'ENGINEER'), handleGenerateActRequest);
app.get('/api/writeoff/generate-act', requireAuth, requireRole('ADMIN', 'ENGINEER'), handleGenerateActRequest);
app.get('/api/writeoff/act/:id', requireAuth, requireRole('ADMIN', 'ENGINEER'), handleGenerateActRequest);

// Generate Transfer Invoice DOCX (Supports Case 1: ОКУД 0501460 & Case 2: Форма 434; Case 3 has NO invoice)
async function handleGenerateInvoiceRequest(req: any, res: any) {
  try {
    let rawIds: any[] = [];
    if (Array.isArray(req.body?.equipment_ids)) {
      rawIds = req.body.equipment_ids;
    } else if (req.body?.equipment_id) {
      rawIds = [req.body.equipment_id];
    } else if (req.query?.equipment_ids) {
      rawIds = String(req.query.equipment_ids).split(',');
    }

    const ids = rawIds.map(Number).filter((id) => !isNaN(id) && id > 0);
    if (ids.length === 0) {
      return res.status(400).json({ error: 'Выберите хотя бы одну единицу оборудования для формирования накладной' });
    }

    const caseTypeParam = String(req.body?.case_type || req.query?.case_type || 'auto').toLowerCase();
    if (caseTypeParam === 'case3') {
      return res.status(400).json({
        error: 'Для Кейса 3 (малоценка без драгметаллов) накладная не оформляется — формируется только Акт списания.',
      });
    }

    const items = await db
      .select({
        id: equipment.id,
        inventory_number: equipment.inventory_number,
        name: equipment.name,
        typeName: equipmentTypes.name,
        roomNumber: rooms.number,
        initial_cost: equipment.initial_cost,
        residual_cost: equipment.residual_cost,
        recived: equipment.recived,
        additional_fields: equipment.additional_fields,
      })
      .from(equipment)
      .leftJoin(equipmentTypes, eq(equipment.type_id, equipmentTypes.id))
      .leftJoin(rooms, eq(equipment.room_id, rooms.id))
      .where(inArray(equipment.id, ids));

    if (items.length === 0) {
      return res.status(404).json({ error: 'Выбранное оборудование не найдено в базе данных' });
    }

    // Preserve selection order if provided
    const itemById = new Map(items.map((it: any) => [it.id, it]));
    const orderedItems = ids.map((id) => itemById.get(id)).filter(Boolean);

    const invoiceNumber = req.body?.invoice_number ?? req.query?.invoice_number ?? '';
    const invoiceDate = req.body?.invoice_date || req.query?.invoice_date || new Date().toISOString().slice(0, 10);
    const sender = req.body?.sender || 'Кафедра ПиСП';
    const recipient = req.body?.recipient || 'ЦИТ';
    const note = req.body?.note || '';

    const formatted = orderedItems.map((i: any) => ({
      ...i,
      recivedDate: i.recived ? new Date(i.recived).toLocaleDateString('ru-RU') : '—',
      recivedRaw: i.recived,
    }));

    const templatesMap = await getWriteoffTemplateMap();

    let buffer: Buffer;
    let asciiFilename: string;
    let exportedCount = formatted.length;
    const dateTag = new Date().toISOString().slice(0, 10);

    if (caseTypeParam === 'case1' || caseTypeParam === 'case2') {
      const isLowValue = caseTypeParam === 'case2';
      buffer = await renderInvoicesFromTemplates(
        {
          case1: isLowValue ? [] : formatted,
          case2: isLowValue ? formatted : [],
        },
        templatesMap,
        {
          invoiceNumber: String(invoiceNumber),
          invoiceDate,
          sender: String(sender),
          recipient: String(recipient),
          note: String(note),
        }
      );
      asciiFilename = isLowValue
        ? `nakladnaya-forma-434-${dateTag}.docx`
        : `nakladnaya-CIT-0501460-${dateTag}.docx`;
    } else {
      const case1Items: any[] = [];
      const case2Items: any[] = [];
      for (const item of formatted) {
        const c = detectEquipmentWriteoffCase(item);
        if (c === 'case1') case1Items.push(item);
        else if (c === 'case2') case2Items.push(item);
      }

      exportedCount = case1Items.length + case2Items.length;
      if (exportedCount === 0) {
        return res.status(400).json({
          error:
            'Для выбранного оборудования накладная не требуется (для Кейса 3 и позиций без кейса списания накладная не оформляется).',
        });
      }

      buffer = await renderInvoicesFromTemplates(
        { case1: case1Items, case2: case2Items },
        templatesMap,
        {
          invoiceNumber: String(invoiceNumber),
          invoiceDate,
          sender: String(sender),
          recipient: String(recipient),
          note: String(note),
        }
      );

      asciiFilename =
        case1Items.length > 0 && case2Items.length > 0
          ? `nakladnye-gruppa-${dateTag}.docx`
          : case2Items.length > 0
          ? `nakladnaya-forma-434-${dateTag}.docx`
          : `nakladnaya-CIT-0501460-${dateTag}.docx`;
    }

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${asciiFilename}"`
    );
    await logAuditEvent({
      req,
      action: 'WRITEOFF_INVOICE_DOCX',
      category: 'DOCUMENT',
      severity: 'INFO',
      entityType: 'equipment',
      entityId: ids.join(','),
      entityLabel: asciiFilename,
      summary: `Сформирована накладная списания (${exportedCount} ед.)`,
      details: { filename: asciiFilename, count: exportedCount, equipmentIds: ids },
    });

    res.send(buffer);
  } catch (error: any) {
    console.error('Error generating transfer invoice:', error);
    res.status(500).json({ error: error.message || 'Ошибка формирования накладной' });
  }
}

app.post('/api/writeoff/generate-invoice', requireAuth, requireRole('ADMIN', 'ENGINEER'), handleGenerateInvoiceRequest);
app.get('/api/writeoff/generate-invoice', requireAuth, requireRole('ADMIN', 'ENGINEER'), handleGenerateInvoiceRequest);

// ==========================================
// 7. ISSUE TRACKING & NOTIFICATIONS
// ==========================================

// Report Issue (User, Engineer, Admin)
// Spec (PDF page 12-14):
// "Пользователь указывает характер неисправности (один из трех статусов), описание неисправности, дату обнаружения неисправности (по умолчанию текущая).
// Тогда все Администраторы и Инженеры получают уведомление о том, что обнаружена неисправность.
// Ограничения: Если оборудование списано, ему нельзя выставлять неисправности."
app.post('/api/equipment/:id/issues', requireAuth, async (req: AuthRequest, res) => {
  try {
    const eqId = Number(req.params.id);
    if (!Number.isInteger(eqId) || eqId <= 0) {
      return res.status(400).json({ error: 'Некорректный идентификатор оборудования' });
    }
    const { state, description, broken_at } = req.body;

    if (!state || !description || !String(description).trim()) {
      return res.status(400).json({ error: 'Характер неисправности и описание обязательны' });
    }
    if (!['ISSUE', 'CRITICAL_ISSUE', 'WEAR_AND_TEAR'].includes(state)) {
      return res.status(400).json({ error: 'Недопустимый тип неисправности' });
    }

    const brokenDate = broken_at ? new Date(broken_at) : new Date();
    if (isNaN(brokenDate.getTime())) {
      return res.status(400).json({ error: 'Некорректная дата обнаружения неисправности' });
    }

    const [eqExists] = await db
      .select({ id: equipment.id })
      .from(equipment)
      .where(eq(equipment.id, eqId))
      .limit(1);
    if (!eqExists) {
      return res.status(404).json({ error: 'Оборудование не найдено' });
    }

    // Check if equipment is written off
    const [writeoff] = await db
      .select()
      .from(equipmentWriteoffs)
      .where(
        and(
          eq(equipmentWriteoffs.equipment_id, eqId),
          eq(equipmentWriteoffs.state, 'WRITTEN_OFF')
        )
      )
      .limit(1);

    if (writeoff) {
      return res.status(400).json({ error: 'Оборудование списано, регистрация неисправностей невозможна' });
    }

    const [createdIssue] = await db
      .insert(equipmentIssues)
      .values({
        equipment_id: eqId,
        state: state as any,
        description: String(description).trim(),
        broken_at: brokenDate,
        repaired_at: null,
      })
      .returning();

    // Create notifications for all Admins and Engineers
    const staffUsers = await db
      .select({ id: users.id })
      .from(users)
      .where(or(eq(users.role, 'ADMIN'), eq(users.role, 'ENGINEER')));

    for (const staff of staffUsers) {
      await db.insert(notifications).values({
        user_id: staff.id,
        equipment_issue_id: createdIssue.id,
        is_read: false,
      });
    }

    await logAuditEvent({
      req,
      action: 'ISSUE_REPORT',
      category: 'MAINTENANCE',
      severity: state === 'CRITICAL_ISSUE' ? 'CRITICAL' : 'WARNING',
      entityType: 'equipment',
      entityId: eqId,
      entityLabel: `Оборудование #${eqId}`,
      summary: `Зарегистрирована неисправность (${state}): ${String(description).trim().slice(0, 140)}`,
      details: { issueId: createdIssue.id, state, brokenAt: brokenDate },
    });

    res.status(201).json(createdIssue);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Bulk Issue Registration (Admin or Engineer)
app.post('/api/issues/batch', requireAuth, requireRole('ADMIN', 'ENGINEER'), async (req, res) => {
  try {
    const { items, broken_at } = req.body;
    // items: Array<{ equipment_id: number; state: string; description: string }>
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Укажите список оборудования с неисправностями' });
    }

    const detectionDate = broken_at ? new Date(broken_at) : new Date();
    const createdIssues: any[] = [];

    const staffUsers = await db
      .select({ id: users.id })
      .from(users)
      .where(or(eq(users.role, 'ADMIN'), eq(users.role, 'ENGINEER')));

    for (const item of items) {
      // Check written off
      const [writeoff] = await db
        .select()
        .from(equipmentWriteoffs)
        .where(
          and(
            eq(equipmentWriteoffs.equipment_id, Number(item.equipment_id)),
            eq(equipmentWriteoffs.state, 'WRITTEN_OFF')
          )
        )
        .limit(1);

      if (writeoff) continue; // Skip written off items

      const [issue] = await db
        .insert(equipmentIssues)
        .values({
          equipment_id: Number(item.equipment_id),
          state: item.state,
          description: item.description,
          broken_at: detectionDate,
        })
        .returning();

      createdIssues.push(issue);

      for (const staff of staffUsers) {
        await db.insert(notifications).values({
          user_id: staff.id,
          equipment_issue_id: issue.id,
        });
      }
    }

    await logAuditEvent({
      req,
      action: 'ISSUE_BATCH',
      category: 'MAINTENANCE',
      severity: 'WARNING',
      entityType: 'equipment',
      entityLabel: `Пакетная заявка (${createdIssues.length} ед.)`,
      summary: `Массовая регистрация неисправностей: добавлено записей — ${createdIssues.length}`,
      details: {
        count: createdIssues.length,
        equipmentIds: createdIssues.map((i: any) => i.equipment_id),
      },
    });

    res.status(201).json({ success: true, count: createdIssues.length });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Issues History for single equipment (Chronological order, page 12)
app.get('/api/equipment/:id/issues', requireAuth, async (req, res) => {
  try {
    const eqId = Number(req.params.id);
    if (!Number.isInteger(eqId) || eqId <= 0) {
      return res.status(400).json({ error: 'Некорректный идентификатор оборудования' });
    }
    const history = await db
      .select()
      .from(equipmentIssues)
      .where(eq(equipmentIssues.equipment_id, eqId))
      .orderBy(desc(equipmentIssues.broken_at));
    res.json(history);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Mark Issue Repaired (Admin or Engineer)
app.post('/api/issues/:issueId/repair', requireAuth, requireRole('ADMIN', 'ENGINEER'), async (req, res) => {
  try {
    const issueId = Number(req.params.issueId);
    if (!Number.isInteger(issueId) || issueId <= 0) {
      return res.status(400).json({ error: 'Некорректный идентификатор неисправности' });
    }
    const { repaired_at } = req.body;
    const repairedDate = repaired_at ? new Date(repaired_at) : new Date();
    if (isNaN(repairedDate.getTime())) {
      return res.status(400).json({ error: 'Некорректная дата ремонта' });
    }

    const [existingIssue] = await db
      .select()
      .from(equipmentIssues)
      .where(eq(equipmentIssues.id, issueId))
      .limit(1);

    if (!existingIssue) {
      return res.status(404).json({ error: 'Запись о неисправности не найдена' });
    }
    if (existingIssue.repaired_at) {
      return res.status(400).json({ error: 'Неисправность уже отмечена как отремонтированная' });
    }

    const [updated] = await db
      .update(equipmentIssues)
      .set({
        repaired_at: repairedDate,
      })
      .where(and(eq(equipmentIssues.id, issueId), isNull(equipmentIssues.repaired_at)))
      .returning();

    if (updated) {
      await logAuditEvent({
        req,
        action: 'ISSUE_REPAIR',
        category: 'MAINTENANCE',
        severity: 'INFO',
        entityType: 'issue',
        entityId: updated.id,
        entityLabel: `Оборудование #${updated.equipment_id}`,
        summary: `Неисправность #${updated.id} отмечена как отремонтированная`,
        details: { issueId: updated.id, equipmentId: updated.equipment_id, repairedAt: updated.repaired_at },
      });
    }

    res.json(updated);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Notifications for current user
app.get('/api/notifications', requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!req.user) return res.json([]);

    const userNotifs = await db
      .select({
        id: notifications.id,
        created_at: notifications.created_at,
        is_read: notifications.is_read,
        issueId: equipmentIssues.id,
        state: equipmentIssues.state,
        description: equipmentIssues.description,
        broken_at: equipmentIssues.broken_at,
        equipmentId: equipment.id,
        equipmentName: equipment.name,
        inventoryNumber: equipment.inventory_number,
      })
      .from(notifications)
      .innerJoin(
        equipmentIssues,
        eq(notifications.equipment_issue_id, equipmentIssues.id)
      )
      .innerJoin(equipment, eq(equipmentIssues.equipment_id, equipment.id))
      .where(eq(notifications.user_id, req.user.id))
      .orderBy(desc(notifications.created_at));

    res.json(userNotifs);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Dismiss notification
// Spec (PDF page 14): "После просмотра уведомления записи из таблицы удаляются."
app.delete('/api/notifications/:id', requireAuth, async (req: AuthRequest, res) => {
  try {
    const notifId = Number(req.params.id);
    if (!Number.isInteger(notifId) || notifId <= 0) {
      return res.status(400).json({ error: 'Некорректный идентификатор уведомления' });
    }
    await db
      .delete(notifications)
      .where(and(eq(notifications.id, notifId), eq(notifications.user_id, req.user!.id)));
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// 8. TEMPORARY LOAN / TRANSFERS (Передача во временное пользование)
// ==========================================

// Create Transfer (Admin or Engineer)
// Spec (PDF page 15):
// "Администратор или Инженер может передать оборудование во временное пользование. Тогда он указывает, кому передается оборудование, дату передачи (по умолчанию текущая), предполагаемую дату возвращения.
// Ограничения: Если оборудование списано, его нельзя передавать. Можно иметь только 1 активную передачу."
app.post('/api/equipment/transfers', requireAuth, requireRole('ADMIN', 'ENGINEER'), async (req, res) => {
  try {
    const { equipment_ids, issued_to, issued_at, expected_return_at } = req.body;
    if (!Array.isArray(equipment_ids) || equipment_ids.length === 0 || !issued_to) {
      return res.status(400).json({ error: 'Укажите оборудование и получателя (кому передано)' });
    }

    const transferDate = issued_at ? new Date(issued_at) : new Date();
    const expectedReturnDate = expected_return_at ? new Date(expected_return_at) : null;
    if (isNaN(transferDate.getTime())) {
      return res.status(400).json({ error: 'Некорректная дата передачи оборудования' });
    }
    if (expectedReturnDate && isNaN(expectedReturnDate.getTime())) {
      return res.status(400).json({ error: 'Некорректная планируемая дата возврата' });
    }
    const errors: string[] = [];

    for (const eqId of equipment_ids) {
      // 1. Check if written off
      const [writeoff] = await db
        .select()
        .from(equipmentWriteoffs)
        .where(
          and(
            eq(equipmentWriteoffs.equipment_id, Number(eqId)),
            eq(equipmentWriteoffs.state, 'WRITTEN_OFF')
          )
        )
        .limit(1);

      if (writeoff) {
        errors.push(`Оборудование ID ${eqId} списано, его нельзя передавать`);
        continue;
      }

      // 2. Check if already has active transfer
      const [activeTransfer] = await db
        .select()
        .from(equipmentTransfers)
        .where(
          and(
            eq(equipmentTransfers.equipment_id, Number(eqId)),
            isNull(equipmentTransfers.returned_at)
          )
        )
        .limit(1);

      if (activeTransfer) {
        errors.push(`Оборудование ID ${eqId} уже находится во временном пользовании (активная передача)`);
        continue;
      }

      await db.insert(equipmentTransfers).values({
        equipment_id: Number(eqId),
        issued_to: issued_to.trim(),
        issued_at: transferDate,
        expected_return_at: expectedReturnDate,
        returned_at: null,
      });
    }

    if (errors.length > 0 && errors.length === equipment_ids.length) {
      return res.status(400).json({ error: errors.join('; ') });
    }

    await logAuditEvent({
      req,
      action: 'TRANSFER_CREATE',
      category: 'TRANSFER',
      severity: 'INFO',
      entityType: 'equipment',
      entityId: equipment_ids.join(','),
      entityLabel: `Передача (${equipment_ids.length} ед.) → ${String(issued_to).trim()}`,
      summary: `Передано во временное пользование (${equipment_ids.length} ед.) получателю «${String(issued_to).trim()}»`,
      details: {
        equipmentIds: equipment_ids,
        issuedTo: String(issued_to).trim(),
        transferDate,
        expectedReturnDate,
        warnings: errors,
      },
    });

    res.status(201).json({
      success: true,
      message: 'Оборудование передано во временное пользование',
      warnings: errors,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Return Equipment (Admin or Engineer)
app.post('/api/transfers/:id/return', requireAuth, requireRole('ADMIN', 'ENGINEER'), async (req, res) => {
  try {
    const transferId = Number(req.params.id);
    if (!Number.isInteger(transferId) || transferId <= 0) {
      return res.status(400).json({ error: 'Некорректный идентификатор передачи' });
    }
    const { returned_at } = req.body;
    const returnedDate = returned_at ? new Date(returned_at) : new Date();
    if (isNaN(returnedDate.getTime())) {
      return res.status(400).json({ error: 'Некорректная дата возврата' });
    }

    const [existingTransfer] = await db
      .select()
      .from(equipmentTransfers)
      .where(eq(equipmentTransfers.id, transferId))
      .limit(1);

    if (!existingTransfer) {
      return res.status(404).json({ error: 'Запись о передаче оборудования не найдена' });
    }
    if (existingTransfer.returned_at) {
      return res.status(400).json({ error: 'Оборудование по данной передаче уже возвращено' });
    }

    const [updated] = await db
      .update(equipmentTransfers)
      .set({
        returned_at: returnedDate,
      })
      .where(and(eq(equipmentTransfers.id, transferId), isNull(equipmentTransfers.returned_at)))
      .returning();

    if (updated) {
      await logAuditEvent({
        req,
        action: 'TRANSFER_RETURN',
        category: 'TRANSFER',
        severity: 'INFO',
        entityType: 'transfer',
        entityId: updated.id,
        entityLabel: `Оборудование #${updated.equipment_id} ← ${updated.issued_to}`,
        summary: `Оформлен возврат оборудования #${updated.equipment_id} от «${updated.issued_to}»`,
        details: { transferId: updated.id, equipmentId: updated.equipment_id, returnedAt: updated.returned_at },
      });
    }

    res.json(updated);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Transfer History for single equipment (Chronological order, page 15 — Admin/Engineer only)
app.get('/api/equipment/:id/transfers', requireAuth, requireRole('ADMIN', 'ENGINEER'), async (req, res) => {
  try {
    const eqId = Number(req.params.id);
    if (!Number.isInteger(eqId) || eqId <= 0) {
      return res.status(400).json({ error: 'Некорректный идентификатор оборудования' });
    }
    const history = await db
      .select()
      .from(equipmentTransfers)
      .where(eq(equipmentTransfers.equipment_id, eqId))
      .orderBy(desc(equipmentTransfers.issued_at));
    res.json(history);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// 9. INVENTORY AUDIT (Инвентаризация)
// ==========================================

// Start Inventory
// Spec (PDF page 17-19):
// "Администратор или Инженер (в дальнейшем - Аудитор) может проводить инвентаризацию. Для этого он создаёт отдельное событие "Инвентаризация", в котором фиксируется дата начала инвентаризации, дата окончания (сначала равна NULL, затем устанавливается при завершении инвентаризации), аудитор, проводящий инвентаризацию.
// Система не должна допускать создание события "Инвентаризация" кому-либо из аудиторов до завершения его предыдущей инвентаризации.
// При создании новой инвентаризации все имеющееся оборудование получает статус как не прошедшее инвентаризацию (запись в verification со значением verified_at = NULL)."
app.post('/api/inventory/start', requireAuth, requireRole('ADMIN', 'ENGINEER'), async (req: AuthRequest, res) => {
  try {
    const auditorId = req.user!.id;

    // Check if auditor has unfinished inventory
    const [unfinished] = await db
      .select()
      .from(inventories)
      .where(
        and(
          eq(inventories.auditor_ext_id, auditorId),
          isNull(inventories.finished_at)
        )
      )
      .limit(1);

    if (unfinished) {
      return res.status(400).json({
        error: 'У вас уже есть незавершенная инвентаризация. Завершите ее перед созданием новой.',
        activeInventoryId: unfinished.id,
      });
    }

    const [newInventory] = await db
      .insert(inventories)
      .values({
        auditor_ext_id: auditorId,
        started_at: new Date(),
        finished_at: null,
      })
      .returning();

    // Fetch all active non-written-off equipment
    const allEq = await db
      .select({ id: equipment.id })
      .from(equipment)
      .leftJoin(equipmentWriteoffs, eq(equipment.id, equipmentWriteoffs.equipment_id))
      .where(
        or(
          isNull(equipmentWriteoffs.state),
          sql`${equipmentWriteoffs.state} != 'WRITTEN_OFF'`
        )
      );

    // Create verification records with verified_at = null
    for (const item of allEq) {
      await db.insert(verifications).values({
        inventory_id: newInventory.id,
        equipment_id: item.id,
        verified_at: null,
      });
    }

    await logAuditEvent({
      req,
      action: 'INVENTORY_START',
      category: 'INVENTORY',
      severity: 'INFO',
      entityType: 'inventory',
      entityId: newInventory.id,
      entityLabel: `Инвентаризация #${newInventory.id}`,
      summary: `Начата инвентаризация #${newInventory.id} (${allEq.length} ед. к проверке)`,
      details: { inventoryId: newInventory.id, itemsToVerify: allEq.length },
    });

    res.status(201).json({
      success: true,
      inventory: newInventory,
      itemsToVerify: allEq.length,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get Current Active Inventory for User (Auditor)
app.get('/api/inventory/current', requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!req.user || !['ADMIN', 'ENGINEER'].includes(req.user.role)) {
      return res.json({ activeInventory: null });
    }

    const [active] = await db
      .select()
      .from(inventories)
      .where(
        and(
          eq(inventories.auditor_ext_id, req.user.id),
          isNull(inventories.finished_at)
        )
      )
      .limit(1);

    if (!active) {
      return res.json({ activeInventory: null });
    }

    // Counts
    const allVerifs = await db
      .select()
      .from(verifications)
      .where(eq(verifications.inventory_id, active.id));

    const totalCount = allVerifs.length;
    const verifiedCount = allVerifs.filter((v: any) => v.verified_at !== null).length;

    res.json({
      activeInventory: {
        ...active,
        totalCount,
        verifiedCount,
        pendingCount: totalCount - verifiedCount,
      },
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get Unverified Equipment for Current Inventory
// Spec (PDF page 17): "Когда в системе есть активная инвентаризация для текущего аудитора, у него на главной странице появляется вкладка “Текущая инвентаризация” - в ней отображается список оборудования, ещё не прошедшего инвентаризацию."
app.get('/api/inventory/current/unverified', requireAuth, requireRole('ADMIN', 'ENGINEER'), async (req: AuthRequest, res) => {
  try {
    const [active] = await db
      .select()
      .from(inventories)
      .where(
        and(
          eq(inventories.auditor_ext_id, req.user!.id),
          isNull(inventories.finished_at)
        )
      )
      .limit(1);

    if (!active) {
      return res.json([]);
    }

    const unverifiedList = await db
      .select({
        id: equipment.id,
        inventory_number: equipment.inventory_number,
        name: equipment.name,
        typeName: equipmentTypes.name,
        roomNumber: rooms.number,
        verificationId: verifications.id,
      })
      .from(verifications)
      .innerJoin(equipment, eq(verifications.equipment_id, equipment.id))
      .leftJoin(equipmentTypes, eq(equipment.type_id, equipmentTypes.id))
      .leftJoin(rooms, eq(equipment.room_id, rooms.id))
      .where(
        and(
          eq(verifications.inventory_id, active.id),
          isNull(verifications.verified_at)
        )
      )
      .orderBy(rooms.number, equipment.name);

    res.json(unverifiedList);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Confirm verification ("Проверено")
// Spec (PDF page 17): "Если у аудитора есть текущая инвентаризация, то ему дополнительно предоставляется возможность изменить статус оборудования как прошедшего инвентаризацию (нажать кнопку “Проверено”). В дальнейшем эта кнопка отсутствует, пока для аудитора не появится новая инвентаризация."
app.post('/api/inventory/:inventoryId/verify/:equipmentId', requireAuth, requireRole('ADMIN', 'ENGINEER'), async (req: AuthRequest, res) => {
  try {
    const inventoryId = Number(req.params.inventoryId);
    const eqId = Number(req.params.equipmentId);
    if (!Number.isInteger(inventoryId) || inventoryId <= 0 || !Number.isInteger(eqId) || eqId <= 0) {
      return res.status(400).json({ error: 'Некорректный идентификатор инвентаризации или оборудования' });
    }

    const [audit] = await db
      .select()
      .from(inventories)
      .where(eq(inventories.id, inventoryId))
      .limit(1);

    if (!audit) {
      return res.status(404).json({ error: 'Инвентаризация не найдена' });
    }
    if (audit.auditor_ext_id !== req.user!.id && req.user!.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Вы не являетесь аудитором данной инвентаризации' });
    }
    if (audit.finished_at) {
      return res.status(400).json({ error: 'Инвентаризация уже завершена' });
    }

    const [updated] = await db
      .update(verifications)
      .set({
        verified_at: new Date(),
      })
      .where(
        and(
          eq(verifications.inventory_id, inventoryId),
          eq(verifications.equipment_id, eqId)
        )
      )
      .returning();

    if (!updated) {
      return res.status(404).json({ error: 'Запись инвентаризации для данного оборудования не найдена' });
    }

    await logAuditEvent({
      req,
      action: 'INVENTORY_VERIFY',
      category: 'INVENTORY',
      severity: 'INFO',
      entityType: 'equipment',
      entityId: eqId,
      entityLabel: `Инвентаризация #${inventoryId} • Оборудование #${eqId}`,
      summary: `Подтверждено наличие оборудования #${eqId} в инвентаризации #${inventoryId}`,
      details: { inventoryId, equipmentId: eqId, verifiedAt: updated.verified_at },
    });

    res.json({ success: true, verified_at: updated.verified_at });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Finish Inventory
app.post('/api/inventory/:id/finish', requireAuth, requireRole('ADMIN', 'ENGINEER'), async (req: AuthRequest, res) => {
  try {
    const invId = Number(req.params.id);
    if (!Number.isInteger(invId) || invId <= 0) {
      return res.status(400).json({ error: 'Некорректный идентификатор инвентаризации' });
    }

    const [audit] = await db
      .select()
      .from(inventories)
      .where(eq(inventories.id, invId))
      .limit(1);

    if (!audit) {
      return res.status(404).json({ error: 'Инвентаризация не найдена' });
    }
    if (audit.auditor_ext_id !== req.user!.id && req.user!.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Завершить инвентаризацию может только проводивший её аудитор или администратор' });
    }
    if (audit.finished_at) {
      return res.status(400).json({ error: 'Инвентаризация уже завершена' });
    }

    const [finished] = await db
      .update(inventories)
      .set({
        finished_at: new Date(),
      })
      .where(eq(inventories.id, invId))
      .returning();

    await logAuditEvent({
      req,
      action: 'INVENTORY_FINISH',
      category: 'INVENTORY',
      severity: 'INFO',
      entityType: 'inventory',
      entityId: invId,
      entityLabel: `Инвентаризация #${invId}`,
      summary: `Завершена инвентаризация #${invId}`,
      details: { inventoryId: invId, finishedAt: finished?.finished_at },
    });

    res.json({ success: true, inventory: finished || audit });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Completed Inventories History (Admin or Engineer)
app.get('/api/inventory/history', requireAuth, requireRole('ADMIN', 'ENGINEER'), async (_req, res) => {
  try {
    const completed = await db
      .select({
        id: inventories.id,
        auditor_ext_id: inventories.auditor_ext_id,
        auditorLogin: users.login,
        started_at: inventories.started_at,
        finished_at: inventories.finished_at,
      })
      .from(inventories)
      .leftJoin(users, eq(inventories.auditor_ext_id, users.id))
      .where(sql`${inventories.finished_at} IS NOT NULL`)
      .orderBy(desc(inventories.finished_at))
      .limit(30);

    if (completed.length === 0) {
      return res.json([]);
    }

    const invIds = completed.map((c: any) => c.id);
    const allVerifs = await db
      .select({
        inventory_id: verifications.inventory_id,
        verified_at: verifications.verified_at,
      })
      .from(verifications)
      .where(inArray(verifications.inventory_id, invIds));

    const statsMap = new Map<number, { total: number; verified: number }>();
    for (const v of allVerifs) {
      const current = statsMap.get(v.inventory_id) || { total: 0, verified: 0 };
      current.total += 1;
      if (v.verified_at !== null) current.verified += 1;
      statsMap.set(v.inventory_id, current);
    }

    const enriched = completed.map((c: any) => {
      const st = statsMap.get(c.id) || { total: 0, verified: 0 };
      return {
        ...c,
        totalCount: st.total,
        verifiedCount: st.verified,
        pendingCount: st.total - st.verified,
      };
    });

    res.json(enriched);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// 10. AUDIT LOGS & ROLE-BASED LOGGING CAPABILITIES
// ==========================================

function buildRoleScopedAuditFilter(user: NonNullable<AuthRequest['user']>) {
  if (user.role === 'ADMIN') {
    return null;
  }
  if (user.role === 'ENGINEER') {
    return or(
      inArray(auditLogs.category, ENGINEER_ALLOWED_CATEGORIES),
      and(eq(auditLogs.category, 'AUTH'), eq(auditLogs.actor_id, user.id))
    );
  }
  // USER: strictly own activity logs
  return eq(auditLogs.actor_id, user.id);
}

// Get current user's logging role capabilities
app.get('/api/audit-logs/capabilities', requireAuth, async (req: AuthRequest, res) => {
  const user = req.user!;
  res.json(getRoleLogCapabilities(user.role));
});

// Query audit logs strictly scoped to user role capabilities
app.get('/api/audit-logs', requireAuth, async (req: AuthRequest, res) => {
  try {
    const user = req.user!;
    const capabilities = getRoleLogCapabilities(user.role);

    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
    const category = req.query.category ? String(req.query.category).trim().toUpperCase() : '';
    const severity = req.query.severity ? String(req.query.severity).trim().toUpperCase() : '';
    const search = req.query.search ? String(req.query.search).trim() : '';
    const actorIdParam = req.query.actor_id ? Number(req.query.actor_id) : undefined;
    const dateFrom = req.query.date_from ? new Date(`${String(req.query.date_from)}T00:00:00`) : undefined;
    const dateTo = req.query.date_to ? new Date(`${String(req.query.date_to)}T23:59:59.999`) : undefined;

    if (category && !capabilities.allowedCategories.includes(category as any)) {
      return res.status(403).json({
        error: `Роль «${capabilities.roleLabel}» не имеет доступа к категории журнала «${category}»`,
      });
    }

    if (actorIdParam && !capabilities.canViewAllUsers && actorIdParam !== user.id) {
      return res.status(403).json({
        error: 'У вашей роли нет прав для просмотра событий других пользователей',
      });
    }

    const conditions: any[] = [];
    const roleScope = buildRoleScopedAuditFilter(user);
    if (roleScope) conditions.push(roleScope);

    if (category) conditions.push(eq(auditLogs.category, category));
    if (severity) conditions.push(eq(auditLogs.severity, severity));
    if (actorIdParam && capabilities.canViewAllUsers) {
      conditions.push(eq(auditLogs.actor_id, actorIdParam));
    }
    if (dateFrom && !isNaN(dateFrom.getTime())) {
      conditions.push(gte(auditLogs.created_at, dateFrom));
    }
    if (dateTo && !isNaN(dateTo.getTime())) {
      conditions.push(lte(auditLogs.created_at, dateTo));
    }
    if (search) {
      const searchConds: any[] = [
        ilike(auditLogs.summary, `%${search}%`),
        ilike(auditLogs.action, `%${search}%`),
        ilike(auditLogs.entity_label, `%${search}%`),
        ilike(auditLogs.entity_id, `%${search}%`),
      ];
      if (capabilities.canViewAllUsers) {
        searchConds.push(ilike(auditLogs.actor_login, `%${search}%`));
      }
      if (capabilities.canViewTechnicalMeta) {
        searchConds.push(ilike(auditLogs.ip_address, `%${search}%`));
      }
      conditions.push(or(...searchConds));
    }

    const whereExpr = conditions.length > 0 ? and(...conditions) : undefined;

    const allMatched = await db
      .select()
      .from(auditLogs)
      .where(whereExpr)
      .orderBy(desc(auditLogs.created_at), desc(auditLogs.id));

    const total = allMatched.length;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const offset = (page - 1) * limit;
    const paged = allMatched.slice(offset, offset + limit).map((row: any) => {
      if (capabilities.canViewTechnicalMeta || row.actor_id === user.id) {
        return row;
      }
      const { ip_address: _ip, user_agent: _ua, ...safeRow } = row;
      return safeRow;
    });

    // Scope-wide stats for the summary strip
    const scopeRows = roleScope
      ? await db.select({ severity: auditLogs.severity }).from(auditLogs).where(roleScope)
      : await db.select({ severity: auditLogs.severity }).from(auditLogs);

    const stats = {
      total: scopeRows.length,
      info: scopeRows.filter((r: any) => r.severity === 'INFO').length,
      warning: scopeRows.filter((r: any) => r.severity === 'WARNING').length,
      critical: scopeRows.filter((r: any) => r.severity === 'CRITICAL').length,
    };

    let actors: Array<{ id: number | null; login: string; role: string }> | undefined;
    if (capabilities.canViewAllUsers) {
      const allUsersRows = await db
        .select({ id: users.id, login: users.login, role: users.role })
        .from(users)
        .orderBy(users.id);
      actors = allUsersRows;
    }

    res.json({
      items: paged,
      total,
      page,
      totalPages,
      stats,
      capabilities,
      actors,
    });
  } catch (error: any) {
    console.error('Error querying audit logs:', error);
    res.status(500).json({ error: error.message || 'Ошибка чтения журнала событий' });
  }
});

// Export audit logs (ADMIN: all visible logs; ENGINEER: operational logs only; USER: 403)
app.get('/api/audit-logs/export', requireAuth, async (req: AuthRequest, res) => {
  try {
    const user = req.user!;
    const capabilities = getRoleLogCapabilities(user.role);
    if (!capabilities.canExport) {
      return res.status(403).json({
        error: `Роль «${capabilities.roleLabel}» не имеет прав на экспорт журнала событий`,
      });
    }

    const format = String(req.query.format || 'xlsx').toLowerCase();
    const category = req.query.category ? String(req.query.category).trim().toUpperCase() : '';
    const severity = req.query.severity ? String(req.query.severity).trim().toUpperCase() : '';

    if (category && !capabilities.allowedCategories.includes(category as any)) {
      return res.status(403).json({
        error: `Категория «${category}» недоступна для роли «${capabilities.roleLabel}»`,
      });
    }

    const conditions: any[] = [];
    const roleScope = buildRoleScopedAuditFilter(user);
    if (roleScope) conditions.push(roleScope);
    if (category) conditions.push(eq(auditLogs.category, category));
    if (severity) conditions.push(eq(auditLogs.severity, severity));

    const rows = await db
      .select()
      .from(auditLogs)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(auditLogs.created_at), desc(auditLogs.id));

    const sanitized = rows.map((r: any) => ({
      id: r.id,
      created_at: r.created_at,
      actor_login: r.actor_login,
      actor_role: r.actor_role,
      category: r.category,
      severity: r.severity,
      action: r.action,
      entity_type: r.entity_type,
      entity_id: r.entity_id,
      entity_label: r.entity_label,
      summary: r.summary,
      ...(capabilities.canViewTechnicalMeta ? { ip_address: r.ip_address || '' } : {}),
    }));

    await logAuditEvent({
      req,
      action: 'LOGS_EXPORT',
      category: user.role === 'ADMIN' ? 'SECURITY' : 'DOCUMENT',
      severity: 'INFO',
      entityType: 'system',
      entityLabel: `Экспорт журнала (${format.toUpperCase()})`,
      summary: `Выгружен журнал событий (${sanitized.length} записей, формат ${format.toUpperCase()})`,
      details: { format, exportedCount: sanitized.length, category: category || 'ALL', severity: severity || 'ALL' },
    });

    const dateTag = new Date().toISOString().slice(0, 10);
    if (format === 'json') {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="audit-logs-${dateTag}.json"`);
      return res.send(JSON.stringify(sanitized, null, 2));
    }

    const sheetRows = sanitized.map((r: any) => {
      const baseRow: Record<string, any> = {
        'ID': r.id,
        'Дата и время': new Date(r.created_at).toLocaleString('ru-RU'),
        'Пользователь': sanitizeSpreadsheetCell(r.actor_login || 'Система'),
        'Роль': sanitizeSpreadsheetCell(r.actor_role || '—'),
        'Категория': sanitizeSpreadsheetCell(r.category),
        'Уровень': sanitizeSpreadsheetCell(r.severity),
        'Код события': sanitizeSpreadsheetCell(r.action),
        'Объект': sanitizeSpreadsheetCell(r.entity_label || (r.entity_id ? `#${r.entity_id}` : '—')),
        'Описание': sanitizeSpreadsheetCell(r.summary),
      };
      if (capabilities.canViewTechnicalMeta) {
        baseRow['IP-адрес'] = sanitizeSpreadsheetCell(r.ip_address || '');
      }
      return baseRow;
    });

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(sheetRows);
    XLSX.utils.book_append_sheet(wb, ws, 'Журнал действий');
    const xlsxBuf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader('Content-Disposition', `attachment; filename="audit-logs-${dateTag}.xlsx"`);
    res.send(xlsxBuf);
  } catch (error: any) {
    console.error('Error exporting audit logs:', error);
    res.status(500).json({ error: error.message || 'Ошибка экспорта журнала' });
  }
});

// Purge / archive rotation of audit logs (ADMIN ONLY)
app.delete('/api/audit-logs/purge', requireAuth, requireRole('ADMIN'), async (req: AuthRequest, res) => {
  try {
    const rawDays = req.body?.older_than_days ?? req.query?.older_than_days;
    const days = rawDays === undefined || rawDays === null || rawDays === '' ? 90 : Number(rawDays);
    if (!Number.isFinite(days) || days < 0 || days > 3650) {
      return res.status(400).json({ error: 'Укажите срок хранения от 0 до 3650 дней' });
    }

    let deletedRows: Array<{ id: number }> = [];
    if (days === 0) {
      deletedRows = await db.delete(auditLogs).returning({ id: auditLogs.id });
    } else {
      const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      deletedRows = await db
        .delete(auditLogs)
        .where(lt(auditLogs.created_at, cutoff))
        .returning({ id: auditLogs.id });
    }

    await logAuditEvent({
      req,
      action: 'LOGS_PURGE',
      category: 'SECURITY',
      severity: 'CRITICAL',
      entityType: 'system',
      entityLabel: 'Ротация журнала событий',
      summary:
        days === 0
          ? `Выполнена полная очистка журнала событий (удалено записей: ${deletedRows.length})`
          : `Удалены записи журнала старше ${days} дн. (удалено: ${deletedRows.length})`,
      details: { olderThanDays: days, deletedCount: deletedRows.length },
    });

    res.json({
      success: true,
      deletedCount: deletedRows.length,
      message: `Удалено записей журнала: ${deletedRows.length}`,
    });
  } catch (error: any) {
    console.error('Error purging audit logs:', error);
    res.status(500).json({ error: error.message || 'Ошибка очистки журнала' });
  }
});

// ==========================================
// 11. FRONTEND INTEGRATION & DEV SERVER
// ==========================================

async function startServer() {
  // Ensure schema tables exist and initial seed runs BEFORE serving HTTP requests (critical for Neon cold start)
  await seedDatabaseIfEmpty();

  if (isDev) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(Number(PORT), '0.0.0.0', () => {
    console.log(`Inventory server running on port ${PORT} (isDev: ${isDev})`);
  });
}

export { app };

startServer().catch(console.error);
