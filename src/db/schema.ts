import { relations } from 'drizzle-orm';
import {
  bigint,
  bigserial,
  boolean,
  integer,
  json,
  pgEnum,
  pgTable,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

// 1. Enums
export const roleEnum = pgEnum('role_enum', ['ADMIN', 'ENGINEER', 'USER']);
export const dataTypeEnum = pgEnum('data_type_enum', [
  'STRING',
  'INTEGER',
  'NUMBER',
  'BOOLEAN',
  'DATE',
  'ENUM',
]);
export const writeoffStateEnum = pgEnum('writeoff_state_enum', [
  'PREPARING',
  'DOCUMENTS_PREPARATION',
  'WRITTEN_OFF',
]);
export const issueStateEnum = pgEnum('issue_state_enum', [
  'ISSUE',
  'CRITICAL_ISSUE',
  'WEAR_AND_TEAR',
]);

// 2. Table "user"
export const users = pgTable('user', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  login: text('login').notNull().unique(),
  password_hash: text('password_hash').notNull(),
  role: roleEnum('role').notNull(),
  uid: text('uid').unique(), // Optional Firebase Auth UID mapping
});

// 3. Table "refresh_token"
export const refreshTokens = pgTable('refresh_token', {
  id: bigint('id', { mode: 'number' })
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  token: text('token').notNull(),
  created_at: timestamp('created_at').notNull().defaultNow(),
  valid_until: timestamp('valid_until').notNull(),
});

// 4. Table "room"
export const rooms = pgTable('room', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  number: text('number').notNull(),
  floor: integer('floor').notNull(),
});

// 5. Table "equipment_type"
export const equipmentTypes = pgTable('equipment_type', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  name: text('name').notNull(),
  parent_id: bigint('parent_id', { mode: 'number' }),
});

// 6. Table "additional_field"
export const additionalFields = pgTable('additional_field', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  type_id: bigint('type_id', { mode: 'number' })
    .notNull()
    .references(() => equipmentTypes.id, { onDelete: 'cascade' }),
  code: text('code').notNull(),
  title: text('title').notNull(),
  data_type: dataTypeEnum('data_type').notNull(),
  is_required: boolean('is_required').notNull().default(false),
  is_multiple: boolean('is_multiple').notNull().default(false),
  options: json('options').$type<string[] | null>(),
  is_active: boolean('is_active').notNull().default(true),
});

// 7. Table "equipment"
export const equipment = pgTable('equipment', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  inventory_number: text('inventory_number').notNull().unique(),
  name: text('name').notNull(),
  type_id: bigint('type_id', { mode: 'number' })
    .notNull()
    .references(() => equipmentTypes.id),
  recived: timestamp('recived').notNull(),
  initial_cost: bigint('initial_cost', { mode: 'number' }).notNull(),
  residual_cost: bigint('residual_cost', { mode: 'number' }).notNull(),
  room_id: bigint('room_id', { mode: 'number' })
    .notNull()
    .references(() => rooms.id),
  additional_fields: json('additional_fields')
    .$type<Record<string, any>>()
    .notNull()
    .default({}),
});

// 8. Table "equipment_writeoff"
export const equipmentWriteoffs = pgTable('equipment_writeoff', {
  equipment_id: bigint('equipment_id', { mode: 'number' })
    .primaryKey()
    .references(() => equipment.id, { onDelete: 'cascade' }),
  state: writeoffStateEnum('state').notNull(),
  writeoff_date: timestamp('writeoff_date'),
});

// 9. Table "equipment_issue"
export const equipmentIssues = pgTable('equipment_issue', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  equipment_id: bigint('equipment_id', { mode: 'number' })
    .notNull()
    .references(() => equipment.id, { onDelete: 'cascade' }),
  state: issueStateEnum('state').notNull(),
  description: text('description').notNull(),
  broken_at: timestamp('broken_at').notNull().defaultNow(),
  repaired_at: timestamp('repaired_at'),
});

// 10. Table "notification"
export const notifications = pgTable('notification', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  user_id: bigint('user_id', { mode: 'number' })
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  equipment_issue_id: bigint('equipment_issue_id', { mode: 'number' })
    .notNull()
    .references(() => equipmentIssues.id, { onDelete: 'cascade' }),
  created_at: timestamp('created_at').notNull().defaultNow(),
  is_read: boolean('is_read').notNull().default(false),
});

// 11. Table "equipment_transfer"
export const equipmentTransfers = pgTable('equipment_transfer', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  equipment_id: bigint('equipment_id', { mode: 'number' })
    .notNull()
    .references(() => equipment.id, { onDelete: 'cascade' }),
  issued_to: text('issued_to').notNull(),
  issued_at: timestamp('issued_at').notNull().defaultNow(),
  expected_return_at: timestamp('expected_return_at'),
  returned_at: timestamp('returned_at'),
});

// 12. Table "inventory"
export const inventories = pgTable('inventory', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  auditor_ext_id: bigint('auditor_ext_id', { mode: 'number' })
    .notNull()
    .references(() => users.id),
  started_at: timestamp('started_at').notNull().defaultNow(),
  finished_at: timestamp('finished_at'),
});

// 13. Table "verification"
export const verifications = pgTable('verification', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  equipment_id: bigint('equipment_id', { mode: 'number' })
    .notNull()
    .references(() => equipment.id, { onDelete: 'cascade' }),
  inventory_id: bigint('inventory_id', { mode: 'number' })
    .notNull()
    .references(() => inventories.id, { onDelete: 'cascade' }),
  verified_at: timestamp('verified_at'),
});

// 14. Table "equipment_batch" (Group QR codes for multiple items like tables)
export const equipmentBatches = pgTable('equipment_batch', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  equipment_ids: json('equipment_ids').$type<number[]>().notNull(),
  created_at: timestamp('created_at').notNull().defaultNow(),
  room_id: bigint('room_id', { mode: 'number' }),
});

// Relations
export const usersRelations = relations(users, ({ one, many }) => ({
  refreshToken: one(refreshTokens, {
    fields: [users.id],
    references: [refreshTokens.id],
  }),
  notifications: many(notifications),
  audits: many(inventories),
}));

export const refreshTokensRelations = relations(refreshTokens, ({ one }) => ({
  user: one(users, {
    fields: [refreshTokens.id],
    references: [users.id],
  }),
}));

export const equipmentTypesRelations = relations(equipmentTypes, ({ one, many }) => ({
  parent: one(equipmentTypes, {
    fields: [equipmentTypes.parent_id],
    references: [equipmentTypes.id],
    relationName: 'typeHierarchy',
  }),
  children: many(equipmentTypes, {
    relationName: 'typeHierarchy',
  }),
  additionalFields: many(additionalFields),
  equipmentList: many(equipment),
}));

export const additionalFieldsRelations = relations(additionalFields, ({ one }) => ({
  type: one(equipmentTypes, {
    fields: [additionalFields.type_id],
    references: [equipmentTypes.id],
  }),
}));

export const roomsRelations = relations(rooms, ({ many }) => ({
  equipmentList: many(equipment),
}));

export const equipmentRelations = relations(equipment, ({ one, many }) => ({
  type: one(equipmentTypes, {
    fields: [equipment.type_id],
    references: [equipmentTypes.id],
  }),
  room: one(rooms, {
    fields: [equipment.room_id],
    references: [rooms.id],
  }),
  writeoff: one(equipmentWriteoffs, {
    fields: [equipment.id],
    references: [equipmentWriteoffs.equipment_id],
  }),
  issues: many(equipmentIssues),
  transfers: many(equipmentTransfers),
  verifications: many(verifications),
}));

export const equipmentWriteoffsRelations = relations(equipmentWriteoffs, ({ one }) => ({
  equipment: one(equipment, {
    fields: [equipmentWriteoffs.equipment_id],
    references: [equipment.id],
  }),
}));

export const equipmentIssuesRelations = relations(equipmentIssues, ({ one, many }) => ({
  equipment: one(equipment, {
    fields: [equipmentIssues.equipment_id],
    references: [equipment.id],
  }),
  notifications: many(notifications),
}));

export const notificationsRelations = relations(notifications, ({ one }) => ({
  user: one(users, {
    fields: [notifications.user_id],
    references: [users.id],
  }),
  issue: one(equipmentIssues, {
    fields: [notifications.equipment_issue_id],
    references: [equipmentIssues.id],
  }),
}));

export const equipmentTransfersRelations = relations(equipmentTransfers, ({ one }) => ({
  equipment: one(equipment, {
    fields: [equipmentTransfers.equipment_id],
    references: [equipment.id],
  }),
}));

export const inventoriesRelations = relations(inventories, ({ one, many }) => ({
  auditor: one(users, {
    fields: [inventories.auditor_ext_id],
    references: [users.id],
  }),
  verifications: many(verifications),
}));

export const verificationsRelations = relations(verifications, ({ one }) => ({
  equipment: one(equipment, {
    fields: [verifications.equipment_id],
    references: [equipment.id],
  }),
  inventory: one(inventories, {
    fields: [verifications.inventory_id],
    references: [inventories.id],
  }),
}));
