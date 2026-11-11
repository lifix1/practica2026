import bcrypt from 'bcryptjs';
import { db } from './index.ts';
import {
  additionalFields,
  equipment,
  equipmentTypes,
  rooms,
  users,
} from './schema.ts';
import { eq, sql } from 'drizzle-orm';

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
        type_id BIGINT NOT NULL REFERENCES equipment_type(id) ON DELETE CASCADE,
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
      CREATE TABLE IF NOT EXISTS equipment (
        id BIGSERIAL PRIMARY KEY,
        inventory_number TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        type_id BIGINT NOT NULL REFERENCES equipment_type(id),
        recived TIMESTAMP NOT NULL,
        initial_cost BIGINT NOT NULL,
        residual_cost BIGINT NOT NULL,
        room_id BIGINT NOT NULL REFERENCES room(id),
        additional_fields JSON NOT NULL DEFAULT '{}'
      );
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
        state issue_state_enum NOT NULL,
        description TEXT NOT NULL,
        broken_at TIMESTAMP NOT NULL DEFAULT NOW(),
        repaired_at TIMESTAMP
      );
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
  } catch (err: any) {
    console.log('ensureTablesExist notice:', err?.message || err);
  }
}

export async function seedDatabaseIfEmpty() {
  await ensureTablesExist();

  try {
    const existingUsers = await db.select().from(users).limit(1);
    if (existingUsers.length > 0) {
      console.log('Database already contains data, skipping seed.');
      return;
    }

    console.log('Seeding initial data for ИС «Учет материальных ценностей»...');

    // 1. Create Default Users (ADMIN, ENGINEER, USER)
    const adminPasswordHash = await bcrypt.hash('admin123', 10);
    const engineerPasswordHash = await bcrypt.hash('engineer123', 10);
    const userPasswordHash = await bcrypt.hash('user123', 10);

    const [adminUser] = await db
      .insert(users)
      .values({
        login: 'admin',
        password_hash: adminPasswordHash,
        role: 'ADMIN',
      })
      .returning();

    const [engineerUser] = await db
      .insert(users)
      .values({
        login: 'engineer',
        password_hash: engineerPasswordHash,
        role: 'ENGINEER',
      })
      .returning();

    await db
      .insert(users)
      .values({
        login: 'user',
        password_hash: userPasswordHash,
        role: 'USER',
      })
      .returning();

    // 2. Create Rooms
    const [room308] = await db
      .insert(rooms)
      .values({ number: '308', floor: 3 })
      .returning();
    const [room101] = await db
      .insert(rooms)
      .values({ number: '101', floor: 1 })
      .returning();
    const [room204] = await db
      .insert(rooms)
      .values({ number: '204', floor: 2 })
      .returning();
    const [room412] = await db
      .insert(rooms)
      .values({ number: '412', floor: 4 })
      .returning();

    // 3. Create Hierarchical Equipment Types
    // Root: Вычислительная техника
    const [computingRoot] = await db
      .insert(equipmentTypes)
      .values({ name: 'Вычислительная техника', parent_id: null })
      .returning();

    // Root: Мебель
    const [furnitureRoot] = await db
      .insert(equipmentTypes)
      .values({ name: 'Мебель', parent_id: null })
      .returning();

    // Subtypes under Вычислительная техника
    const [pcType] = await db
      .insert(equipmentTypes)
      .values({ name: 'Компьютер', parent_id: computingRoot.id })
      .returning();

    const [laptopType] = await db
      .insert(equipmentTypes)
      .values({ name: 'Ноутбук', parent_id: computingRoot.id })
      .returning();

    const [monitorType] = await db
      .insert(equipmentTypes)
      .values({ name: 'Монитор', parent_id: computingRoot.id })
      .returning();

    // Subtype under Мебель
    const [cupboardType] = await db
      .insert(equipmentTypes)
      .values({ name: 'Шкаф', parent_id: furnitureRoot.id })
      .returning();

    // 4. Create Additional Fields
    // For Computing Root (inherited by PC, Laptop, Monitor)
    await db.insert(additionalFields).values({
      type_id: computingRoot.id,
      code: 'warranty_months',
      title: 'Срок гарантии (мес.)',
      data_type: 'INTEGER',
      is_required: false,
      is_multiple: false,
      options: null,
      is_active: true,
    });

    // For Компьютер:
    // os_versions: String, multiple: true, required: true (from PDF scenario 1 page 7)
    await db.insert(additionalFields).values([
      {
        type_id: pcType.id,
        code: 'os_versions',
        title: 'Установленные ОС',
        data_type: 'STRING',
        is_required: true,
        is_multiple: true,
        options: null,
        is_active: true,
      },
      {
        type_id: pcType.id,
        code: 'cpu_model',
        title: 'Модель процессора',
        data_type: 'STRING',
        is_required: true,
        is_multiple: false,
        options: null,
        is_active: true,
      },
      {
        type_id: pcType.id,
        code: 'ram_gb',
        title: 'Объем ОЗУ (ГБ)',
        data_type: 'INTEGER',
        is_required: true,
        is_multiple: false,
        options: null,
        is_active: true,
      },
    ]);

    // For Ноутбук:
    await db.insert(additionalFields).values({
      type_id: laptopType.id,
      code: 'battery_health',
      title: 'Состояние АКБ (%)',
      data_type: 'INTEGER',
      is_required: false,
      is_multiple: false,
      options: null,
      is_active: true,
    });

    // For Монитор:
    await db.insert(additionalFields).values([
      {
        type_id: monitorType.id,
        code: 'diagonal',
        title: 'Диагональ экрана (дюймы)',
        data_type: 'NUMBER',
        is_required: true,
        is_multiple: false,
        options: null,
        is_active: true,
      },
      {
        type_id: monitorType.id,
        code: 'panel_type',
        title: 'Тип матрицы',
        data_type: 'ENUM',
        is_required: false,
        is_multiple: false,
        options: ['IPS', 'VA', 'TN', 'OLED'],
        is_active: true,
      },
    ]);

    // For Шкаф (page 7 scenario 2: shelves_count Number, optional)
    await db.insert(additionalFields).values({
      type_id: cupboardType.id,
      code: 'shelves_count',
      title: 'Количество полок',
      data_type: 'NUMBER',
      is_required: false,
      is_multiple: false,
      options: null,
      is_active: true,
    });

    // 5. Seed Initial Equipment Samples
    await db.insert(equipment).values([
      {
        inventory_number: 'INV-2015-001',
        name: 'Рабочая станция кафедры HP Z440',
        type_id: pcType.id,
        recived: new Date('2015-03-12T00:00:00Z'),
        initial_cost: 85000,
        residual_cost: 15000,
        room_id: room308.id,
        additional_fields: {
          os_versions: ['Ubuntu 22.04 LTS', 'Windows 11 Pro'],
          cpu_model: 'Intel Xeon E5-1650 v3',
          ram_gb: 32,
          warranty_months: 36,
        },
      },
      {
        inventory_number: 'INV-2018-042',
        name: 'ПК преподавательский Dell OptiPlex 7060',
        type_id: pcType.id,
        recived: new Date('2018-09-01T00:00:00Z'),
        initial_cost: 62000,
        residual_cost: 22000,
        room_id: room308.id,
        additional_fields: {
          os_versions: ['Windows 10 Pro'],
          cpu_model: 'Intel Core i7-8700',
          ram_gb: 16,
          warranty_months: 24,
        },
      },
      {
        inventory_number: 'INV-2021-105',
        name: 'Ноутбук кафедры ThinkPad L14 Gen 2',
        type_id: laptopType.id,
        recived: new Date('2021-04-15T00:00:00Z'),
        initial_cost: 78000,
        residual_cost: 49000,
        room_id: room204.id,
        additional_fields: {
          battery_health: 94,
          warranty_months: 12,
        },
      },
      {
        inventory_number: 'INV-2019-077',
        name: 'Монитор 27" Dell UltraSharp U2719D',
        type_id: monitorType.id,
        recived: new Date('2019-11-20T00:00:00Z'),
        initial_cost: 34000,
        residual_cost: 18000,
        room_id: room308.id,
        additional_fields: {
          diagonal: 27,
          panel_type: 'IPS',
          warranty_months: 36,
        },
      },
      {
        inventory_number: 'INV-2012-003',
        name: 'Шкаф архивный металлический Практик',
        type_id: cupboardType.id,
        recived: new Date('2012-06-10T00:00:00Z'),
        initial_cost: 24000,
        residual_cost: 3000,
        room_id: room101.id,
        additional_fields: {
          shelves_count: 5,
        },
      },
    ]);

    console.log('Database seeded successfully with initial data!');
  } catch (error) {
    console.error('Error during database seed:', error);
  }
}
