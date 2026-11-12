import bcrypt from 'bcryptjs';
import { db } from './index.ts';
import {
  additionalFields,
  equipment,
  equipmentIssues,
  equipmentTransfers,
  equipmentTypes,
  equipmentWriteoffs,
  equipmentBatches,
  notifications,
  rooms,
  users,
} from './schema.ts';
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
        initial_cost DOUBLE PRECISION NOT NULL,
        residual_cost DOUBLE PRECISION NOT NULL,
        room_id BIGINT NOT NULL REFERENCES room(id),
        additional_fields JSON NOT NULL DEFAULT '{}'
      );
    `);

    await db.execute(sql`
      DO $$ BEGIN
        ALTER TABLE equipment ALTER COLUMN initial_cost TYPE DOUBLE PRECISION;
        ALTER TABLE equipment ALTER COLUMN residual_cost TYPE DOUBLE PRECISION;
      EXCEPTION WHEN OTHERS THEN null; END $$;
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
    const existingUsers = await db.select().from(users).limit(10);
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

    // 2. Create Rooms (including 302, 305, 308, 309 from user spreadsheet)
    const [room302] = await db.insert(rooms).values({ number: '302', floor: 3 }).returning();
    const [room305] = await db.insert(rooms).values({ number: '305', floor: 3 }).returning();
    const [room308] = await db.insert(rooms).values({ number: '308', floor: 3 }).returning();
    const [room309] = await db.insert(rooms).values({ number: '309', floor: 3 }).returning();
    const [room101] = await db.insert(rooms).values({ number: '101', floor: 1 }).returning();
    await db.insert(rooms).values({ number: '204', floor: 2 });
    await db.insert(rooms).values({ number: '412', floor: 4 });

    // 3. Create the 11 Standard Equipment Types specified by the user:
    const standardTypeNames = [
      'Компьютер',
      'Ноутбук',
      'Монитор',
      'Периферия',
      'Сетевое оборудование',
      'ПО (программное обеспечение)',
      'Корпусная мебель',
      'Стулья ISO',
      'Стулья (газлифт)',
      'Стулья прочие',
      'Жалюзи',
    ];

    const typeMap = new Map<string, number>();
    for (const name of standardTypeNames) {
      const [created] = await db
        .insert(equipmentTypes)
        .values({ name, parent_id: null })
        .returning();
      typeMap.set(name, created.id);
    }

    const pcTypeId = typeMap.get('Компьютер')!;
    const laptopTypeId = typeMap.get('Ноутбук')!;
    const monitorTypeId = typeMap.get('Монитор')!;
    const peripheryTypeId = typeMap.get('Периферия')!;
    const furnitureTypeId = typeMap.get('Корпусная мебель')!;
    const chairGasliftId = typeMap.get('Стулья (газлифт)')!;
    const chairIsoId = typeMap.get('Стулья ISO')!;
    const blindsTypeId = typeMap.get('Жалюзи')!;
    const networkTypeId = typeMap.get('Сетевое оборудование')!;
    const softwareTypeId = typeMap.get('ПО (программное обеспечение)')!;

    // 4. Create Standard Additional Fields for Types
    // For Корпусная мебель (шкафы, тумбы, столы) -> Dimensions Д*Ш*В in cm
    await db.insert(additionalFields).values([
      {
        type_id: furnitureTypeId,
        code: 'dimensions',
        title: 'Размеры (Д*Ш*В), см',
        data_type: 'STRING',
        is_required: false,
        is_multiple: false,
        options: null,
        is_active: true,
      },
      {
        type_id: furnitureTypeId,
        code: 'color',
        title: 'Цвет',
        data_type: 'STRING',
        is_required: false,
        is_multiple: false,
        options: null,
        is_active: true,
      },
    ]);

    // For Компьютер
    await db.insert(additionalFields).values([
      {
        type_id: pcTypeId,
        code: 'cpu_model',
        title: 'Модель процессора',
        data_type: 'STRING',
        is_required: false,
        is_multiple: false,
        options: null,
        is_active: true,
      },
      {
        type_id: pcTypeId,
        code: 'ram_gb',
        title: 'Объем ОЗУ (ГБ)',
        data_type: 'INTEGER',
        is_required: false,
        is_multiple: false,
        options: null,
        is_active: true,
      },
    ]);

    // 5. Seed Equipment Items matching user screenshot and requirements
    // Row 1 from screenshot:
    // 305, Стол секретаря, [нет размеров], Описание: Лазерный принтер HP LJ 1020 белый, Периферия, Действует, Рабочее, Дорогостоящее, Драгметаллы: Да, Гарантия: Нет
    await db
      .insert(equipment)
      .values({
        inventory_number: 'INV-2019-011',
        name: 'Лазерный принтер HP LJ 1020 белый',
        type_id: peripheryTypeId,
        recived: new Date('2019-04-12T00:00:00Z'),
        initial_cost: 28500,
        residual_cost: 6500,
        room_id: room305.id,
        additional_fields: {
          location_place: 'Стол секретаря',
          description: 'Лазерный принтер HP LJ 1020 белый',
          color: 'белый',
          status: 'Действует',
          condition: 'Рабочее',
          accounting_category: 'Дорогостоящее',
          precious_metals: true,
          is_under_warranty: false,
          warranty_until: null,
          notes: 'Установлен у секретаря кафедры',
        },
      });

    // Row 2 from screenshot:
    // 302, Центральный стол на 12 мест, Размеры: 560*200*140, Цвет: серый, Корпусная мебель, Действует, Рабочее, Дорогостоящее, Драгметаллы: Нет, Гарантия: Нет
    const [eq2] = await db
      .insert(equipment)
      .values({
        inventory_number: 'INV-2021-045',
        name: 'Центральный стол на 12 мест',
        type_id: furnitureTypeId,
        recived: new Date('2021-08-20T00:00:00Z'),
        initial_cost: 145000,
        residual_cost: 98000,
        room_id: room302.id,
        additional_fields: {
          location_place: 'Центральный стол на 12 мест',
          dimensions: '560*200*140',
          length_cm: 560,
          width_cm: 200,
          height_cm: 140,
          description: 'Стол для заседаний и семинаров кафедры',
          color: 'серый',
          status: 'Действует',
          condition: 'Рабочее',
          accounting_category: 'Дорогостоящее',
          precious_metals: false,
          is_under_warranty: false,
          warranty_until: null,
          notes: 'Кабинет совещаний 302',
        },
      })
      .returning();

    // Row 3 from screenshot:
    // 302, Шкаф 3, Размеры: 420*80*250, Цвет: серый, Корпусная мебель, Действует, Рабочее, Дорогостоящее, Драгметаллы: Нет, Гарантия: Нет
    const [eq3] = await db
      .insert(equipment)
      .values({
        inventory_number: 'INV-2020-032',
        name: 'Шкаф 3',
        type_id: furnitureTypeId,
        recived: new Date('2020-11-15T00:00:00Z'),
        initial_cost: 82000,
        residual_cost: 49000,
        room_id: room302.id,
        additional_fields: {
          location_place: 'Шкаф 3',
          dimensions: '420*80*250',
          length_cm: 420,
          width_cm: 80,
          height_cm: 250,
          description: 'Шкаф книжный трехсекционный',
          color: 'серый',
          status: 'Действует',
          condition: 'Рабочее',
          accounting_category: 'Дорогостоящее',
          precious_metals: false,
          is_under_warranty: false,
          warranty_until: null,
          notes: 'Архив документации',
        },
      })
      .returning();

    // Row 4 from screenshot:
    // 309, Стол 7, Компьютер, Действует, Рабочее, Дорогостоящее, Драгметаллы: Да, Гарантия: Да, Гарантия истекает: 12.05.2027
    await db
      .insert(equipment)
      .values({
        inventory_number: 'INV-2024-007',
        name: 'ПК преподавателя HP ProDesk 400 G7',
        type_id: pcTypeId,
        recived: new Date('2024-05-12T00:00:00Z'),
        initial_cost: 76000,
        residual_cost: 65000,
        room_id: room309.id,
        additional_fields: {
          location_place: 'Стол 7',
          description: 'Компьютер ведущего преподавателя',
          color: 'черный',
          status: 'Действует',
          condition: 'Рабочее',
          accounting_category: 'Дорогостоящее',
          precious_metals: true,
          is_under_warranty: true,
          warranty_until: '2027-05-12',
          cpu_model: 'Intel Core i5-10500',
          ram_gb: 16,
          notes: 'На гарантии до 12.05.2027',
        },
      });

    // Row 5 from screenshot:
    // 309, Стол 7, Периферия / Монитор, Действует, Рабочее, Дорогостоящее, Драгметаллы: Да, Гарантия: Нет
    await db
      .insert(equipment)
      .values({
        inventory_number: 'INV-2020-071',
        name: 'Монитор 24" Philips 243V7QDSB',
        type_id: monitorTypeId,
        recived: new Date('2020-03-10T00:00:00Z'),
        initial_cost: 16500,
        residual_cost: 6200,
        room_id: room309.id,
        additional_fields: {
          location_place: 'Стол 7',
          description: 'Монитор рабочего места преподавателя',
          color: 'черный',
          status: 'Действует',
          condition: 'Рабочее',
          accounting_category: 'Дорогостоящее',
          precious_metals: true,
          is_under_warranty: false,
          warranty_until: null,
        },
      });

    // Row 6 from screenshot:
    // 305, Стол 10, Описание: Кресло офисное подъёмно-поворотное, Цвет: черный, Стул (газлифт), Действует, Рабочее, Малоценка, Драгметаллы: Нет, Гарантия: Нет
    await db
      .insert(equipment)
      .values({
        inventory_number: 'INV-2022-194',
        name: 'Кресло офисное подъёмно-поворотное',
        type_id: chairGasliftId,
        recived: new Date('2022-09-18T00:00:00Z'),
        initial_cost: 9800,
        residual_cost: 5400,
        room_id: room305.id,
        additional_fields: {
          location_place: 'Стол 10',
          description: 'Кресло офисное подъёмно-поворотное',
          color: 'черный',
          status: 'Действует',
          condition: 'Рабочее',
          accounting_category: 'Малоценка',
          precious_metals: false,
          is_under_warranty: false,
          warranty_until: null,
        },
      });

    // Additional sample rows showcasing all states & types:
    // Sample with expired warranty (yesterday) to demonstrate automatic expiry:
    const yesterday = new Date(Date.now() - 24 * 3600 * 1000).toISOString().split('T')[0];
    const [eq7] = await db
      .insert(equipment)
      .values({
        inventory_number: 'INV-2023-088',
        name: 'Ноутбук кафедры Lenovo ThinkBook 15',
        type_id: laptopTypeId,
        recived: new Date('2023-11-10T00:00:00Z'),
        initial_cost: 69000,
        residual_cost: 48000,
        room_id: room308.id,
        additional_fields: {
          location_place: 'Стол 2',
          description: 'Ноутбук для выездных занятий',
          color: 'серый',
          status: 'Действует',
          condition: 'Есть нюансы',
          accounting_category: 'Дорогостоящее',
          precious_metals: true,
          is_under_warranty: false,
          warranty_until: yesterday, // Expired yesterday -> automatically becomes "Нет"
          notes: 'Гарантийный срок истёк вчера, система автоматически перевела статус в "Нет"',
        },
      })
      .returning();

    // Sample furniture with other dimensions (тумба мобильная):
    await db
      .insert(equipment)
      .values({
        inventory_number: 'INV-2022-054',
        name: 'Тумба мобильная с 3 ящиками',
        type_id: furnitureTypeId,
        recived: new Date('2022-03-15T00:00:00Z'),
        initial_cost: 14200,
        residual_cost: 8900,
        room_id: room308.id,
        additional_fields: {
          location_place: 'Рядом со столом 1',
          dimensions: '45*50*60',
          length_cm: 45,
          width_cm: 50,
          height_cm: 60,
          description: 'Тумба подкатная офисная',
          color: 'серый',
          status: 'Действует',
          condition: 'Рабочее',
          accounting_category: 'Малоценка',
          precious_metals: false,
          is_under_warranty: false,
        },
      });

    // Sample chair ISO:
    await db
      .insert(equipment)
      .values({
        inventory_number: 'INV-2023-201',
        name: 'Стул ISO Black тканевый',
        type_id: chairIsoId,
        recived: new Date('2023-01-20T00:00:00Z'),
        initial_cost: 3200,
        residual_cost: 2400,
        room_id: room308.id,
        additional_fields: {
          location_place: 'Ряд 1',
          description: 'Стул посетителя на металлокаркасе',
          color: 'черный',
          status: 'Действует',
          condition: 'Рабочее',
          accounting_category: 'Мягкий инвентарь',
          precious_metals: false,
          is_under_warranty: false,
        },
      });

    // Sample blinds:
    await db
      .insert(equipment)
      .values({
        inventory_number: 'INV-2021-310',
        name: 'Жалюзи вертикальные тканевые 180×220 см',
        type_id: blindsTypeId,
        recived: new Date('2021-06-14T00:00:00Z'),
        initial_cost: 6500,
        residual_cost: 2100,
        room_id: room308.id,
        additional_fields: {
          location_place: 'Окно 1-2',
          description: 'Жалюзи светозащитные бежевые',
          color: 'бежевый',
          status: 'Действует',
          condition: 'Рабочее',
          accounting_category: 'Мягкий инвентарь',
          precious_metals: false,
          is_under_warranty: false,
        },
      });

    // Sample in storage (на хранении):
    const [eq11] = await db
      .insert(equipment)
      .values({
        inventory_number: 'INV-2018-099',
        name: 'Сетевой коммутатор D-Link DGS-1210',
        type_id: networkTypeId,
        recived: new Date('2018-02-10T00:00:00Z'),
        initial_cost: 32000,
        residual_cost: 4000,
        room_id: room101.id,
        additional_fields: {
          location_place: 'Склад резерва',
          description: 'Коммутатор 24 порта Gigabit',
          color: 'серый',
          status: 'На хранении',
          condition: 'Вышло из строя (ремонт возможен)',
          accounting_category: 'Дорогостоящее',
          precious_metals: true,
          is_under_warranty: false,
          notes: 'Требуется замена встроенного БП',
        },
      })
      .returning();

    // Sample software:
    await db
      .insert(equipment)
      .values({
        inventory_number: 'INV-2024-501',
        name: 'Лицензия ОС Astra Linux Special Edition',
        type_id: softwareTypeId,
        recived: new Date('2024-02-01T00:00:00Z'),
        initial_cost: 18000,
        residual_cost: 14000,
        room_id: room308.id,
        additional_fields: {
          location_place: 'Серверная',
          description: 'Бессрочная лицензия для учебного класса',
          status: 'Действует',
          condition: 'Рабочее',
          accounting_category: 'Дорогостоящее',
          precious_metals: false,
          is_under_warranty: true,
          warranty_until: '2028-02-01',
        },
      });

    // 6. Writeoffs seed
    await db.insert(equipmentWriteoffs).values({
      equipment_id: eq11.id,
      state: 'PREPARING',
      writeoff_date: null,
    });

    // 7. Active Issue on eq11 + Notification for staff
    const [issue1] = await db
      .insert(equipmentIssues)
      .values({
        equipment_id: eq11.id,
        state: 'ISSUE',
        description: 'Сгорел порт питания, периодически перезагружается',
        broken_at: new Date(Date.now() - 3 * 3600 * 1000),
        repaired_at: null,
      })
      .returning();

    await db.insert(notifications).values([
      {
        user_id: adminUser.id,
        equipment_issue_id: issue1.id,
        is_read: false,
      },
      {
        user_id: engineerUser.id,
        equipment_issue_id: issue1.id,
        is_read: false,
      },
    ]);

    // 8. Active Loan / Transfer on Laptop eq7
    await db.insert(equipmentTransfers).values({
      equipment_id: eq7.id,
      issued_to: 'Доц. Иванов А.А. (каф. Информационных систем)',
      issued_at: new Date(Date.now() - 2 * 24 * 3600 * 1000),
      expected_return_at: new Date(Date.now() + 5 * 24 * 3600 * 1000),
      returned_at: null,
    });

    // 9. Group QR Batch
    await db.insert(equipmentBatches).values({
      code: 'GRP-2026-302',
      name: 'Мебельный гарнитур ауд. 302 (стол совещаний и шкафы)',
      equipment_ids: [eq2.id, eq3.id],
      room_id: room302.id,
    });

    console.log('Database seeded successfully with initial department data!');
  } catch (error) {
    console.error('Error during database seed:', error);
  }
}
