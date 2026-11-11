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
    const [foundType] = await db
      .select()
      .from(equipmentTypes)
      .where(eq(equipmentTypes.id, currentId))
      .limit(1);

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

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
}

// Validate additional_fields JSON against type's allowed & required fields
export async function validateAdditionalFields(
  typeId: number,
  inputData: Record<string, any> = {}
): Promise<ValidationResult> {
  const errors: string[] = [];
  const allowedFields = await getAllAdditionalFieldsForType(typeId);
  const allowedMap = new Map<string, FieldDefinition>();

  for (const f of allowedFields) {
    allowedMap.set(f.code, f);
  }

  // 1. Check for unknown fields (not described in additional_field)
  for (const key of Object.keys(inputData)) {
    if (!allowedMap.has(key)) {
      errors.push(`Недопустимое дополнительное поле '${key}' для данного типа оборудования`);
    }
  }

  // 2. Check each field definition
  for (const field of allowedFields) {
    const value = inputData[field.code];

    // Check required flag
    const isEmpty =
      value === undefined ||
      value === null ||
      value === '' ||
      (Array.isArray(value) && value.length === 0);

    if (field.is_required && isEmpty) {
      errors.push(`Обязательное поле '${field.title}' (${field.code}) не заполнено`);
      continue;
    }

    if (isEmpty) {
      continue; // Not required and empty: valid
    }

    // Check multiple flag
    if (field.is_multiple) {
      if (!Array.isArray(value)) {
        errors.push(`Поле '${field.title}' (${field.code}) должно быть массивом значений`);
        continue;
      }
      for (let i = 0; i < value.length; i++) {
        const itemVal = value[i];
        const itemError = validateSingleValue(itemVal, field);
        if (itemError) {
          errors.push(
            `Поле '${field.title}', элемент #${i + 1}: ${itemError}`
          );
        }
      }
    } else {
      if (Array.isArray(value)) {
        errors.push(`Поле '${field.title}' (${field.code}) не является массивом`);
        continue;
      }
      const valError = validateSingleValue(value, field);
      if (valError) {
        errors.push(`Поле '${field.title}': ${valError}`);
      }
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

function validateSingleValue(val: any, field: FieldDefinition): string | null {
  switch (field.data_type) {
    case 'STRING':
      if (typeof val !== 'string') return 'ожидается строка';
      return null;
    case 'INTEGER':
      if (typeof val !== 'number' || !Number.isInteger(val)) {
        // Try parsing string if from Excel
        const num = Number(val);
        if (!Number.isInteger(num)) return 'ожидается целое число';
      }
      return null;
    case 'NUMBER':
      if (typeof val !== 'number' || isNaN(val)) {
        const num = Number(val);
        if (isNaN(num)) return 'ожидается число';
      }
      return null;
    case 'BOOLEAN':
      if (typeof val !== 'boolean') {
        if (val === 'true' || val === '1' || val === 'false' || val === '0') {
          return null;
        }
        return 'ожидается логическое значение (true/false)';
      }
      return null;
    case 'DATE':
      if (isNaN(Date.parse(String(val)))) {
        return 'ожидается корректная дата (например YYYY-MM-DD)';
      }
      return null;
    case 'ENUM':
      if (!field.options || !field.options.includes(String(val))) {
        return `значение '${val}' не входит в допустимый список: [${(field.options || []).join(', ')}]`;
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
