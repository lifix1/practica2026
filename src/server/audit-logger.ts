import type express from 'express';
import { db } from '../db/index.ts';
import { auditLogs } from '../db/schema.ts';
import type { UserRole } from '../types/index.ts';

export type AuditCategory =
  | 'AUTH'
  | 'SECURITY'
  | 'ADMIN'
  | 'EQUIPMENT'
  | 'MAINTENANCE'
  | 'TRANSFER'
  | 'INVENTORY'
  | 'WRITEOFF'
  | 'DOCUMENT';

export type AuditSeverity = 'INFO' | 'WARNING' | 'CRITICAL';

export interface RoleLogCapabilities {
  role: UserRole;
  roleLabel: string;
  scope: 'ALL' | 'OPERATIONAL' | 'OWN';
  scopeTitle: string;
  scopeDescription: string;
  allowedCategories: AuditCategory[];
  canViewAllUsers: boolean;
  canViewSecurityEvents: boolean;
  canViewTechnicalMeta: boolean;
  canExport: boolean;
  canPurge: boolean;
}

export const ENGINEER_ALLOWED_CATEGORIES: AuditCategory[] = [
  'EQUIPMENT',
  'MAINTENANCE',
  'TRANSFER',
  'INVENTORY',
  'WRITEOFF',
  'DOCUMENT',
];

export const ALL_AUDIT_CATEGORIES: AuditCategory[] = [
  'AUTH',
  'SECURITY',
  'ADMIN',
  'EQUIPMENT',
  'MAINTENANCE',
  'TRANSFER',
  'INVENTORY',
  'WRITEOFF',
  'DOCUMENT',
];

export function getRoleLogCapabilities(role: UserRole): RoleLogCapabilities {
  if (role === 'ADMIN') {
    return {
      role: 'ADMIN',
      roleLabel: 'Администратор',
      scope: 'ALL',
      scopeTitle: 'Полный аудит и управление журналом',
      scopeDescription:
        'Доступ ко всем событиям всех пользователей, событиям безопасности и входов, IP-адресам, экспорту и очистке архива.',
      allowedCategories: ALL_AUDIT_CATEGORIES,
      canViewAllUsers: true,
      canViewSecurityEvents: true,
      canViewTechnicalMeta: true,
      canExport: true,
      canPurge: true,
    };
  }

  if (role === 'ENGINEER') {
    return {
      role: 'ENGINEER',
      roleLabel: 'Инженер',
      scope: 'OPERATIONAL',
      scopeTitle: 'Операционно-технический журнал',
      scopeDescription:
        'Доступ к событиям по оборудованию, неисправностям, передачам, инвентаризации, списанию и документам, а также к своим входам. События безопасности, администрирования и чужие IP скрыты.',
      allowedCategories: [...ENGINEER_ALLOWED_CATEGORIES, 'AUTH'],
      canViewAllUsers: false,
      canViewSecurityEvents: false,
      canViewTechnicalMeta: false,
      canExport: true,
      canPurge: false,
    };
  }

  return {
    role: 'USER',
    roleLabel: 'Пользователь',
    scope: 'OWN',
    scopeTitle: 'Персональный журнал действий',
    scopeDescription:
      'Отображаются только ваши собственные входы в систему и зарегистрированные вами заявки о неисправностях.',
    allowedCategories: ['AUTH', 'MAINTENANCE'],
    canViewAllUsers: false,
    canViewSecurityEvents: false,
    canViewTechnicalMeta: false,
    canExport: false,
    canPurge: false,
  };
}

export function extractClientIp(req?: express.Request): string | null {
  if (!req) return null;
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.trim()) {
    return fwd.split(',')[0].trim().slice(0, 120);
  }
  const ip = req.ip || req.socket?.remoteAddress || null;
  return ip ? String(ip).replace(/^::ffff:/, '').slice(0, 120) : null;
}

export function extractUserAgent(req?: express.Request): string | null {
  if (!req) return null;
  const ua = req.get('user-agent');
  return ua ? ua.slice(0, 300) : null;
}

const SENSITIVE_KEYS = new Set([
  'password',
  'password_hash',
  'token',
  'accessToken',
  'refreshToken',
  'secret',
]);

export function sanitizeAuditDetails(
  input: Record<string, any> | null | undefined,
  depth = 0
): Record<string, any> | null {
  if (!input || typeof input !== 'object' || depth > 4) return null;
  if (Array.isArray(input)) {
    return { items: input.slice(0, 50) };
  }
  const out: Record<string, any> = {};
  for (const [key, value] of Object.entries(input)) {
    if (SENSITIVE_KEYS.has(key) || /password|secret|token/i.test(key)) {
      out[key] = '[СКРЫТО]';
    } else if (value instanceof Date) {
      out[key] = value.toISOString();
    } else if (Array.isArray(value)) {
      out[key] = value.slice(0, 30);
    } else if (value && typeof value === 'object') {
      out[key] = sanitizeAuditDetails(value, depth + 1);
    } else {
      out[key] = value;
    }
  }
  return out;
}

export interface LogAuditParams {
  req?: express.Request;
  actor?: { id?: number | null; login?: string | null; role?: string | null } | null;
  action: string;
  category: AuditCategory;
  severity?: AuditSeverity;
  entityType?: string | null;
  entityId?: number | string | null;
  entityLabel?: string | null;
  summary: string;
  details?: Record<string, any> | null;
}

export async function logAuditEvent(params: LogAuditParams): Promise<void> {
  try {
    const reqUser = (params.req as any)?.user;
    const actorId = params.actor?.id ?? reqUser?.id ?? null;
    const actorLogin = params.actor?.login ?? reqUser?.login ?? 'Система';
    const actorRole = params.actor?.role ?? reqUser?.role ?? 'ANONYMOUS';

    await db.insert(auditLogs).values({
      actor_id: actorId,
      actor_login: actorLogin ? String(actorLogin).slice(0, 120) : null,
      actor_role: actorRole ? String(actorRole).slice(0, 40) : null,
      action: params.action,
      category: params.category,
      severity: params.severity || 'INFO',
      entity_type: params.entityType || null,
      entity_id: params.entityId !== undefined && params.entityId !== null ? String(params.entityId) : null,
      entity_label: params.entityLabel ? String(params.entityLabel).slice(0, 250) : null,
      summary: String(params.summary).slice(0, 500),
      details: sanitizeAuditDetails(params.details),
      ip_address: extractClientIp(params.req),
      user_agent: extractUserAgent(params.req),
    });
  } catch (err: any) {
    console.error('Audit logger warning (non-blocking):', err?.message || err);
  }
}
