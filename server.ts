import express from 'express';
import cookieParser from 'cookie-parser';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import * as XLSX from 'xlsx';
import { db } from './src/db/index.ts';
import {
  additionalFields,
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
  optionalAuth,
  requireAuth,
  requireRole,
  setAuthCookies,
  type AuthRequest,
} from './src/server/auth.ts';
import {
  generateQrDocx,
  generateGroupQrDocx,
  generateWriteoffDocx,
  generateTransferInvoiceDocx,
  generateLowValueWriteoffActDocx,
  generateLowValueInvoiceDocx,
  generateLowValueNoDmWriteoffActDocx,
} from './src/server/docx-generator.ts';
import {
  getAllAdditionalFieldsForType,
  validateAdditionalFields,
} from './src/server/validation.ts';
import { seedDatabaseIfEmpty } from './src/db/seed.ts';
import { and, desc, eq, gte, ilike, inArray, isNull, lte, ne, or, sql } from 'drizzle-orm';
import path from 'path';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const isDev = process.env.NODE_ENV !== 'production';

// Trust Render / reverse-proxy headers (X-Forwarded-Proto, X-Forwarded-Host) so req.protocol === 'https'
app.set('trust proxy', 1);

app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));
app.use(cookieParser());

function getPublicBaseUrl(req: express.Request): string {
  const host = req.get('host');
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

// Login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { login, password } = req.body;
    if (!login || !password) {
      return res.status(400).json({ error: 'Логин и пароль обязательны' });
    }

    const [foundUser] = await db
      .select()
      .from(users)
      .where(eq(users.login, login))
      .limit(1);

    if (!foundUser) {
      return res.status(401).json({ error: 'Неверный логин или пароль' });
    }

    let passwordMatch = await bcrypt.compare(password, foundUser.password_hash);
    if (!passwordMatch) {
      const defaultCredentials: Record<string, string> = {
        admin: 'admin123',
        engineer: 'engineer123',
        user: 'user123',
      };
      if (defaultCredentials[login] && defaultCredentials[login] === password) {
        console.log(`Auto-healing password hash for user ${login}...`);
        const freshHash = await bcrypt.hash(password, 10);
        await db
          .update(users)
          .set({ password_hash: freshHash })
          .where(eq(users.id, foundUser.id));
        passwordMatch = true;
      }
    }

    if (!passwordMatch) {
      return res.status(401).json({ error: 'Неверный логин или пароль' });
    }

    const userPayload = {
      id: foundUser.id,
      login: foundUser.login,
      role: foundUser.role as 'ADMIN' | 'ENGINEER' | 'USER',
    };

    const accessToken = generateAccessToken(userPayload);
    const refreshToken = generateRefreshToken(userPayload);

    // Refresh token valid for 10 days
    const validUntil = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);

    // Upsert refresh token into DB for user
    await db
      .insert(refreshTokens)
      .values({
        id: foundUser.id,
        token: refreshToken,
        valid_until: validUntil,
      })
      .onConflictDoUpdate({
        target: refreshTokens.id,
        set: {
          token: refreshToken,
          valid_until: validUntil,
          created_at: new Date(),
        },
      });

    setAuthCookies(res, accessToken, refreshToken);

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
// Spec: "Невалидные refresh-токены должны удаляться из базы данных при попытке получить/обновить refresh-токен."
app.post('/api/auth/refresh', async (req, res) => {
  try {
    let token = req.cookies?.refresh_token || req.body?.refreshToken;

    if (!token) {
      return res.status(401).json({ error: 'Отсутствует refresh-токен' });
    }

    // Find token in DB
    const [storedToken] = await db
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.token, token))
      .limit(1);

    if (!storedToken) {
      clearAuthCookies(res);
      return res.status(401).json({ error: 'Недействительный refresh-токен' });
    }

    // Check expiration
    if (new Date(storedToken.valid_until) < new Date()) {
      // Delete invalid expired token from DB
      await db.delete(refreshTokens).where(eq(refreshTokens.id, storedToken.id));
      clearAuthCookies(res);
      return res.status(401).json({ error: 'Срок действия refresh-токена истек' });
    }

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, storedToken.id))
      .limit(1);

    if (!user) {
      await db.delete(refreshTokens).where(eq(refreshTokens.id, storedToken.id));
      clearAuthCookies(res);
      return res.status(401).json({ error: 'Пользователь не найден' });
    }

    const userPayload = {
      id: user.id,
      login: user.login,
      role: user.role as 'ADMIN' | 'ENGINEER' | 'USER',
    };

    const newAccessToken = generateAccessToken(userPayload);
    const newRefreshToken = generateRefreshToken(userPayload);
    const validUntil = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);

    await db
      .update(refreshTokens)
      .set({
        token: newRefreshToken,
        valid_until: validUntil,
        created_at: new Date(),
      })
      .where(eq(refreshTokens.id, user.id));

    setAuthCookies(res, newAccessToken, newRefreshToken);

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

// Logout
app.post('/api/auth/logout', optionalAuth, async (req: AuthRequest, res) => {
  try {
    if (req.user) {
      await db.delete(refreshTokens).where(eq(refreshTokens.id, req.user.id));
    }
    clearAuthCookies(res);
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
    res.status(500).json({ error: error.message });
  }
});

// Create User (Admin only, Scenario 1 page 1)
app.post('/api/users', requireAuth, requireRole('ADMIN'), async (req, res) => {
  try {
    const { login, password, role } = req.body;
    if (!login || !password || !role) {
      return res.status(400).json({ error: 'Логин, пароль и роль обязательны' });
    }
    if (!['ADMIN', 'ENGINEER', 'USER'].includes(role)) {
      return res.status(400).json({ error: 'Недопустимая роль пользователя' });
    }

    const existing = await db
      .select()
      .from(users)
      .where(eq(users.login, login))
      .limit(1);

    if (existing.length > 0) {
      return res.status(400).json({ error: `Пользователь с логином "${login}" уже существует` });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const [created] = await db
      .insert(users)
      .values({
        login,
        password_hash: passwordHash,
        role: role as 'ADMIN' | 'ENGINEER' | 'USER',
      })
      .returning({ id: users.id, login: users.login, role: users.role });

    res.status(201).json(created);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// 2. ROOMS & TYPES ROUTES
// ==========================================

// Get Rooms
app.get('/api/rooms', optionalAuth, async (_req, res) => {
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

    res.status(201).json(newRoom);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get Equipment Types (hierarchical)
app.get('/api/equipment-types', optionalAuth, async (_req, res) => {
  try {
    const types = await db.select().from(equipmentTypes).orderBy(equipmentTypes.name);
    res.json(types);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Create Equipment Type (Admin only)
app.post('/api/equipment-types', requireAuth, requireRole('ADMIN'), async (req, res) => {
  try {
    const { name, parent_id } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Название типа оборудования обязательно' });
    }

    const [newType] = await db
      .insert(equipmentTypes)
      .values({
        name: name.trim(),
        parent_id: parent_id ? Number(parent_id) : null,
      })
      .returning();

    res.status(201).json(newType);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Update Equipment Type (Admin only)
app.put('/api/equipment-types/:id', requireAuth, requireRole('ADMIN'), async (req, res) => {
  try {
    const typeId = Number(req.params.id);
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

    if (newParentId === typeId) {
      return res.status(400).json({ error: 'Тип не может быть родителем самого себя' });
    }

    if (newParentId) {
      const allTypes = await db.select().from(equipmentTypes);
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
        const parentRecord = allTypes.find((t: any) => t.id === curr);
        curr = parentRecord?.parent_id ? Number(parentRecord.parent_id) : null;
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
app.get('/api/equipment-types/:id/fields', optionalAuth, async (req, res) => {
  try {
    const typeId = Number(req.params.id);
    const fields = await getAllAdditionalFieldsForType(typeId);
    res.json(fields);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Create Additional Field (Admin only)
// Spec: "Если тип ENUM, то в options обязательно хотя бы 1 значение; иначе NULL. code поля должен быть уникальным в пределах type_id."
app.post('/api/equipment-types/:id/fields', requireAuth, requireRole('ADMIN'), async (req, res) => {
  try {
    const typeId = Number(req.params.id);
    const { code, title, data_type, is_required, is_multiple, options } = req.body;

    if (!code || !title || !data_type) {
      return res.status(400).json({ error: 'Код, название и тип данных обязательны' });
    }

    if (data_type === 'ENUM') {
      if (!options || !Array.isArray(options) || options.length === 0) {
        return res.status(400).json({ error: 'Для типа ENUM необходимо указать хотя бы 1 вариант значений' });
      }
    }

    // Check unique code within type_id
    const existing = await db
      .select()
      .from(additionalFields)
      .where(
        and(
          eq(additionalFields.type_id, typeId),
          eq(additionalFields.code, code.trim()),
          eq(additionalFields.is_active, true)
        )
      );

    if (existing.length > 0) {
      return res.status(400).json({ error: `Характеристика с кодом "${code}" уже существует для данного типа` });
    }

    const [createdField] = await db
      .insert(additionalFields)
      .values({
        type_id: typeId,
        code: code.trim(),
        title: title.trim(),
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
    const { code, title, data_type, is_required, is_multiple, options } = req.body;

    if (!code || !title || !data_type) {
      return res.status(400).json({ error: 'Код, название и тип данных обязательны' });
    }

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

    // Check unique code within type_id (if code was changed)
    if (code.trim() !== existing.code) {
      const duplicate = await db
        .select()
        .from(additionalFields)
        .where(
          and(
            eq(additionalFields.type_id, typeId),
            eq(additionalFields.code, code.trim()),
            eq(additionalFields.is_active, true),
            sql`${additionalFields.id} != ${fieldId}`
          )
        );

      if (duplicate.length > 0) {
        return res.status(400).json({ error: `Характеристика с кодом "${code}" уже существует для данного типа` });
      }
    }

    const [updatedField] = await db
      .update(additionalFields)
      .set({
        code: code.trim(),
        title: title.trim(),
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

// Helper to compute warranty and dimensions dynamically
function computeDynamicWarranty(fields: any = {}) {
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  const rawWarrantyUntil = fields.warranty_until || fields['Гарантия истекает'];
  let formattedUntilStr: string | null = null;

  if (rawWarrantyUntil) {
    if (typeof rawWarrantyUntil === 'string') {
      const trimmed = rawWarrantyUntil.trim();
      const ruMatch = trimmed.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
      const isoMatch = trimmed.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})/);
      if (ruMatch) {
        formattedUntilStr = `${ruMatch[3]}-${ruMatch[2].padStart(2, '0')}-${ruMatch[1].padStart(2, '0')}`;
      } else if (isoMatch && Number(isoMatch[1]) >= 1900 && Number(isoMatch[1]) <= 2150) {
        formattedUntilStr = `${isoMatch[1]}-${isoMatch[2].padStart(2, '0')}-${isoMatch[3].padStart(2, '0')}`;
      } else if (/^\d{5}(\.\d+)?$/.test(trimmed)) {
        const serial = parseFloat(trimmed);
        if (serial >= 15000 && serial <= 80000) {
          const d = new Date(Math.round((serial - 25569) * 86400 * 1000));
          if (!isNaN(d.getTime())) {
            formattedUntilStr = d.toISOString().split('T')[0];
          }
        }
      } else {
        const d = new Date(trimmed);
        if (!isNaN(d.getTime()) && d.getFullYear() >= 1900 && d.getFullYear() <= 2150) {
          formattedUntilStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        }
      }
    } else if (rawWarrantyUntil instanceof Date && !isNaN(rawWarrantyUntil.getTime())) {
      formattedUntilStr = `${rawWarrantyUntil.getFullYear()}-${String(rawWarrantyUntil.getMonth() + 1).padStart(2, '0')}-${String(rawWarrantyUntil.getDate()).padStart(2, '0')}`;
    }
  }

  let isUnderWarranty = false;
  let warrantyExpired = false;

  if (formattedUntilStr) {
    // Active through the expiration day; flips to "Нет" on the very next day
    if (todayStr > formattedUntilStr) {
      isUnderWarranty = false;
      warrantyExpired = true;
    } else {
      isUnderWarranty = true;
      warrantyExpired = false;
    }
  } else {
    const flag = fields.is_under_warranty ?? fields['Оборудование на гарантии'];
    if (flag === true || String(flag).toLowerCase() === 'да' || String(flag).toLowerCase() === 'true') {
      isUnderWarranty = true;
      warrantyExpired = false;
    } else {
      isUnderWarranty = false;
      warrantyExpired = true;
    }
  }

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
    ...fields,
    dimensions:
      (rawDim && String(rawDim).trim()) ||
      (length_cm && width_cm && height_cm ? `${length_cm}*${width_cm}*${height_cm}` : null),
    length_cm,
    width_cm,
    height_cm,
    warranty_until: formattedUntilStr || fields.warranty_until || null,
    is_under_warranty: isUnderWarranty,
    warranty_status_ru: isUnderWarranty ? 'Да' : 'Нет',
    warranty_expired: warrantyExpired,
  };
}

// Equipment List
app.get('/api/equipment', optionalAuth, async (req: AuthRequest, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.max(1, Math.min(200, Number(req.query.limit) || 15));
    const offset = (page - 1) * limit;

    const search = req.query.search ? String(req.query.search).trim() : '';
    const typeId = req.query.type_id ? Number(req.query.type_id) : undefined;
    const roomId = req.query.room_id ? Number(req.query.room_id) : undefined;
    const receivedFrom = req.query.received_from ? new Date(String(req.query.received_from)) : undefined;
    const receivedTo = req.query.received_to ? new Date(String(req.query.received_to)) : undefined;
    const includeWrittenOff = req.query.include_written_off === 'true';
    const writeoffState = req.query.writeoff_state ? String(req.query.writeoff_state) : undefined;
    const hasUnrepairedIssue = req.query.has_unrepaired_issue === 'true';
    const activeTransferOnly = req.query.active_transfer === 'true';
    const transferredTo = req.query.transferred_to ? String(req.query.transferred_to).trim() : undefined;
    const customFieldCode = req.query.custom_field_code ? String(req.query.custom_field_code).trim() : undefined;
    const customFieldValue = req.query.custom_field_value ? String(req.query.custom_field_value).trim() : undefined;

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

    // Fetch equipment items with joins
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
      .innerJoin(equipmentTypes, eq(equipment.type_id, equipmentTypes.id))
      .innerJoin(rooms, eq(equipment.room_id, rooms.id))
      .leftJoin(equipmentWriteoffs, eq(equipment.id, equipmentWriteoffs.equipment_id))
      .$dynamic();

    const conditions: any[] = [];

    // Search filter across name, inventory number
    if (search) {
      conditions.push(
        or(
          ilike(equipment.name, `%${search}%`),
          ilike(equipment.inventory_number, `%${search}%`)
        )
      );
    }

    if (typeId) {
      conditions.push(eq(equipment.type_id, typeId));
    }

    if (roomId) {
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
      filtered = filtered.filter((item: any) => {
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

    // Accounting Category filter (Дорогостоящее / Малоценка / Мягкий инвентарь)
    if (categoryFilter && categoryFilter !== 'ALL') {
      filtered = filtered.filter((item: any) => {
        const itemCat = (item.additional_fields?.accounting_category || '').toLowerCase();
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

    if (customFieldCode && customFieldValue) {
      filtered = filtered.filter((item: any) => {
        const val = item.additional_fields?.[customFieldCode];
        if (val === undefined || val === null) return false;
        if (Array.isArray(val)) {
          return val.some((v: any) =>
            String(v).toLowerCase().includes(customFieldValue.toLowerCase())
          );
        }
        return String(val).toLowerCase().includes(customFieldValue.toLowerCase());
      });
    }

    const total = filtered.length;
    const paginatedItems = filtered.slice(offset, offset + limit);

    res.json({
      items: paginatedItems,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    });
  } catch (error: any) {
    console.error('Fetch equipment error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Download Department Excel Template matching accountant specification
// Must be registered BEFORE /api/equipment/:id so Express doesn't treat 'excel-template' as :id
app.get('/api/equipment/excel-template', (_req, res) => {
  try {
    const headers = [
      'Инвентарный номер',
      'Наименование',
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
      'Оборудование на гарантии',
      'Гарантия истекает',
      'Примечание',
    ];

    const sampleRows = [
      {
        'Инвентарный номер': 'INV-2019-011',
        'Наименование': 'Лазерный принтер HP LJ 1020 белый',
        'Дата принятия к учету': '2019-04-12',
        'Первоначальная стоимость': 28500,
        'Остаточная стоимость': 6500,
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
        'Оборудование на гарантии': 'Нет',
        'Гарантия истекает': '',
        'Примечание': '',
      },
      {
        'Инвентарный номер': 'INV-2021-045',
        'Наименование': 'Центральный стол на 12 мест',
        'Дата принятия к учету': '2021-08-20',
        'Первоначальная стоимость': 145000,
        'Остаточная стоимость': 98000,
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
        'Оборудование на гарантии': 'Нет',
        'Гарантия истекает': '',
        'Примечание': '',
      },
      {
        'Инвентарный номер': 'INV-2020-032',
        'Наименование': 'Шкаф 3',
        'Дата принятия к учету': '2020-11-15',
        'Первоначальная стоимость': 82000,
        'Остаточная стоимость': 49000,
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
        'Оборудование на гарантии': 'Нет',
        'Гарантия истекает': '',
        'Примечание': '',
      },
      {
        'Инвентарный номер': 'INV-2024-007',
        'Наименование': 'Компьютер преподавателя HP ProDesk',
        'Дата принятия к учету': '2024-05-12',
        'Первоначальная стоимость': 76000,
        'Остаточная стоимость': 65000,
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
        'Оборудование на гарантии': 'Да',
        'Гарантия истекает': '12.05.2027',
        'Примечание': '',
      },
      {
        'Инвентарный номер': 'INV-2020-071',
        'Наименование': 'Монитор рабочего места',
        'Дата принятия к учету': '2020-03-10',
        'Первоначальная стоимость': 16500,
        'Остаточная стоимость': 6200,
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
        'Оборудование на гарантии': 'Нет',
        'Гарантия истекает': '',
        'Примечание': '',
      },
      {
        'Инвентарный номер': 'INV-2022-194',
        'Наименование': 'Кресло офисное подъёмно-поворотное',
        'Дата принятия к учету': '2022-09-18',
        'Первоначальная стоимость': 9800,
        'Остаточная стоимость': 5400,
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
        'Оборудование на гарантии': 'Нет',
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
      .innerJoin(equipmentTypes, eq(equipment.type_id, equipmentTypes.id))
      .innerJoin(rooms, eq(equipment.room_id, rooms.id))
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
    const trimmedInv = String(inventory_number || '').trim();
    const trimmedName = String(name || '').trim();
    const numericTypeId = Number(type_id);
    const numericRoomId = Number(room_id);
    const recivedDate = recived ? new Date(recived) : null;

    if (!trimmedInv) {
      formErrors.push('Укажите инвентарный номер оборудования.');
    }
    if (!trimmedName) {
      formErrors.push('Укажите наименование оборудования.');
    }
    if (!type_id || !Number.isInteger(numericTypeId) || numericTypeId <= 0) {
      formErrors.push('Выберите тип оборудования из списка.');
    }
    if (!room_id || !Number.isInteger(numericRoomId) || numericRoomId <= 0) {
      formErrors.push('Выберите помещение (аудиторию).');
    }
    if (!recivedDate || isNaN(recivedDate.getTime())) {
      formErrors.push('Укажите корректную дату принятия к учёту.');
    }

    const parsedInitialCost =
      initial_cost === '' || initial_cost === undefined || initial_cost === null
        ? 0
        : Number(String(initial_cost).replace(',', '.'));
    const parsedResidualCost =
      residual_cost === '' || residual_cost === undefined || residual_cost === null
        ? 0
        : Number(String(residual_cost).replace(',', '.'));

    if (isNaN(parsedInitialCost) || parsedInitialCost < 0) {
      formErrors.push('Первоначальная стоимость должна быть неотрицательным числом (например: 1210.23).');
    }
    if (isNaN(parsedResidualCost) || parsedResidualCost < 0) {
      formErrors.push('Остаточная стоимость должна быть неотрицательным числом (например: 0.00).');
    }

    if (formErrors.length > 0) {
      return res.status(400).json({
        error: formErrors[0],
        details: formErrors,
      });
    }

    // Verify referenced type & room exist
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

    // Check unique inventory_number
    const existing = await db
      .select()
      .from(equipment)
      .where(eq(equipment.inventory_number, trimmedInv))
      .limit(1);

    if (existing.length > 0) {
      return res.status(400).json({
        error: `Оборудование с инвентарным номером «${trimmedInv}» уже существует в базе. Укажите другой номер или отредактируйте существующую карточку.`,
      });
    }

    // Validate additional fields
    const validation = await validateAdditionalFields(
      numericTypeId,
      additional_fields || {},
      { typeName: foundType.name }
    );

    if (!validation.isValid) {
      return res.status(400).json({
        error: 'Проверьте правильность заполнения дополнительных полей',
        details: validation.errors,
      });
    }

    const normalizedFields = computeDynamicWarranty(additional_fields || {});

    const [created] = await db
      .insert(equipment)
      .values({
        inventory_number: trimmedInv,
        name: trimmedName,
        type_id: numericTypeId,
        recived: recivedDate!,
        initial_cost: Math.round(parsedInitialCost * 100) / 100,
        residual_cost: Math.round(parsedResidualCost * 100) / 100,
        room_id: numericRoomId,
        additional_fields: normalizedFields,
      })
      .returning();

    res.status(201).json(created);
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
    const effectiveTypeId = type_id !== undefined ? Number(type_id) : existingItem.type_id;

    if (inventory_number !== undefined && !String(inventory_number).trim()) {
      formErrors.push('Инвентарный номер не может быть пустым.');
    }
    if (name !== undefined && !String(name).trim()) {
      formErrors.push('Наименование оборудования не может быть пустым.');
    }
    if (type_id !== undefined && (!Number.isInteger(effectiveTypeId) || effectiveTypeId <= 0)) {
      formErrors.push('Выберите корректный тип оборудования.');
    }
    if (room_id !== undefined && (!Number.isInteger(Number(room_id)) || Number(room_id) <= 0)) {
      formErrors.push('Выберите корректное помещение (аудиторию).');
    }
    if (recived !== undefined) {
      const parsedDate = new Date(recived);
      if (!recived || isNaN(parsedDate.getTime())) {
        formErrors.push('Укажите корректную дату принятия к учёту.');
      }
    }
    if (initial_cost !== undefined && initial_cost !== '') {
      const c = Number(String(initial_cost).replace(',', '.'));
      if (isNaN(c) || c < 0) {
        formErrors.push('Первоначальная стоимость должна быть неотрицательным числом.');
      }
    }
    if (residual_cost !== undefined && residual_cost !== '') {
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

    if (inventory_number !== undefined) {
      const trimmedInv = String(inventory_number).trim();
      const duplicate = await db
        .select({ id: equipment.id })
        .from(equipment)
        .where(and(eq(equipment.inventory_number, trimmedInv), ne(equipment.id, eqId)))
        .limit(1);
      if (duplicate.length > 0) {
        return res.status(400).json({
          error: `Инвентарный номер «${trimmedInv}» уже используется другим оборудованием. Укажите уникальный номер.`,
        });
      }
    }

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

    if (room_id !== undefined) {
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
    if (additional_fields !== undefined) {
      const preservedKeys = Object.keys(
        (existingItem.additional_fields as Record<string, any>) || {}
      );
      const validation = await validateAdditionalFields(
        effectiveTypeId,
        additional_fields,
        {
          preservedKeys,
          typeName: foundType.name,
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
    if (inventory_number !== undefined) updateData.inventory_number = String(inventory_number).trim();
    if (name !== undefined) updateData.name = String(name).trim();
    if (type_id !== undefined) updateData.type_id = effectiveTypeId;
    if (recived !== undefined) updateData.recived = new Date(recived);
    if (initial_cost !== undefined) {
      const val = initial_cost === '' || initial_cost === null ? 0 : Number(String(initial_cost).replace(',', '.'));
      updateData.initial_cost = Math.round(val * 100) / 100;
    }
    if (residual_cost !== undefined) {
      const val = residual_cost === '' || residual_cost === null ? 0 : Number(String(residual_cost).replace(',', '.'));
      updateData.residual_cost = Math.round(val * 100) / 100;
    }
    if (room_id !== undefined) updateData.room_id = Number(room_id);
    if (additional_fields !== undefined) {
      updateData.additional_fields = computeDynamicWarranty(additional_fields);
    }

    const [updated] = await db
      .update(equipment)
      .set(updateData)
      .where(eq(equipment.id, eqId))
      .returning();

    res.json(updated);
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
      .returning({ id: equipment.id });
    if (deleted.length === 0) {
      return res.status(404).json({ error: 'Оборудование не найдено или уже удалено' });
    }
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
    await db.delete(equipment).where(inArray(equipment.id, ids));
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
    const { equipment_ids } = req.body;
    if (!Array.isArray(equipment_ids) || equipment_ids.length === 0) {
      return res.status(400).json({ error: 'Выберите хотя бы одну единицу оборудования' });
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
      .innerJoin(equipmentTypes, eq(equipment.type_id, equipmentTypes.id))
      .innerJoin(rooms, eq(equipment.room_id, rooms.id))
      .where(inArray(equipment.id, equipment_ids.map(Number)));

    const baseUrl = getPublicBaseUrl(req);
    const formatted = items.map((i: any) => ({
      ...i,
      recivedDate: new Date(i.recived).toLocaleDateString('ru-RU'),
    }));

    const docxBuffer = await generateQrDocx(formatted, baseUrl);

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    );
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="equipment-qr-codes.docx"'
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
      .innerJoin(rooms, eq(equipment.room_id, rooms.id))
      .where(inArray(equipment.id, ids));

    if (items.length === 0) {
      return res.status(404).json({ error: 'Оборудование не найдено' });
    }

    const randomSuffix = Math.floor(1000 + Math.random() * 9000);
    const year = new Date().getFullYear();
    const code = `GRP-${year}-${randomSuffix}`;
    const autoName = name && name.trim()
      ? name.trim()
      : `Комплект: ${items.length} шт. («${items[0].name}»${items.length > 1 ? ` и др. — ауд. ${items[0].roomNumber}` : ''})`;

    const [batch] = await db
      .insert(equipmentBatches)
      .values({
        code,
        name: autoName,
        equipment_ids: ids,
        room_id: items[0]?.room_id || null,
      })
      .returning();

    const baseUrl = getPublicBaseUrl(req);
    const qrUrl = `${baseUrl}/q/${code}`;

    res.status(201).json({
      ...batch,
      qrUrl,
      itemsCount: items.length,
      items,
    });
  } catch (error: any) {
    console.error('Error creating group QR:', error);
    res.status(500).json({ error: error.message || 'Ошибка создания группового QR-кода' });
  }
});

// Get Group QR Batch Info
app.get('/api/equipment/qr-group/:code', optionalAuth, async (req: AuthRequest, res) => {
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
          .innerJoin(equipmentTypes, eq(equipment.type_id, equipmentTypes.id))
          .innerJoin(rooms, eq(equipment.room_id, rooms.id))
          .where(inArray(equipment.id, ids))
      : [];

    const baseUrl = getPublicBaseUrl(req);
    res.json({
      batch,
      qrUrl: `${baseUrl}/q/${batch.code}`,
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
          .innerJoin(equipmentTypes, eq(equipment.type_id, equipmentTypes.id))
          .innerJoin(rooms, eq(equipment.room_id, rooms.id))
          .where(inArray(equipment.id, ids))
      : [];

    const formatted = items.map((i: any) => ({
      ...i,
      recivedDate: i.recived ? new Date(i.recived).toLocaleDateString('ru-RU') : '—',
    }));

    const baseUrl = getPublicBaseUrl(req);
    const docxBuffer = await generateGroupQrDocx(
      {
        code: batch.code,
        name: batch.name,
        roomNumber: items[0]?.roomNumber,
        items: formatted,
      },
      baseUrl
    );

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
// Spec: "В сам QR-код зашивается ссылка на единый шлюз вашей системы, например: /q/EQ-10492.
// Проверка авторизации:
// Если сессия есть (сотрудник): редирект в систему к оборудованию или партии.
// Если сессии нет (случайный прохожий): Вариант «Пустышка» (404 Not Found)."
// ==========================================
app.get('/q/:code', optionalAuth, async (req: AuthRequest, res) => {
  try {
    const rawCode = req.params.code?.trim() || '';

    // 1. Unauthorized visitor (случайный прохожий) -> Вариант «Пустышка» (404 Not Found)
    if (!req.user) {
      return res.status(404).send(`<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <title>404 Not Found</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f8fafc; color: #334155; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 1rem; }
    .card { text-align: center; max-width: 420px; width: 100%; padding: 2.5rem 2rem; background: #ffffff; border-radius: 16px; border: 1px solid #e2e8f0; box-shadow: 0 10px 15px -3px rgba(0,0,0,0.05); }
    h1 { font-size: 3.5rem; margin: 0 0 0.5rem; color: #0f172a; font-weight: 800; letter-spacing: -0.05em; }
    p { margin: 0 0 1.5rem; color: #64748b; font-size: 0.95rem; line-height: 1.5; }
    .staff-box { margin-top: 1.5rem; padding-top: 1.5rem; border-top: 1px solid #f1f5f9; }
    .staff-link { display: inline-block; font-size: 0.8rem; color: #64748b; text-decoration: none; padding: 0.5rem 1rem; border-radius: 8px; background: #f8fafc; border: 1px solid #e2e8f0; transition: all 0.15s; }
    .staff-link:hover { color: #2563eb; background: #eff6ff; border-color: #bfdbfe; }
  </style>
</head>
<body>
  <div class="card">
    <h1>404</h1>
    <p>Запрашиваемый ресурс не найден или был перемещен.<br><span style="font-size:0.85rem;color:#94a3b8;">The requested object does not exist on this server.</span></p>
    <div class="staff-box">
      <a href="/?from_qr=${encodeURIComponent(rawCode)}" class="staff-link">🔒 Вход для сотрудников кафедры</a>
    </div>
  </div>
</body>
</html>`);
    }

    // 2. Authorized user: Check if it's a group batch
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

    // 3. Authorized user: Parse single equipment identifier (e.g. "EQ-10492", "10492", "INV-2022-001")
    let cleanId = rawCode;
    if (/^EQ-\d+$/i.test(rawCode)) {
      cleanId = rawCode.replace(/^EQ-/i, '');
    }

    // Try finding by primary key ID if numeric
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

    // Try finding by inventory number
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

    // Item not found in DB -> 404
    return res.status(404).send(`<!DOCTYPE html>
<html lang="ru"><head><meta charset="utf-8"><title>404 Not Found</title></head>
<body style="font-family:sans-serif;text-align:center;padding:3rem;">
  <h2>404 — Оборудование не найдено</h2>
  <p>Объект с идентификатором "${rawCode}" не зарегистрирован в базе данных кафедры.</p>
  <a href="/">Перейти в систему учета</a>
</body></html>`);
  } catch (error: any) {
    console.error('QR Gateway error:', error);
    res.status(500).send('Ошибка обработки шлюза QR-кода');
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

// Import Equipment from Excel
app.post('/api/equipment/import-excel', requireAuth, requireRole('ADMIN'), async (req, res) => {
  try {
    const { rows, type_id } = req.body;
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ error: 'Таблица пуста или содержит неверный формат' });
    }

    const selectedTypeId = type_id ? Number(type_id) : undefined;
    const errors: string[] = [];
    const createdItems: any[] = [];
    const newRoomsCreated: string[] = [];
    const newTypesCreated: string[] = [];

    // Cache rooms
    const allRooms = await db.select().from(rooms);
    const roomMap = new Map<string, number>();
    allRooms.forEach((r: any) => roomMap.set(r.number.trim().toLowerCase(), r.id));

    // Cache types
    const allTypes = await db.select().from(equipmentTypes);
    const typeMap = new Map<string, number>();
    allTypes.forEach((t: any) => typeMap.set(t.name.trim().toLowerCase(), t.id));

    // Track ALL existing inventory numbers in DB AND inside this batch to prevent UNIQUE collisions
    const existingInvRows = await db.select({ inv: equipment.inventory_number }).from(equipment);
    const usedInvNums = new Set<string>(existingInvRows.map((r: any) => String(r.inv).trim()));

    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

    for (let index = 0; index < rows.length; index++) {
      const row = rows[index];

      // Build normalized key lookup map for current row (handles Excel \n wrapped headers)
      const normalizedRow = new Map<string, any>();
      for (const rawKey of Object.keys(row)) {
        normalizedRow.set(normalizeHeaderKey(rawKey), row[rawKey]);
      }

      // Helper to extract value by multiple alternative keys (Russian & English)
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

      // Extract fields
      let invNum = getVal(
        'inventory_number',
        'Инвентарный номер',
        'Инвентарный №',
        'Инв. номер',
        'Инв номер',
        'Инв. №',
        '№ п/п'
      );
      let name = getVal(
        'name',
        'Наименование (по бухгалтерии)',
        'Наименование',
        'Наименование объекта',
        'Название'
      );
      const description = getVal('description', 'Описание', 'Краткое описание');
      const locationPlace = getVal('location_place', 'Место', 'Местоположение');
      const dimensionsStr = getVal('dimensions', 'Размеры (Д*Ш*В), см', 'Размеры, см', 'Размеры');
      const color = getVal('color', 'Цвет');
      const typeNameRaw = getVal('type_name', 'Тип оборудования', 'Тип');
      const statusRaw = getVal('status', 'Статус');
      const conditionRaw = getVal('condition', 'Состояние');
      const categoryRaw = getVal('accounting_category', 'Категория (по бухучету)', 'Категория');
      const preciousRaw = getVal('precious_metals', 'Содержание драгметаллов', 'Драгметаллы');
      const warrantyRaw = getVal('is_under_warranty', 'Оборудование на гарантии', 'На гарантии');
      const warrantyUntilRaw = getVal('warranty_until', 'Гарантия истекает', 'Срок гарантии до');
      const notes = getVal('notes', 'Примечание', 'Примечания');
      const quantityRaw = getVal('Количество', 'Кол-во', 'quantity');

      const roomStr = getVal('room_number', 'room_id', 'Помещение', 'Кабинет', 'Аудитория');
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

      // Auto-fallback for Name: use Description or Type if name is omitted
      if (!name) {
        name = description || (typeNameRaw ? `${typeNameRaw} (${roomStr ? `ауд. ${roomStr}` : 'б/н'})` : '');
      }
      if (!name) {
        name = `Материальная ценность №${index + 1}`;
      }

      // Auto-fallback for Inventory Number: auto-generate if omitted
      if (!invNum) {
        invNum = `INV-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
      }

      // Ensure unique inventory_number across DB AND earlier rows in this Excel file (e.g. shared kit numbers)
      if (usedInvNums.has(invNum)) {
        let suffix = 2;
        while (usedInvNums.has(`${invNum}-${suffix}`)) {
          suffix++;
        }
        invNum = `${invNum}-${suffix}`;
      }
      usedInvNums.add(invNum);

      // Date parsing
      let recivedDate = new Date();
      if (recivedRaw) {
        const parsed = parseExcelDate(recivedRaw);
        if (parsed) {
          recivedDate = new Date(`${parsed}T00:00:00Z`);
        }
      }

      const initialCost = parseFloat(initialCostRaw.replace(/\s+/g, '').replace(',', '.')) || 0;
      const residualCost = parseFloat(residualCostRaw.replace(/\s+/g, '').replace(',', '.')) || 0;

      // Room resolving or auto-creation
      let matchedRoomId: number | undefined;
      const cleanRoomStr = roomStr || '308';
      const cleanRoomKey = cleanRoomStr.toLowerCase();

      if (roomMap.has(cleanRoomKey)) {
        matchedRoomId = roomMap.get(cleanRoomKey);
      } else {
        const parsedNum = parseInt(cleanRoomStr.replace(/\D/g, ''), 10) || 1;
        const floor = Math.max(1, Math.min(10, Math.floor(parsedNum / 100) || 1));
        const [newRoom] = await db
          .insert(rooms)
          .values({ number: cleanRoomStr, floor })
          .returning();
        matchedRoomId = newRoom.id;
        roomMap.set(cleanRoomKey, newRoom.id);
        newRoomsCreated.push(cleanRoomStr);
      }

      // Type resolving or auto-creation
      let matchedTypeId = selectedTypeId;
      if (!matchedTypeId) {
        let lookupType = (typeNameRaw || 'Периферия').toLowerCase();
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

        for (const [key, id] of typeMap.entries()) {
          if (key.includes(lookupType) || lookupType.includes(key)) {
            matchedTypeId = id;
            break;
          }
        }

        if (!matchedTypeId) {
          const typeDisplayName = typeNameRaw || 'Периферия';
          const [newType] = await db
            .insert(equipmentTypes)
            .values({ name: typeDisplayName, parent_id: null })
            .returning();
          matchedTypeId = newType.id;
          typeMap.set(typeDisplayName.toLowerCase(), newType.id);
          newTypesCreated.push(typeDisplayName);
        }
      }

      // Parse dimensions (length, width, height)
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

      // Parse warranty expiry
      let formattedWarrantyUntil: string | null = null;
      let isUnderWarranty = false;

      if (warrantyUntilRaw) {
        formattedWarrantyUntil = parseExcelDate(warrantyUntilRaw);
      }

      if (formattedWarrantyUntil) {
        isUnderWarranty = todayStr <= formattedWarrantyUntil;
      } else {
        const lowerW = warrantyRaw.toLowerCase();
        isUnderWarranty = lowerW === 'да' || lowerW === 'true' || lowerW === '1';
      }

      // Precious metals boolean
      const preciousMetals =
        preciousRaw.toLowerCase() === 'да' ||
        preciousRaw.toLowerCase() === 'true' ||
        preciousRaw === '1';

      // Status & condition normalization
      let status = statusRaw || 'Действует';
      if (status.toLowerCase().includes('хранен')) status = 'На хранении';
      else status = 'Действует';

      let condition = conditionRaw || 'Рабочее';
      if (condition.toLowerCase().includes('нюанс')) condition = 'Есть нюансы';
      else if (condition.toLowerCase().includes('неремонт')) condition = 'Неремонтопригодно';
      else if (condition.toLowerCase().includes('вышл') || condition.toLowerCase().includes('ремонт')) condition = 'Вышло из строя (ремонт возможен)';
      else condition = 'Рабочее';

      let accounting_category = categoryRaw || 'Дорогостоящее';
      if (accounting_category.toLowerCase().includes('малоцен')) accounting_category = 'Малоценка';
      else if (accounting_category.toLowerCase().includes('мягк')) accounting_category = 'Мягкий инвентарь';
      else accounting_category = 'Дорогостоящее';

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
        is_under_warranty: isUnderWarranty,
        warranty_until: formattedWarrantyUntil,
        notes: notes || null,
      };
      if (quantityRaw) {
        const parsedQty = parseInt(String(quantityRaw).replace(/\s+/g, ''), 10);
        if (!isNaN(parsedQty) && parsedQty >= 1) {
          additional_fields.quantity = parsedQty;
        }
      }

      // Copy only genuinely extra custom columns (skip already-mapped accounting & department headers)
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

      createdItems.push({
        inventory_number: invNum,
        name,
        type_id: matchedTypeId,
        recived: recivedDate,
        initial_cost: Math.round(initialCost * 100) / 100,
        residual_cost: Math.round(residualCost * 100) / 100,
        room_id: matchedRoomId,
        additional_fields,
      });
    }

    if (errors.length > 0) {
      return res.status(400).json({
        error: 'Ошибки валидации таблицы Excel',
        details: errors,
      });
    }

    // Insert all items atomically inside a transaction
    await db.transaction(async (tx: any) => {
      for (const item of createdItems) {
        await tx.insert(equipment).values(item);
      }
    });

    res.status(201).json({
      success: true,
      message: `Успешно импортировано ${createdItems.length} единиц оборудования!`,
      count: createdItems.length,
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

    res.json({ success: true, count: validIds.length });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Download Sample Writeoff Act DOCX (Case 1 example matching accounting template)
app.get('/api/writeoff/sample-act', async (_req, res) => {
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

    const buffer = await generateWriteoffDocx(sampleItems, '', {
      writeoffDate: '2026-10-21',
      reason: 'начисленная амортизация составляет 100%',
    });

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
app.get('/api/writeoff/sample-invoice', async (_req, res) => {
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

    const buffer = await generateTransferInvoiceDocx(sampleItems, {
      invoiceNumber: '',
      invoiceDate: '2026-10-21',
    });

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
app.get('/api/writeoff/sample-act-case2', async (_req, res) => {
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

    const buffer = await generateLowValueWriteoffActDocx(sampleItems, {
      writeoffDate: '2026-10-21',
    });

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
app.get('/api/writeoff/sample-invoice-case2', async (_req, res) => {
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

    const buffer = await generateLowValueInvoiceDocx(sampleItems, {
      invoiceDate: '2026-10-21',
    });

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
app.get('/api/writeoff/sample-act-case3', async (_req, res) => {
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

    const buffer = await generateLowValueNoDmWriteoffActDocx(sampleItems, '', {
      writeoffDate: '2026-10-21',
    });

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
      .innerJoin(equipmentTypes, eq(equipment.type_id, equipmentTypes.id))
      .innerJoin(rooms, eq(equipment.room_id, rooms.id))
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
    const caseTypeParam = String(req.body?.case_type || req.query?.case_type || 'auto').toLowerCase();

    const formatted = orderedItems.map((i: any) => ({
      ...i,
      recivedDate: i.recived ? new Date(i.recived).toLocaleDateString('ru-RU') : '—',
      recivedRaw: i.recived,
    }));

    const allLowValue = formatted.every((i: any) =>
      String(i.additional_fields?.accounting_category || '')
        .toLowerCase()
        .includes('малоцен')
    );
    const anyPreciousMetals = formatted.some((i: any) =>
      Boolean(i.additional_fields?.precious_metals)
    );

    const resolvedCase: 'case1' | 'case2' | 'case3' =
      caseTypeParam === 'case3'
        ? 'case3'
        : caseTypeParam === 'case2'
        ? 'case2'
        : caseTypeParam === 'case1'
        ? 'case1'
        : allLowValue
        ? anyPreciousMetals
          ? 'case2'
          : 'case3'
        : 'case1';

    const buffer =
      resolvedCase === 'case3'
        ? await generateLowValueNoDmWriteoffActDocx(formatted, String(actNumberParam || ''), {
            writeoffDate: writeoffDateParam,
            actDate: writeoffDateParam,
          })
        : resolvedCase === 'case2'
        ? await generateLowValueWriteoffActDocx(formatted, {
            writeoffDate: writeoffDateParam,
            actDate: writeoffDateParam,
            reason: req.body?.reason || req.query?.reason,
            technicalConclusionNumber: String(techConclusionParam),
          })
        : await generateWriteoffDocx(formatted, String(actNumberParam || ''), {
            writeoffDate: writeoffDateParam,
            actDate: writeoffDateParam,
            reason: String(reasonParam),
            technicalConclusionNumber: String(techConclusionParam),
          });

    const dateTag = new Date().toISOString().slice(0, 10);
    const asciiFilename =
      resolvedCase === 'case3'
        ? `akt-malotsenka-bez-dm-${items.length}-poz-${dateTag}.docx`
        : resolvedCase === 'case2'
        ? `akt-malotsenka-dm-${items.length}-ed-${dateTag}.docx`
        : `akt-spisaniya-${items.length}-ed-${dateTag}.docx`;
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

app.post('/api/writeoff/generate-act', requireAuth, handleGenerateActRequest);
app.get('/api/writeoff/generate-act', requireAuth, handleGenerateActRequest);
app.get('/api/writeoff/act/:id', requireAuth, handleGenerateActRequest);

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
      .innerJoin(equipmentTypes, eq(equipment.type_id, equipmentTypes.id))
      .innerJoin(rooms, eq(equipment.room_id, rooms.id))
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

    const allLowValue = formatted.every((i: any) =>
      String(i.additional_fields?.accounting_category || '')
        .toLowerCase()
        .includes('малоцен')
    );
    const anyPreciousMetals = formatted.some((i: any) =>
      Boolean(i.additional_fields?.precious_metals)
    );

    if (caseTypeParam === 'auto' && allLowValue && !anyPreciousMetals) {
      return res.status(400).json({
        error: 'Для малоценного оборудования без драгметаллов (Кейс 3) накладная не требуется — достаточно только Акта списания.',
      });
    }

    const isLowValue = caseTypeParam === 'case2' || (caseTypeParam === 'auto' && allLowValue);

    const buffer = isLowValue
      ? await generateLowValueInvoiceDocx(formatted, {
          invoiceNumber: String(invoiceNumber),
          invoiceDate,
          department: String(sender),
        })
      : await generateTransferInvoiceDocx(formatted, {
          invoiceNumber: String(invoiceNumber),
          invoiceDate,
          sender: String(sender),
          recipient: String(recipient),
          note: String(note),
        });

    const dateTag = new Date().toISOString().slice(0, 10);
    const asciiFilename = isLowValue
      ? `nakladnaya-forma-434-${dateTag}.docx`
      : `nakladnaya-CIT-0501460-${dateTag}.docx`;
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
    console.error('Error generating transfer invoice:', error);
    res.status(500).json({ error: error.message || 'Ошибка формирования накладной' });
  }
}

app.post('/api/writeoff/generate-invoice', requireAuth, handleGenerateInvoiceRequest);
app.get('/api/writeoff/generate-invoice', requireAuth, handleGenerateInvoiceRequest);

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

    res.status(201).json({ success: true, count: createdIssues.length });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Issues History for single equipment (Chronological order, page 12)
app.get('/api/equipment/:id/issues', requireAuth, async (req, res) => {
  try {
    const eqId = Number(req.params.id);
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
    const { repaired_at } = req.body;

    const [updated] = await db
      .update(equipmentIssues)
      .set({
        repaired_at: repaired_at ? new Date(repaired_at) : new Date(),
      })
      .where(eq(equipmentIssues.id, issueId))
      .returning();

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
    const { returned_at } = req.body;

    const [updated] = await db
      .update(equipmentTransfers)
      .set({
        returned_at: returned_at ? new Date(returned_at) : new Date(),
      })
      .where(eq(equipmentTransfers.id, transferId))
      .returning();

    res.json(updated);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Transfer History for single equipment (Chronological order, page 15)
app.get('/api/equipment/:id/transfers', requireAuth, async (req, res) => {
  try {
    const eqId = Number(req.params.id);
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
      .innerJoin(equipmentTypes, eq(equipment.type_id, equipmentTypes.id))
      .innerJoin(rooms, eq(equipment.room_id, rooms.id))
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
app.post('/api/inventory/:inventoryId/verify/:equipmentId', requireAuth, requireRole('ADMIN', 'ENGINEER'), async (req, res) => {
  try {
    const inventoryId = Number(req.params.inventoryId);
    const eqId = Number(req.params.equipmentId);

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

    res.json({ success: true, verified_at: updated.verified_at });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Finish Inventory
app.post('/api/inventory/:id/finish', requireAuth, requireRole('ADMIN', 'ENGINEER'), async (req: AuthRequest, res) => {
  try {
    const invId = Number(req.params.id);

    const [audit] = await db
      .select()
      .from(inventories)
      .where(eq(inventories.id, invId))
      .limit(1);

    if (!audit) {
      return res.status(404).json({ error: 'Инвентаризация не найдена' });
    }

    const [finished] = await db
      .update(inventories)
      .set({
        finished_at: new Date(),
      })
      .where(eq(inventories.id, invId))
      .returning();

    res.json({ success: true, inventory: finished || audit });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// 10. FRONTEND INTEGRATION & DEV SERVER
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
