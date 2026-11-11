import bcrypt from 'bcryptjs';
import { db } from './index.ts';
import {
  additionalFields,
  equipment,
  equipmentTypes,
  rooms,
  users,
} from './schema.ts';
import { eq } from 'drizzle-orm';

export async function seedDatabaseIfEmpty() {
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
