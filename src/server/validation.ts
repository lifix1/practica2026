import { db } from '../db/index.ts';
import {
  additionalFields,
  equipmentTypes,
} from '../db/schema.ts';
import { and, eq, inArray } from 'drizzle-orm';
import * as XLSX from 'xlsx';

export interface FieldDefinition {
  id: number;
  type_id: number;
  code: string;
  title: string;
  data_type: 'STRING' | 'INTEGER' | 'NUMBER' | 'BOOLEAN' | 'DATE' | 'ENUM';
  is_required: boolean;
  is_multiple: boolean;
  options: string[] | null;
  is_active: boolean;
}

// Recursively fetch all active additional fields for a type including all parent types
export async function getAllAdditionalFieldsForType(
  typeId: number
): Promise<FieldDefinition[]> {
  const typeIdsToSearch: number[] = [];
  let currentId: number | null = typeId;

  // Walk up the hierarchy
  while (currentId !== null) {
    typeIdsToSearch.push(currentId);
    const foundTypes: any[] = await db
      .select()
      .from(equipmentTypes)
      .where(eq(equipmentTypes.id, currentId))
      .limit(1);
    const foundType = foundTypes[0];

    if (!foundType || !foundType.parent_id) {
      break;
    }
    currentId = foundType.parent_id;
  }

  if (typeIdsToSearch.length === 0) {
    return [];
  }

  const fields = await db
    .select()
    .from(additionalFields)
    .where(
      and(
        inArray(additionalFields.type_id, typeIdsToSearch),
        eq(additionalFields.is_active, true)
      )
    );

  return fields as FieldDefinition[];
}

export interface StandardFieldSpec {
  title: string;
  kind: 'STRING' | 'NUMBER' | 'POSITIVE_INT' | 'BOOLEAN' | 'DATE' | 'ENUM' | 'DIMENSIONS';
  options?: string[];
}

export const STANDARD_DEPARTMENT_FIELDS: Record<string, StandardFieldSpec> = {
  location_place: { title: 'Место в помещении', kind: 'STRING' },
  dimensions: { title: 'Размеры (Д*Ш*В), см', kind: 'DIMENSIONS' },
  length_cm: { title: 'Длина (см)', kind: 'NUMBER' },
  width_cm: { title: 'Ширина (см)', kind: 'NUMBER' },
  height_cm: { title: 'Высота (см)', kind: 'NUMBER' },
  description: { title: 'Описание', kind: 'STRING' },
  color: { title: 'Цвет', kind: 'STRING' },
  status: {
    title: 'Статус',
    kind: 'ENUM',
    options: ['Действует', 'На хранении'],
  },
  condition: {
    title: 'Состояние',
    kind: 'ENUM',
    options: [
      'Рабочее',
      'Есть нюансы',
      'Вышло из строя (ремонт возможен)',
      'Неремонтопригодно',
    ],
  },
  accounting_category: {
    title: 'Категория (по бухучету)',
    kind: 'ENUM',
    options: ['Дорогостоящее', 'Малоценка', 'Мягкий инвентарь'],
  },
  precious_metals: { title: 'Содержание драгметаллов', kind: 'BOOLEAN' },
  is_under_warranty: { title: 'Оборудование на гарантии', kind: 'BOOLEAN' },
  warranty_until: { title: 'Гарантия истекает (дата)', kind: 'DATE' },
  warranty_expired: { title: 'Срок гарантии истёк', kind: 'BOOLEAN' },
  warranty_status_ru: { title: 'Статус гарантии', kind: 'STRING' },
  notes: { title: 'Примечание', kind: 'STRING' },
  quantity: { title: 'Количество (шт.)', kind: 'POSITIVE_INT' },
  is_kit_part: { title: 'Часть комплекта («из комплекта»)', kind: 'BOOLEAN' },
  'Наименование (по бухгалтерии)': {
    title: 'Наименование (по бухгалтерии)',
    kind: 'STRING',
  },
};

export interface ValidationOptions {
  preservedKeys?: string[];
  typeName?: string;
}

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
}

// Validate additional_fields JSON against type's allowed & required fields + standard department fields
export async function validateAdditionalFields(
  typeId: number,
  inputData: Record<string, any> = {},
  options: ValidationOptions = {}
): Promise<ValidationResult> {
  const errors: string[] = [];
  const allowedFields = await getAllAdditionalFieldsForType(typeId);
  const allowedMap = new Map<string, FieldDefinition>();

  for (const f of allowedFields) {
    allowedMap.set(f.code, f);
  }

  const preservedSet = new Set(options.preservedKeys || []);

  // 1. Check each key present in inputData
  for (const key of Object.keys(inputData)) {
    // Type-specific dynamic field will be checked in section 2 below
    if (allowedMap.has(key)) {
      continue;
    }

    // Standard department accounting field (universal for all equipment types)
    const standardSpec = STANDARD_DEPARTMENT_FIELDS[key];
    if (standardSpec) {
      const value = inputData[key];
      const isEmpty = value === undefined || value === null || value === '';
      if (!isEmpty) {
        const err = validateStandardField(value, standardSpec);
        if (err) {
          errors.push(err);
        }
      }
      continue;
    }

    // Previously saved / Excel-imported custom columns already belonging to this record
    if (preservedSet.has(key)) {
      continue;
    }

    const typeLabel = options.typeName ? ` «${options.typeName}»` : '';
    errors.push(
      `Поле «${key}» не настроено для типа оборудования${typeLabel}. Удалите лишнее поле или добавьте его в разделе «Типы оборудования».`
    );
  }

  // 2. Check each type-specific field definition
  for (const field of allowedFields) {
    const value = inputData[field.code];

    // Check required flag
    const isEmpty =
      value === undefined ||
      value === null ||
      value === '' ||
      (Array.isArray(value) && value.length === 0);

    if (field.is_required && isEmpty) {
      errors.push(`Заполните обязательное поле «${field.title}».`);
      continue;
    }

    if (isEmpty) {
      continue; // Not required and empty: valid
    }

    // Check multiple flag
    if (field.is_multiple) {
      if (!Array.isArray(value)) {
        errors.push(`Для поля «${field.title}» необходимо указать список значений.`);
        continue;
      }
      for (let i = 0; i < value.length; i++) {
        const itemVal = value[i];
        const itemError = validateSingleValue(itemVal, field);
        if (itemError) {
          errors.push(
            `Поле «${field.title}» (значение №${i + 1}): ${itemError}`
          );
        }
      }
    } else {
      if (Array.isArray(value)) {
        errors.push(`Поле «${field.title}» должно содержать одно значение, а не список.`);
        continue;
      }
      const valError = validateSingleValue(value, field);
      if (valError) {
        errors.push(`Поле «${field.title}»: ${valError}`);
      }
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

function validateStandardField(val: any, spec: StandardFieldSpec): string | null {
  switch (spec.kind) {
    case 'STRING':
      if (typeof val !== 'string' && typeof val !== 'number') {
        return `Поле «${spec.title}» должно содержать текстовое значение.`;
      }
      return null;
    case 'NUMBER': {
      const num = typeof val === 'number' ? val : Number(String(val).replace(',', '.'));
      if (isNaN(num) || num < 0) {
        return `Поле «${spec.title}» должно быть неотрицательным числом.`;
      }
      return null;
    }
    case 'POSITIVE_INT': {
      const num = typeof val === 'number' ? val : Number(String(val).trim());
      if (!Number.isInteger(num) || num < 1) {
        return `Поле «${spec.title}» должно быть целым числом не меньше 1.`;
      }
      return null;
    }
    case 'BOOLEAN':
      if (typeof val !== 'boolean') {
        if (val === 'true' || val === '1' || val === 'false' || val === '0') {
          return null;
        }
        return `Для поля «${spec.title}» выберите значение «Да» или «Нет».`;
      }
      return null;
    case 'DATE':
      if (isNaN(Date.parse(String(val)))) {
        return `В поле «${spec.title}» указана некорректная дата. Выберите дату из календаря.`;
      }
      return null;
    case 'ENUM':
      if (spec.options && !spec.options.includes(String(val))) {
        return `В поле «${spec.title}» выбрано недопустимое значение «${val}». Допустимые варианты: ${spec.options.join(', ')}.`;
      }
      return null;
    case 'DIMENSIONS': {
      const str = String(val).trim();
      const parts = str
        .split(/[*xхXХ×/\s]+/)
        .map((s) => parseFloat(s.replace(',', '.')))
        .filter((n) => !isNaN(n) && n > 0);
      if (parts.length === 0) {
        return `В поле «${spec.title}» укажите числовые размеры через знак «*» (например: 120*60*75).`;
      }
      return null;
    }
    default:
      return null;
  }
}

function validateSingleValue(val: any, field: FieldDefinition): string | null {
  switch (field.data_type) {
    case 'STRING':
      if (typeof val !== 'string' && typeof val !== 'number') {
        return 'введите текстовое значение.';
      }
      return null;
    case 'INTEGER':
      if (typeof val !== 'number' || !Number.isInteger(val)) {
        const num = Number(val);
        if (!Number.isInteger(num)) {
          return 'укажите целое число (например: 8).';
        }
      }
      return null;
    case 'NUMBER':
      if (typeof val !== 'number' || isNaN(val)) {
        const num = Number(String(val).replace(',', '.'));
        if (isNaN(num)) {
          return 'укажите числовое значение (например: 12.5).';
        }
      }
      return null;
    case 'BOOLEAN':
      if (typeof val !== 'boolean') {
        if (val === 'true' || val === '1' || val === 'false' || val === '0') {
          return null;
        }
        return 'выберите значение «Да» или «Нет».';
      }
      return null;
    case 'DATE':
      if (isNaN(Date.parse(String(val)))) {
        return 'укажите корректную дату (выберите из календаря).';
      }
      return null;
    case 'ENUM':
      if (!field.options || !field.options.includes(String(val))) {
        return `недопустимое значение «${val}». Выберите один из вариантов: ${(field.options || []).join(', ')}.`;
      }
      return null;
    default:
      return null;
  }
}

export function parseExcelFile(buffer: Buffer): any[] {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const firstSheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[firstSheetName];
  return XLSX.utils.sheet_to_json(worksheet, { defval: '' });
}
