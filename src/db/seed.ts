import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { db } from './index.ts';
import { users } from './schema.ts';
import { sql } from 'drizzle-orm';

export async function ensureTablesExist() {
  try {
    // 1. Create Enums if they don't exist
    await db.execute(sql`
      DO $$ BEGIN
        CREATE TYPE role_enum AS ENUM ('ADMIN', 'ENGINEER', 'USER');
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `);

    await db.execute(sql`
      DO $$ BEGIN
        CREATE TYPE data_type_enum AS ENUM ('STRING', 'INTEGER', 'NUMBER', 'BOOLEAN', 'DATE', 'ENUM');
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `);

    await db.execute(sql`
      DO $$ BEGIN
        CREATE TYPE writeoff_state_enum AS ENUM ('PREPARING', 'DOCUMENTS_PREPARATION', 'WRITTEN_OFF');
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `);

    await db.execute(sql`
      DO $$ BEGIN
        CREATE TYPE issue_state_enum AS ENUM ('ISSUE', 'CRITICAL_ISSUE', 'WEAR_AND_TEAR');
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `);

    // 2. Create tables if they do not exist
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "user" (
        id BIGSERIAL PRIMARY KEY,
        login TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role role_enum NOT NULL,
        uid TEXT UNIQUE
      );
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS refresh_token (
        id BIGINT PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
        token TEXT NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        valid_until TIMESTAMP NOT NULL
      );
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS room (
        id BIGSERIAL PRIMARY KEY,
        number TEXT NOT NULL,
        floor INTEGER NOT NULL
      );
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS equipment_type (
        id BIGSERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        parent_id BIGINT
      );
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS additional_field (
        id BIGSERIAL PRIMARY KEY,
        type_id BIGINT REFERENCES equipment_type(id) ON DELETE CASCADE,
        code TEXT NOT NULL,
        title TEXT NOT NULL,
        data_type data_type_enum NOT NULL,
        is_required BOOLEAN NOT NULL DEFAULT FALSE,
        is_multiple BOOLEAN NOT NULL DEFAULT FALSE,
        options JSON,
        is_active BOOLEAN NOT NULL DEFAULT TRUE
      );
    `);

    await db.execute(sql`
      DO $$ BEGIN
        ALTER TABLE additional_field ALTER COLUMN type_id DROP NOT NULL;
      EXCEPTION WHEN OTHERS THEN null; END $$;
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS equipment (
        id BIGSERIAL PRIMARY KEY,
        inventory_number TEXT,
        name TEXT NOT NULL,
        type_id BIGINT NOT NULL REFERENCES equipment_type(id),
        recived TIMESTAMP,
        initial_cost DOUBLE PRECISION,
        residual_cost DOUBLE PRECISION,
        room_id BIGINT REFERENCES room(id),
        additional_fields JSON NOT NULL DEFAULT '{}'
      );
    `);

    await db.execute(sql`
      DO $$
      DECLARE con_name text;
      BEGIN
        ALTER TABLE equipment ALTER COLUMN initial_cost TYPE DOUBLE PRECISION;
        ALTER TABLE equipment ALTER COLUMN residual_cost TYPE DOUBLE PRECISION;
        ALTER TABLE equipment ALTER COLUMN inventory_number DROP NOT NULL;
        ALTER TABLE equipment ALTER COLUMN recived DROP NOT NULL;
        ALTER TABLE equipment ALTER COLUMN initial_cost DROP NOT NULL;
        ALTER TABLE equipment ALTER COLUMN residual_cost DROP NOT NULL;
        ALTER TABLE equipment ALTER COLUMN room_id DROP NOT NULL;
        FOR con_name IN
          SELECT c.conname
          FROM pg_constraint c
          JOIN pg_class t ON c.conrelid = t.oid
          JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(c.conkey)
          WHERE t.relname = 'equipment' AND c.contype = 'u' AND a.attname = 'inventory_number'
        LOOP
          EXECUTE format('ALTER TABLE equipment DROP CONSTRAINT IF EXISTS %I', con_name);
        END LOOP;
      EXCEPTION WHEN OTHERS THEN null; END $$;
    `);
    await db.execute(sql`
      DROP INDEX IF EXISTS equipment_inventory_number_unique;
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS equipment_writeoff (
        equipment_id BIGINT PRIMARY KEY REFERENCES equipment(id) ON DELETE CASCADE,
        state writeoff_state_enum NOT NULL,
        writeoff_date TIMESTAMP
      );
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS equipment_issue (
        id BIGSERIAL PRIMARY KEY,
        equipment_id BIGINT NOT NULL REFERENCES equipment(id) ON DELETE CASCADE,
        reported_by_user_id BIGINT REFERENCES "user"(id) ON DELETE SET NULL,
        state issue_state_enum NOT NULL,
        description TEXT NOT NULL,
        broken_at TIMESTAMP NOT NULL DEFAULT NOW(),
        repaired_at TIMESTAMP
      );
    `);
    await db.execute(sql`
      ALTER TABLE equipment_issue
      ADD COLUMN IF NOT EXISTS reported_by_user_id BIGINT REFERENCES "user"(id) ON DELETE SET NULL;
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS notification (
        id BIGSERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
        equipment_issue_id BIGINT NOT NULL REFERENCES equipment_issue(id) ON DELETE CASCADE,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        is_read BOOLEAN NOT NULL DEFAULT FALSE
      );
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS equipment_transfer (
        id BIGSERIAL PRIMARY KEY,
        equipment_id BIGINT NOT NULL REFERENCES equipment(id) ON DELETE CASCADE,
        issued_to TEXT NOT NULL,
        issued_at TIMESTAMP NOT NULL DEFAULT NOW(),
        expected_return_at TIMESTAMP,
        returned_at TIMESTAMP
      );
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS inventory (
        id BIGSERIAL PRIMARY KEY,
        auditor_ext_id BIGINT NOT NULL REFERENCES "user"(id),
        started_at TIMESTAMP NOT NULL DEFAULT NOW(),
        finished_at TIMESTAMP
      );
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS verification (
        id BIGSERIAL PRIMARY KEY,
        equipment_id BIGINT NOT NULL REFERENCES equipment(id) ON DELETE CASCADE,
        inventory_id BIGINT NOT NULL REFERENCES inventory(id) ON DELETE CASCADE,
        verified_at TIMESTAMP
      );
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS equipment_batch (
        id BIGSERIAL PRIMARY KEY,
        code TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        equipment_ids JSON NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        room_id BIGINT
      );
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS audit_log (
        id BIGSERIAL PRIMARY KEY,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        actor_id BIGINT REFERENCES "user"(id) ON DELETE SET NULL,
        actor_login TEXT,
        actor_role TEXT,
        action TEXT NOT NULL,
        category TEXT NOT NULL,
        severity TEXT NOT NULL DEFAULT 'INFO',
        entity_type TEXT,
        entity_id TEXT,
        entity_label TEXT,
        summary TEXT NOT NULL,
        details JSON,
        ip_address TEXT,
        user_agent TEXT
      );
    `);

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log (created_at DESC);
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_audit_log_actor_id ON audit_log (actor_id);
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_audit_log_category ON audit_log (category);
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_audit_log_severity ON audit_log (severity);
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS writeoff_template (
        template_key TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        requisites JSON NOT NULL DEFAULT '{}',
        custom_docx_base64 TEXT,
        custom_file_name TEXT,
        updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_by TEXT
      );
    `);
  } catch (err: any) {
    console.log('ensureTablesExist notice:', err?.message || err);
  }
}

export async function seedDatabaseIfEmpty() {
  await ensureTablesExist();

  try {
    const existingUsers = await db.select({ id: users.id }).from(users).limit(1);
    if (existingUsers.length > 0) {
      console.log('Database already contains users, skipping initial admin bootstrap.');
      return;
    }

    console.log('Bootstrapping initial administrator account for ИС «Учет материальных ценностей»...');

    const isProd = process.env.NODE_ENV === 'production';
    const generateBootstrapPassword = () =>
      `${crypto.randomBytes(6).toString('base64url')}!9A`;

    const seedAdminPassword =
      process.env.SEED_ADMIN_PASSWORD?.trim() ||
      (isProd ? generateBootstrapPassword() : 'PiSP_Adm1n!2026');

    if (!process.env.SEED_ADMIN_PASSWORD?.trim()) {
      console.warn(
        '[BOOTSTRAP CREDENTIALS] Создана единственная начальная учетная запись администратора (смените пароль после первого входа):'
      );
      console.warn(`  • admin (ADMIN): ${seedAdminPassword}`);
    }

    const adminPasswordHash = await bcrypt.hash(seedAdminPassword, 12);

    await db.insert(users).values({
      login: 'admin',
      password_hash: adminPasswordHash,
      role: 'ADMIN',
    });

    console.log('Database initialized with only the admin account (no initial catalogs or demo data).');
  } catch (error) {
    console.error('Error during database seed:', error);
  }
}
